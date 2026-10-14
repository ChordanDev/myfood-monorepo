defmodule MealPlannerApi.Services.PlanningContextTest do
  @moduledoc """
  The Planning context (issue #29): what `assemble/1` makes of the signals
  already read, and what `read/3` loads for a User, favorites included.
  """
  use ExUnit.Case, async: true

  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.Generation.ServerTestFixtures, only: [insert_recipe: 2]

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Data.{AccountRepo, RecipeRepo}
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.{PlanningContext, UserPreferencesService}

  @keys ~w(cookingSkill diet favoriteRecipeIds hardRestrictionCodes householdSize
           slotCookingTimes softPreferences)

  @no_constraint %{"cooking" => "no_constraint", "maxMinutes" => nil, "hungerLevel" => nil}

  describe "assemble/1" do
    test "carries every signal under camelCase string keys" do
      context =
        PlanningContext.assemble(%{
          preferences: %{
            diet: "vegetarian",
            hard_restrictions: ["gluten", "peanut"],
            soft_preferences: ["quick_meals"]
          },
          user: %User{cooking_skill: "intermediate", household_size: 3},
          slot_cooking_times: [
            %{slot: :breakfast, cooking_time_minutes: 15, hunger_level: :light},
            %{slot: :lunch, cooking_time_minutes: 0, hunger_level: :normal},
            %{slot: :dinner, cooking_time_minutes: 45, hunger_level: :strong}
          ],
          favorite_recipe_ids: ["recipe-a", "recipe-b"]
        })

      assert context == %{
               "diet" => "vegetarian",
               "hardRestrictionCodes" => ["gluten", "peanut"],
               "softPreferences" => ["quick_meals"],
               "cookingSkill" => "intermediate",
               "householdSize" => 3,
               "slotCookingTimes" => %{
                 "breakfast" => limited(15, "light"),
                 "lunch" => %{
                   "cooking" => "do_not_cook",
                   "maxMinutes" => 0,
                   "hungerLevel" => "normal"
                 },
                 "snack" => @no_constraint,
                 "dinner" => limited(45, "strong")
               },
               "favoriteRecipeIds" => ["recipe-a", "recipe-b"]
             }
    end

    test "a User with nothing set still gets every key" do
      context =
        PlanningContext.assemble(%{
          preferences: %{diet: nil, hard_restrictions: [], soft_preferences: []},
          user: nil,
          slot_cooking_times: [],
          favorite_recipe_ids: []
        })

      assert context |> Map.keys() |> Enum.sort() == @keys
      assert context["diet"] == nil
      assert context["cookingSkill"] == nil
      assert context["householdSize"] == nil
      assert context["hardRestrictionCodes"] == []
      assert context["softPreferences"] == []
      assert context["favoriteRecipeIds"] == []
    end

    test "a User with no profile data has null skill and household size" do
      context =
        PlanningContext.assemble(%{
          preferences: %{diet: "vegan", hard_restrictions: [], soft_preferences: []},
          user: %User{cooking_skill: nil, household_size: nil},
          slot_cooking_times: [],
          favorite_recipe_ids: []
        })

      assert context["diet"] == "vegan"
      assert context["cookingSkill"] == nil
      assert context["householdSize"] == nil
    end

    test "no stored time leaves all four slots with no constraint" do
      times = assemble_times([])

      assert times |> Map.keys() |> Enum.sort() == ["breakfast", "dinner", "lunch", "snack"]
      assert Enum.all?(Map.values(times), &(&1 == @no_constraint))
    end

    test "a partial set constrains only the stored slots" do
      times = assemble_times([%{slot: :dinner, cooking_time_minutes: 20, hunger_level: :strong}])

      assert times["dinner"] == limited(20, "strong")
      assert times["breakfast"] == @no_constraint
      assert times["lunch"] == @no_constraint
      assert times["snack"] == @no_constraint
    end

    test "the snack has no constraint even if a row names it" do
      times = assemble_times([%{slot: :snack, cooking_time_minutes: 10, hunger_level: :light}])

      assert times["snack"] == @no_constraint
    end

    test "a stored 0 is do_not_cook and any other minutes are limited" do
      times =
        assemble_times([
          %{slot: :breakfast, cooking_time_minutes: 0, hunger_level: :light},
          %{slot: :lunch, cooking_time_minutes: 1, hunger_level: :normal},
          %{slot: :dinner, cooking_time_minutes: 240, hunger_level: :strong}
        ])

      assert %{"cooking" => "do_not_cook", "maxMinutes" => 0} = times["breakfast"]
      assert %{"cooking" => "limited", "maxMinutes" => 1} = times["lunch"]
      assert %{"cooking" => "limited", "maxMinutes" => 240} = times["dinner"]
    end

    test "the output survives a JSON round trip unchanged" do
      context =
        PlanningContext.assemble(%{
          preferences: %{diet: "vegan", hard_restrictions: ["gluten"], soft_preferences: []},
          user: %User{cooking_skill: "beginner", household_size: 2},
          slot_cooking_times: [%{slot: :breakfast, cooking_time_minutes: 5, hunger_level: :light}],
          favorite_recipe_ids: []
        })

      assert context |> Jason.encode!() |> Jason.decode!() == context
    end
  end

  describe "read/3" do
    setup do
      :ok = Sandbox.checkout(Repo)
      :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

      user =
        user_with_memberships(%{email: "planning_context@example.com", name: "Context"}, [
          {%{plan: :individual, name: "Planning context"}, :owner}
        ])

      %{user: user, account: user.memberships |> hd() |> Map.fetch!(:account)}
    end

    test "a User who set nothing gets a context with every key", %{user: user, account: account} do
      context = PlanningContext.read(account.id, user.id, [])

      assert context |> Map.keys() |> Enum.sort() == @keys
      assert context["diet"] == nil
      assert context["hardRestrictionCodes"] == []
      assert context["softPreferences"] == []
      assert context["cookingSkill"] == nil
      assert context["householdSize"] == nil
      assert context["favoriteRecipeIds"] == []
      assert Enum.all?(Map.values(context["slotCookingTimes"]), &(&1 == @no_constraint))
    end

    test "reads the preferences, the profile and the Slot cooking times", %{
      user: user,
      account: account
    } do
      {:ok, _preferences} =
        UserPreferencesService.replace(user.id, %{
          diet: "vegetarian",
          hard_restrictions: ["gluten", "peanut"],
          soft_preferences: ["quick_meals"]
        })

      set_profile!(user, 3, "intermediate")

      {:ok, _rows} =
        AccountRepo.replace_slot_cooking_times(user.id, %{
          breakfast: %{cooking_time_minutes: 15, hunger_level: :light},
          lunch: %{cooking_time_minutes: 0, hunger_level: :normal},
          dinner: %{cooking_time_minutes: 45, hunger_level: :strong}
        })

      context = PlanningContext.read(account.id, user.id, [])

      assert context["diet"] == "vegetarian"
      assert Enum.sort(context["hardRestrictionCodes"]) == ["gluten", "peanut"]
      assert context["softPreferences"] == ["quick_meals"]
      assert context["cookingSkill"] == "intermediate"
      assert context["householdSize"] == 3

      assert context["slotCookingTimes"] == %{
               "breakfast" => limited(15, "light"),
               "lunch" => %{
                 "cooking" => "do_not_cook",
                 "maxMinutes" => 0,
                 "hungerLevel" => "normal"
               },
               "snack" => @no_constraint,
               "dinner" => limited(45, "strong")
             }
    end

    test "reads the profile fresh, not from a struct the caller holds", %{
      user: user,
      account: account
    } do
      stale = user
      set_profile!(user, 4, "advanced")

      assert stale.household_size == nil

      context = PlanningContext.read(account.id, user.id, [])

      assert context["householdSize"] == 4
      assert context["cookingSkill"] == "advanced"
    end

    test "a partial set of Slot cooking times still gives a context", %{
      user: user,
      account: account
    } do
      insert_time!(user, "lunch", 25, "normal")

      times = PlanningContext.read(account.id, user.id, [])["slotCookingTimes"]

      assert times["lunch"] == limited(25, "normal")
      assert times["breakfast"] == @no_constraint
      assert times["snack"] == @no_constraint
      assert times["dinner"] == @no_constraint
    end

    test "keeps the favorites the client names, in the client's order", %{
      user: user,
      account: account
    } do
      [first, second, third] = favorites!(account, user, ~w(Soup Stew Salad))

      context = PlanningContext.read(account.id, user.id, [third.id, first.id, second.id])

      assert context["favoriteRecipeIds"] == [third.id, first.id, second.id]
    end

    test "a favorite the client does not name is not added", %{user: user, account: account} do
      [first, _second] = favorites!(account, user, ~w(Soup Stew))

      assert PlanningContext.read(account.id, user.id, [first.id])["favoriteRecipeIds"] ==
               [first.id]
    end

    test "drops an id that is no recipe or no favorite of the caller", %{
      user: user,
      account: account
    } do
      [mine] = favorites!(account, user, ["Soup"])
      not_a_favorite = insert_recipe("Not starred", account_id: account.id)

      context =
        PlanningContext.read(account.id, user.id, [
          Ecto.UUID.generate(),
          not_a_favorite.id,
          "not-a-uuid",
          mine.id
        ])

      assert context["favoriteRecipeIds"] == [mine.id]
    end

    test "drops a favorite of another User of the Account", %{user: user, account: account} do
      peer = user_with_memberships(%{email: "planning_context_peer@example.com"}, [])
      recipe = insert_recipe("Peer soup", account_id: account.id)

      {:ok, _favorite} =
        RecipeRepo.add_favorite(%{account_id: account.id, user_id: peer.id}, recipe.id)

      assert PlanningContext.read(account.id, user.id, [recipe.id])["favoriteRecipeIds"] == []
    end

    test "drops a favorite of the same User in another Account", %{user: user, account: account} do
      other =
        user_with_memberships(%{email: "planning_context_other@example.com"}, [
          {%{plan: :individual, name: "Other account"}, :owner}
        ])

      other_account = other.memberships |> hd() |> Map.fetch!(:account)
      recipe = insert_recipe("Other soup", account_id: other_account.id)

      {:ok, _favorite} =
        RecipeRepo.add_favorite(%{account_id: other_account.id, user_id: user.id}, recipe.id)

      assert PlanningContext.read(account.id, user.id, [recipe.id])["favoriteRecipeIds"] == []
    end

    test "collapses a repeated id onto its first place", %{user: user, account: account} do
      [first, second] = favorites!(account, user, ~w(Soup Stew))

      context =
        PlanningContext.read(account.id, user.id, [second.id, first.id, second.id, first.id])

      assert context["favoriteRecipeIds"] == [second.id, first.id]
    end
  end

  defp limited(minutes, hunger_level),
    do: %{"cooking" => "limited", "maxMinutes" => minutes, "hungerLevel" => hunger_level}

  defp assemble_times(rows) do
    context =
      PlanningContext.assemble(%{
        preferences: %{diet: nil, hard_restrictions: [], soft_preferences: []},
        user: nil,
        slot_cooking_times: rows,
        favorite_recipe_ids: []
      })

    context["slotCookingTimes"]
  end

  defp set_profile!(user, household_size, cooking_skill) do
    user
    |> User.profile_changeset(%{
      name: user.name,
      household_size: household_size,
      cooking_skill: cooking_skill
    })
    |> Repo.update!()
  end

  defp favorites!(account, user, names) do
    for name <- names do
      recipe = insert_recipe(name, account_id: account.id)

      {:ok, _favorite} =
        RecipeRepo.add_favorite(%{account_id: account.id, user_id: user.id}, recipe.id)

      recipe
    end
  end

  defp insert_time!(user, slot, minutes, hunger_level) do
    Repo.query!(
      """
      INSERT INTO user_slot_cooking_times
        (id, user_id, slot, cooking_time_minutes, hunger_level, inserted_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
      """,
      [Ecto.UUID.dump!(user.id), slot, minutes, hunger_level]
    )
  end
end
