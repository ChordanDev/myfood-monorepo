defmodule MealPlannerApi.InviteAcceptConcurrencyTest do
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership, User}
  alias MealPlannerApi.Repo

  @moduletag :runtime_db_concurrency
  unless MealPlannerApi.Issue38Database.enabled?() do
    @moduletag skip: "requires test/support/issue38_concurrency_runner.exs and a fresh database"
  end

  setup_all do
    repo =
      start_supervised!(
        {Repo,
         name: nil,
         database: MealPlannerApi.Issue38Database.database!(),
         pool: DBConnection.ConnectionPool,
         pool_size: 4,
         timeout: 10_000,
         parameters: [lock_timeout: "3000", statement_timeout: "8000"]}
      )

    {:ok, repo: repo}
  end

  setup %{repo: repo} do
    Repo.put_dynamic_repo(repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    owner =
      user_with_memberships(%{email: "owner_#{Ecto.UUID.generate()}@example.com"}, [
        {%{plan: :family_4, name: "Family Double Tap"}, :owner}
      ])

    [owner_membership] = owner.memberships
    email = "double_tap_#{Ecto.UUID.generate()}@example.com"

    {:ok, %{token: token, membership_id: membership_id}} =
      AccountsMembership.invite(owner_membership.account, owner_membership, email)

    stub = Repo.get_by!(User, email: email)

    on_exit(fn ->
      Repo.put_dynamic_repo(repo)
      account_id = owner_membership.account_id
      Repo.delete_all(from(m in AccountMembership, where: m.account_id == ^account_id))
      Repo.delete_all(from(u in User, where: u.id in ^[owner.id, stub.id]))
      Repo.delete_all(from(a in Account, where: a.id == ^account_id))
    end)

    {:ok, repo: repo, token: token, membership_id: membership_id, stub: stub}
  end

  # A double tap: the first accept holds the invite and the stub while it
  # commits. The second one has to wait for it and then see a used invite.
  test "an accept that waits on a concurrent accept answers invite_token_used", f do
    parent = self()

    first =
      Task.async(fn ->
        Repo.put_dynamic_repo(f.repo)

        Repo.transaction(fn ->
          {:ok, membership_id} = Ecto.UUID.dump(f.membership_id)
          {:ok, stub_id} = Ecto.UUID.dump(f.stub.id)

          Repo.query!(
            "UPDATE account_memberships SET status = 'active', joined_at = now() WHERE id = $1",
            [membership_id]
          )

          Repo.query!(
            "UPDATE users SET name = 'First Tap', invite_stub = false WHERE id = $1",
            [stub_id]
          )

          send(parent, :first_holds_locks)

          receive do
            :commit -> :ok
          after
            5000 -> raise "first accept was never released"
          end
        end)
      end)

    assert_receive :first_holds_locks, 5000

    second =
      Task.async(fn ->
        Repo.put_dynamic_repo(f.repo)
        AccountsMembership.accept_invite(f.token, %{name: "Second Tap"})
      end)

    # The second accept is blocked behind the first one's row locks.
    refute Task.yield(second, 300)

    send(first.pid, :commit)
    assert {:ok, :ok} = Task.await(first, 5000)

    assert {:error, :invite_token_used} = Task.await(second, 5000)
    assert Repo.get!(User, f.stub.id).name == "First Tap"
  end
end
