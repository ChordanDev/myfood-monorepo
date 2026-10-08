defmodule MealPlannerApi.Persistence.AccountsTest do
  @moduledoc """
  `Accounts.update_user_profile/2`: the Onboarding profile write (issue #17).
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts
  alias MealPlannerApi.Persistence.Accounts.User
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
end
