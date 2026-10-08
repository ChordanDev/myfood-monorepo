defmodule MealPlannerApi.Subscriptions.ReferencePlansTest do
  @moduledoc """
  The reference Plans a database holds after running only the migrations.

  Sign-up attaches every new Account to the `individual` Plan, so a migrated
  database that lacks that row cannot register anyone.

  This module must never call `MealPlannerApi.SubscriptionPlanFixtures` (or
  use a case template that does, such as `ConnCase`): the fixtures insert the
  very rows under test, and with them these tests would pass on a database
  whose migrations insert nothing.

  The suites that run outside the sandbox (the concurrency tests) commit the
  fixture rows, so a database that has been through a full `mix test` run
  holds them whatever the migrations do. These tests only prove the
  migrations on a database no full run has touched yet.
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Accounts
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Subscriptions
  alias MealPlannerApi.Subscriptions.Plan

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  test "migrations insert the individual Plan" do
    assert %Plan{max_users: 1, max_planning_days: 7, revenuecat_entitlement_id: nil} =
             Repo.get_by(Plan, name: "individual")
  end

  test "migrations insert the family_4 Plan" do
    assert %Plan{max_users: 4, max_planning_days: 7, revenuecat_entitlement_id: nil} =
             Repo.get_by(Plan, name: "family_4")
  end

  test "a new email registers on a database that only ran migrations" do
    assert {:ok, %{user: user, account: account}} =
             Accounts.register_with_verified_email("reference-plans@example.com")

    assert user.email == "reference-plans@example.com"
    assert account.plan == :individual

    assert {:ok, %Plan{id: plan_id}} = Subscriptions.get_plan_by_name("individual")
    assert account.subscription_plan_id == plan_id
  end
end
