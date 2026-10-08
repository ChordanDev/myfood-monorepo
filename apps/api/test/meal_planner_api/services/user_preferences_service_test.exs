defmodule MealPlannerApi.Services.UserPreferencesServiceTest do
  @moduledoc """
  What `preferences_controller_test.exs` cannot reach through HTTP: a save
  of `MealPlannerApi.Services.UserPreferencesService` that fails half way.

  `validate/1` refuses a Hard restriction outside the catalog before
  anything is written, so the failing save is handed to `replace/2` directly.
  """
  use ExUnit.Case, async: true

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Data.UserHardRestrictionRepo
  alias MealPlannerApi.Persistence.Accounts.{UserDietaryProfile, UserPreference}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.UserPreferencesService

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    user =
      user_with_memberships(%{email: "preferences_service@example.com"}, [
        {%{plan: :individual, name: "Preferences service"}, :owner}
      ])

    %{user: user}
  end

  describe "replace/2" do
    test "a save that fails on a later step keeps nothing of the earlier ones", %{user: user} do
      assert {:error, _reason} =
               UserPreferencesService.replace(user.id, %{
                 diet: "vegan",
                 hard_restrictions: ["gluten", "sesame"],
                 soft_preferences: ["no cilantro"]
               })

      assert Repo.get_by(UserDietaryProfile, user_id: user.id) == nil
      assert UserHardRestrictionRepo.list_codes(user.id) == []
      assert Repo.get_by(UserPreference, user_id: user.id) == nil
    end

    test "a failed save leaves the stored preferences as they were", %{user: user} do
      saved = %{diet: "vegetarian", hard_restrictions: ["dairy"], soft_preferences: ["no oats"]}

      assert UserPreferencesService.replace(user.id, saved) == {:ok, saved}

      assert {:error, _reason} =
               UserPreferencesService.replace(user.id, %{
                 diet: nil,
                 hard_restrictions: ["sesame"],
                 soft_preferences: []
               })

      assert UserPreferencesService.get(user.id) == saved
    end
  end
end
