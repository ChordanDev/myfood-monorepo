defmodule MealPlannerApi.Persistence.IdempotencyConcurrencyTest do
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership, User}
  alias MealPlannerApi.Persistence.Idempotency
  alias MealPlannerApi.Repo

  @moduletag :runtime_db_concurrency
  unless MealPlannerApi.Issue38Database.enabled?() do
    @moduletag skip: "requires test/support/issue38_concurrency_runner.exs and a fresh database"
  end

  @endpoint "test.concurrent_mutation"

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

    user =
      user_with_memberships(%{email: "idempotency_#{Ecto.UUID.generate()}@example.com"}, [
        {%{plan: :family_4, name: "Idempotency Race"}, :owner}
      ])

    [membership] = user.memberships
    account_id = membership.account_id

    on_exit(fn ->
      Repo.put_dynamic_repo(repo)
      Repo.delete_all(from(m in AccountMembership, where: m.account_id == ^account_id))
      Repo.delete_all(from(u in User, where: u.id == ^user.id))
      # Its idempotency keys go with it.
      Repo.delete_all(from(a in Account, where: a.id == ^account_id))
    end)

    {:ok, repo: repo, account_id: account_id}
  end

  # A retry that reaches the API while the first request still runs: it waits
  # on the first one's key and replays its response once it commits.
  test "a request racing an uncommitted one with the same key replays its response", f do
    first = hold_key(f, {:ok, %{"by" => "first"}})

    second =
      Task.async(fn ->
        Repo.put_dynamic_repo(f.repo)
        Idempotency.run(f.account_id, @endpoint, "race", fn -> {:ok, %{"by" => "second"}} end)
      end)

    refute Task.yield(second, 300)

    send(first.pid, :release)
    assert {:ok, %{"by" => "first"}} = Task.await(first, 5000)
    assert {:ok, %{"by" => "first"}} = Task.await(second, 5000)
  end

  # The first request failed and stored nothing: the waiting one runs.
  test "a request racing one that rolls back runs its own mutation", f do
    first = hold_key(f, {:error, :boom})

    second =
      Task.async(fn ->
        Repo.put_dynamic_repo(f.repo)
        Idempotency.run(f.account_id, @endpoint, "race", fn -> {:ok, %{"by" => "second"}} end)
      end)

    refute Task.yield(second, 300)

    send(first.pid, :release)
    assert {:error, :boom} = Task.await(first, 5000)
    assert {:ok, %{"by" => "second"}} = Task.await(second, 5000)
  end

  # Claims the key and holds it, uncommitted, until released; then answers
  # `result`.
  defp hold_key(f, result) do
    parent = self()

    task =
      Task.async(fn ->
        Repo.put_dynamic_repo(f.repo)

        Idempotency.run(f.account_id, @endpoint, "race", fn ->
          send(parent, :holding_key)

          receive do
            :release -> result
          after
            5000 -> raise "the first request was never released"
          end
        end)
      end)

    assert_receive :holding_key, 5000
    task
  end
end
