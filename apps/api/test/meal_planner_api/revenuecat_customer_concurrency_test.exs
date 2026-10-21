defmodule MealPlannerApi.RevenuecatCustomerConcurrencyTest do
  @moduledoc """
  Concurrent first calls that issue an Account's RevenueCat `app_user_id`
  (issue #412). Every member of an Account may open the app at once and
  call `GET /billing/revenuecat/status`; they must all end with the same
  `app_user_id` and the Account with one `RevenuecatCustomer` row, or a
  webhook would link to an id no member logs RevenueCat in with.
  """
  use ExUnit.Case, async: false

  import Ecto.Query

  alias MealPlannerApi.Persistence.Accounts, as: AccountsPersistence
  alias MealPlannerApi.Persistence.Accounts.{Account, RevenuecatCustomer}
  alias MealPlannerApi.Repo

  @moduletag :runtime_db_concurrency
  unless MealPlannerApi.Issue38Database.enabled?() do
    @moduletag skip: "requires test/support/issue38_concurrency_runner.exs and a fresh database"
  end

  @callers 4

  setup_all do
    repo =
      start_supervised!(
        {Repo,
         name: nil,
         database: MealPlannerApi.Issue38Database.database!(),
         pool: DBConnection.ConnectionPool,
         pool_size: @callers,
         timeout: 10_000,
         parameters: [lock_timeout: "3000", statement_timeout: "8000"]}
      )

    {:ok, repo: repo}
  end

  setup %{repo: repo} do
    Repo.put_dynamic_repo(repo)

    account =
      %Account{}
      |> Account.changeset(%{
        name: "RC concurrent #{Ecto.UUID.generate()}",
        plan: :individual,
        default_budget_cents: 0
      })
      |> Repo.insert!()

    on_exit(fn ->
      Repo.put_dynamic_repo(repo)
      Repo.delete_all(from(c in RevenuecatCustomer, where: c.account_id == ^account.id))
      Repo.delete_all(from(a in Account, where: a.id == ^account.id))
    end)

    {:ok, account: account}
  end

  test "concurrent first calls end with one row and the same app_user_id",
       %{repo: repo, account: account} do
    test_pid = self()

    tasks =
      for _ <- 1..@callers do
        Task.async(fn ->
          Repo.put_dynamic_repo(repo)
          send(test_pid, {:ready, self()})

          receive do
            :go -> AccountsPersistence.ensure_revenuecat_customer(account.id)
          after
            5000 -> raise "the callers were never released"
          end
        end)
      end

    pids =
      for _ <- 1..@callers do
        receive do
          {:ready, pid} -> pid
        after
          5000 -> flunk("a caller never started")
        end
      end

    Enum.each(pids, &send(&1, :go))

    results = Task.await_many(tasks, 10_000)

    app_user_ids =
      Enum.map(results, fn {:ok, %RevenuecatCustomer{rc_app_user_id: id}} -> id end)

    assert [app_user_id] = Enum.uniq(app_user_ids)
    assert {:ok, ^app_user_id} = Ecto.UUID.cast(app_user_id)

    assert Repo.aggregate(
             from(c in RevenuecatCustomer, where: c.account_id == ^account.id),
             :count
           ) == 1
  end
end
