defmodule MealPlannerApi.SocialLoginConcurrencyTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias MealPlannerApi.Auth.SocialVerifierFake
  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership, User}
  alias MealPlannerApi.Persistence.Auth.SocialIdentity
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.SocialLogin

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
    email = "social_race_#{Ecto.UUID.generate()}@example.com"

    on_exit(fn ->
      Repo.put_dynamic_repo(repo)
      user_ids = Repo.all(from(u in User, where: u.email == ^email, select: u.id))

      account_ids =
        Repo.all(
          from(m in AccountMembership, where: m.user_id in ^user_ids, select: m.account_id)
        )

      Repo.delete_all(from(i in SocialIdentity, where: i.user_id in ^user_ids))
      Repo.delete_all(from(m in AccountMembership, where: m.account_id in ^account_ids))
      Repo.delete_all(from(u in User, where: u.id in ^user_ids))
      Repo.delete_all(from(a in Account, where: a.id in ^account_ids))
    end)

    {:ok, repo: repo, email: email, subject: "sub-#{Ecto.UUID.generate()}"}
  end

  # Two first sign-ins of one provider account: the first holds its locks
  # while it opens the session, so the second has to wait for it and then
  # find the link it wrote.
  test "two first sign-ins of one provider account register one User", f do
    first = hold_sign_in(f, "google", f.subject)
    second = sign_in(f, "google", f.subject)

    refute Task.yield(second, 300)

    send(first.pid, :commit)
    assert {:ok, first_user_id} = Task.await(first, 5000)
    assert {:ok, ^first_user_id} = Task.await(second, 5000)

    assert [%User{id: ^first_user_id}] = Repo.all(from(u in User, where: u.email == ^f.email))

    assert [%SocialIdentity{provider: "google", user_id: ^first_user_id}] =
             Repo.all(from(i in SocialIdentity, where: i.subject == ^f.subject))
  end

  # A Google and an Apple first sign-in with one new email take different
  # provider account locks, so only the email lock makes the second one
  # wait and link to the User the first one registered.
  test "a Google and an Apple first sign-in with one new email share one User", f do
    apple_subject = "apple-#{f.subject}"
    first = hold_sign_in(f, "google", f.subject)
    second = sign_in(f, "apple", apple_subject)

    refute Task.yield(second, 300)

    send(first.pid, :commit)
    assert {:ok, user_id} = Task.await(first, 5000)
    assert {:ok, ^user_id} = Task.await(second, 5000)

    assert [%User{id: ^user_id}] = Repo.all(from(u in User, where: u.email == ^f.email))

    identities =
      Repo.all(
        from(i in SocialIdentity,
          where: i.user_id == ^user_id,
          select: {i.provider, i.subject}
        )
      )

    assert Enum.sort(identities) == [{"apple", apple_subject}, {"google", f.subject}]
  end

  # Signs in and stays inside the transaction, holding its locks, until
  # the test sends `:commit`.
  defp hold_sign_in(f, provider, subject) do
    parent = self()

    task =
      Task.async(fn ->
        Repo.put_dynamic_repo(f.repo)
        answer(provider, subject, f.email)

        SocialLogin.sign_in(provider, "token", fn user, _membership ->
          send(parent, :first_holds_locks)

          receive do
            :commit -> {:ok, user.id}
          after
            5000 -> raise "first sign-in was never released"
          end
        end)
      end)

    assert_receive :first_holds_locks, 5000
    task
  end

  defp sign_in(f, provider, subject) do
    Task.async(fn ->
      Repo.put_dynamic_repo(f.repo)
      answer(provider, subject, f.email)
      SocialLogin.sign_in(provider, "token", fn user, _membership -> {:ok, user.id} end)
    end)
  end

  defp answer(provider, subject, email) do
    SocialVerifierFake.answer(
      {:ok, %{provider: provider, subject: subject, email: email, email_verified: true}}
    )
  end
end
