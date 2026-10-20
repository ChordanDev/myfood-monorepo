defmodule MealPlannerApi.Services.BudgetServiceTest do
  @moduledoc """
  The Account's weekly Budget as a member reads it and as the owner sets it
  (issue #271): the resolved value, whether it is the tier default, and the
  floor of the per-person minimum times the owner's Household size.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership, User}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.BudgetService

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    previous = Application.get_env(:meal_planner_api, :min_weekly_budget_per_person_cents)

    on_exit(fn ->
      Application.put_env(:meal_planner_api, :min_weekly_budget_per_person_cents, previous)
    end)

    owner =
      user_with_memberships(%{email: "budget_owner@example.com"}, [
        {%{plan: :family_4, name: "Budget Account"}, :owner}
      ])

    [owner_membership] = owner.memberships
    member_membership = add_member!(owner_membership.account_id)

    %{owner: owner, owner_membership: owner_membership, member_membership: member_membership}
  end

  describe "weekly_budget/1" do
    test "an Account that never set its Budget reads the tier default", %{
      owner_membership: membership
    } do
      put_per_person_floor(0)

      assert BudgetService.weekly_budget(membership.account_id) ==
               {:ok,
                %{
                  weekly_budget_cents: 45_000,
                  is_default: true,
                  min_weekly_budget_cents: 0,
                  currency: "ARS"
                }}
    end

    test "a stored Budget is not the default", %{owner_membership: membership} do
      put_per_person_floor(0)
      store_budget!(membership.account_id, 52_000)

      assert {:ok, %{weekly_budget_cents: 52_000, is_default: false}} =
               BudgetService.weekly_budget(membership.account_id)
    end

    test "the minimum is the per-person floor times the owner's Household size", %{
      owner: owner,
      owner_membership: membership,
      member_membership: member_membership
    } do
      put_per_person_floor(10_000)
      set_household_size!(owner.id, 4)
      # A member's own Household size does not move the floor.
      set_household_size!(member_membership.user_id, 9)

      assert {:ok, %{min_weekly_budget_cents: 40_000}} =
               BudgetService.weekly_budget(membership.account_id)
    end

    test "an owner with no Household size counts as one person", %{
      owner_membership: membership
    } do
      put_per_person_floor(10_000)

      assert {:ok, %{min_weekly_budget_cents: 10_000}} =
               BudgetService.weekly_budget(membership.account_id)
    end

    test "an unknown Account is not found" do
      assert BudgetService.weekly_budget(Ecto.UUID.generate()) == {:error, :account_not_found}
    end
  end

  describe "update_weekly_budget/2" do
    test "the owner stores an amount at the floor", %{
      owner: owner,
      owner_membership: membership
    } do
      put_per_person_floor(10_000)
      set_household_size!(owner.id, 3)

      assert {:ok, %{weekly_budget_cents: 30_000, is_default: false}} =
               BudgetService.update_weekly_budget(membership, 30_000)

      assert Repo.get!(Account, membership.account_id).default_budget_cents == 30_000
      assert BudgetService.weekly_limit_cents(membership.account_id) == 30_000
    end

    test "an amount below the floor is refused and nothing is stored", %{
      owner: owner,
      owner_membership: membership
    } do
      put_per_person_floor(10_000)
      set_household_size!(owner.id, 3)

      assert BudgetService.update_weekly_budget(membership, 29_999) ==
               {:error, :invalid_amount}

      assert Repo.get!(Account, membership.account_id).default_budget_cents == 0
    end

    for {label, amount} <- [
          {"zero", 0},
          {"a negative amount", -1},
          {"a float", 500.5},
          {"a string", "50000"},
          {"a boolean", true},
          {"nil", nil},
          {"an amount past the column range", 2_147_483_648}
        ] do
      test "#{label} is refused even with no floor", %{owner_membership: membership} do
        put_per_person_floor(0)

        assert BudgetService.update_weekly_budget(membership, unquote(Macro.escape(amount))) ==
                 {:error, :invalid_amount}

        assert Repo.get!(Account, membership.account_id).default_budget_cents == 0
      end
    end

    test "a member who is not the owner cannot change it", %{
      member_membership: membership
    } do
      put_per_person_floor(0)

      assert BudgetService.update_weekly_budget(membership, 50_000) == {:error, :not_owner}
      assert Repo.get!(Account, membership.account_id).default_budget_cents == 0
    end

    test "a member is refused before the amount is checked", %{member_membership: membership} do
      put_per_person_floor(0)

      assert BudgetService.update_weekly_budget(membership, -1) == {:error, :not_owner}
    end
  end

  defp put_per_person_floor(cents),
    do: Application.put_env(:meal_planner_api, :min_weekly_budget_per_person_cents, cents)

  defp store_budget!(account_id, cents) do
    Account
    |> Repo.get!(account_id)
    |> Ecto.Changeset.change(default_budget_cents: cents)
    |> Repo.update!()
  end

  defp set_household_size!(user_id, size) do
    User
    |> Repo.get!(user_id)
    |> Ecto.Changeset.change(household_size: size)
    |> Repo.update!()
  end

  defp add_member!(account_id) do
    user =
      %User{}
      |> User.changeset(%{
        email: "budget_member_#{System.unique_integer([:positive])}@example.com",
        name: "Budget Member",
        role: :member
      })
      |> Repo.insert!()

    %AccountMembership{}
    |> AccountMembership.changeset(%{
      account_id: account_id,
      user_id: user.id,
      role: :member,
      status: :active,
      joined_at: DateTime.utc_now()
    })
    |> Repo.insert!()
  end
end
