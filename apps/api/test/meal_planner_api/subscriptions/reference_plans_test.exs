# Migrations are not compiled with the application, so the one under test is
# loaded here, before the test module that calls it is compiled. Another test
# may have loaded it already; loading the file twice would redefine the module.
unless Code.ensure_loaded?(MealPlannerApi.Repo.Migrations.SeedIndividualAndFamily4Plans) do
  Code.require_file(
    Path.expand(
      "../../../priv/repo/migrations/20261008120000_seed_individual_and_family_4_plans.exs",
      __DIR__
    )
  )
end

defmodule MealPlannerApi.Subscriptions.ReferencePlansTest do
  @moduledoc """
  The `individual` and `family_4` reference Plans that migration
  `20261008120000` inserts. Sign-up attaches every new Account to the
  `individual` Plan, so a database without that row cannot register anyone.

  The two groups of tests answer different questions:

    * "the migration's insert" calls the function the migration's `up/0`
      runs, on a `subscription_plans` table these tests arrange themselves
      inside the sandbox transaction. They do not depend on what the database
      held before, so they fail whenever the insert is wrong.
    * "a migrated database" reads what the database holds. That depends on
      its history: the suites that run outside the sandbox (the concurrency
      tests) commit the fixture rows, so after one full `mix test` run these
      tests pass whatever the migrations do. They only prove the migrations
      on a database no full run has touched yet.

  This module must never call `MealPlannerApi.SubscriptionPlanFixtures` (or
  use a case template that does, such as `ConnCase`): the fixtures insert the
  very rows under test.

  It stays `async: false`: the tests delete Plan rows that concurrent tests
  update in their own transactions.
  """
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Accounts
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Repo.Migrations.SeedIndividualAndFamily4Plans
  alias MealPlannerApi.Subscriptions
  alias MealPlannerApi.Subscriptions.Plan

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  describe "the migration's insert" do
    setup do
      # No Account exists inside a fresh sandbox transaction, so nothing
      # restricts the delete.
      Repo.delete_all(from(p in Plan, where: p.name in ["individual", "family_4"]))
      :ok
    end

    test "inserts the individual and family_4 Plans into a table that lacks them" do
      SeedIndividualAndFamily4Plans.insert_plans(Repo)

      assert %Plan{max_users: 1, max_planning_days: 7, revenuecat_entitlement_id: nil} =
               Repo.get_by(Plan, name: "individual")

      assert %Plan{max_users: 4, max_planning_days: 7, revenuecat_entitlement_id: nil} =
               Repo.get_by(Plan, name: "family_4")
    end

    test "running it again keeps the rows it inserted" do
      SeedIndividualAndFamily4Plans.insert_plans(Repo)
      inserted = plan_ids()
      assert map_size(inserted) == 2

      SeedIndividualAndFamily4Plans.insert_plans(Repo)

      assert plan_ids() == inserted
    end

    test "leaves a Plan that already exists with other limits as it is" do
      # What an environment that got its rows from other seeds would hold.
      existing =
        Repo.insert!(%Plan{
          name: "individual",
          max_users: 3,
          max_planning_days: 14,
          revenuecat_entitlement_id: "individual_custom"
        })

      SeedIndividualAndFamily4Plans.insert_plans(Repo)

      assert %Plan{
               id: id,
               max_users: 3,
               max_planning_days: 14,
               revenuecat_entitlement_id: "individual_custom"
             } = Repo.get_by(Plan, name: "individual")

      assert id == existing.id
      assert %Plan{max_users: 4} = Repo.get_by(Plan, name: "family_4")
    end
  end

  describe "a migrated database" do
    test "holds the individual Plan" do
      assert %Plan{max_users: 1, max_planning_days: 7, revenuecat_entitlement_id: nil} =
               Repo.get_by(Plan, name: "individual")
    end

    test "holds the family_4 Plan" do
      assert %Plan{max_users: 4, max_planning_days: 7, revenuecat_entitlement_id: nil} =
               Repo.get_by(Plan, name: "family_4")
    end

    test "registers a new email" do
      assert {:ok, %{user: user, account: account}} =
               Accounts.register_with_verified_email("reference-plans@example.com")

      assert user.email == "reference-plans@example.com"
      assert account.plan == :individual

      assert {:ok, %Plan{id: plan_id}} = Subscriptions.get_plan_by_name("individual")
      assert account.subscription_plan_id == plan_id
    end
  end

  # The ids of the two Plans the migration inserts, by name.
  defp plan_ids do
    from(p in Plan, where: p.name in ["individual", "family_4"], select: {p.name, p.id})
    |> Repo.all()
    |> Map.new()
  end
end
