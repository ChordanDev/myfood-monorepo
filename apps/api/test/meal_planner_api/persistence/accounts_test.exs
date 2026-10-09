defmodule MealPlannerApi.Persistence.AccountsTest do
  @moduledoc """
  `Accounts.update_user_profile/2`: the Onboarding profile write (issue #17).
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts
  alias MealPlannerApi.Persistence.Accounts.{Account, User}
  alias MealPlannerApi.Repo

  @profile %{name: "Ana", household_size: 4, cooking_skill: "intermediate"}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    user =
      user_with_memberships(%{email: "accounts_profile@example.com", name: "Stored Name"}, [
        {%{plan: :individual, name: "Accounts Profile"}, :owner}
      ])

    %{user: user}
  end

  describe "update_user_profile/2" do
    test "stores the profile on the User with that id", %{user: user} do
      assert {:ok, %User{} = updated} = Accounts.update_user_profile(user.id, @profile)

      assert %User{name: "Ana", household_size: 4, cooking_skill: "intermediate"} = updated
      assert Repo.get!(User, user.id) == updated
    end

    test "returns the changeset and stores nothing when the profile is invalid", %{user: user} do
      stored = Repo.get!(User, user.id)

      assert {:error, %Ecto.Changeset{valid?: false} = changeset} =
               Accounts.update_user_profile(user.id, %{@profile | household_size: 21})

      assert Keyword.keys(changeset.errors) == [:household_size]
      assert Repo.get!(User, user.id) == stored
    end

    test "returns :user_not_found for an id with no User" do
      assert Accounts.update_user_profile(Ecto.UUID.generate(), @profile) ==
               {:error, :user_not_found}
    end
  end

  describe "update_account_timezone/2" do
    test "stores the zone on the Account with that id", %{user: user} do
      [membership] = user.memberships

      assert {:ok, %Account{timezone: "Asia/Tokyo"}} =
               Accounts.update_account_timezone(membership.account_id, "Asia/Tokyo")

      assert Repo.get!(Account, membership.account_id).timezone == "Asia/Tokyo"
    end

    test "rejects an unknown zone and stores nothing", %{user: user} do
      [membership] = user.memberships

      assert {:error, %Ecto.Changeset{errors: [timezone: _]}} =
               Accounts.update_account_timezone(membership.account_id, "Mars/Olympus")

      assert Repo.get!(Account, membership.account_id).timezone == nil
    end

    test "answers :account_not_found for an unknown id" do
      assert {:error, :account_not_found} =
               Accounts.update_account_timezone(Ecto.UUID.generate(), "Asia/Tokyo")
    end
  end
end
