defmodule MealPlannerApi.Services.PlanningServiceWeeklyPlanTest do
  use ExUnit.Case, async: false

  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Optimization.{OptimizerFallback, OptimizerMock}
  alias MealPlannerApi.Persistence.Accounts.UserExcludedIngredient
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.{Ingredient, Recipe, RecipeIngredient}
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.PlanningService

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    previous_client = Application.get_env(:meal_planner_api, :planning_optimizer_client)

    on_exit(fn ->
      Application.put_env(:meal_planner_api, :planning_optimizer_client, previous_client)
      Application.delete_env(:meal_planner_api, :planning_optimizer_capture_pid)
      Application.delete_env(:meal_planner_api, :out_of_candidate_recipe_id)
    end)
  end

  test "optimizer payload includes macro bounds and uses latest historical recipe cost" do
    Application.put_env(
      :meal_planner_api,
      :planning_optimizer_client,
      MealPlannerApi.PlanningCaptureOptimizerClient
    )

    Application.put_env(:meal_planner_api, :planning_optimizer_capture_pid, self())

    %{user: user, recipes: recipes} =
      create_identity_with_recipes("u_payload", "free", "individual")

    {:ok, supermarket} =
      Shopping.upsert_supermarket_by_name(%{
        name: "Super payload planning",
        chain: "Payload Chain",
        pricing_scrape_enabled: true
      })

    yesterday = Date.add(Date.utc_today(), -1)
    three_days_ago = Date.add(Date.utc_today(), -3)

    {:ok, _older_cost} =
      Catalog.upsert_recipe_daily_cost(%{
        recipe_id: recipes.breakfast.id,
        supermarket_id: supermarket.id,
        total_cents_ars: 4400,
        date: three_days_ago
      })

    {:ok, _latest_historical_cost} =
      Catalog.upsert_recipe_daily_cost(%{
        recipe_id: recipes.breakfast.id,
        supermarket_id: supermarket.id,
        total_cents_ars: 3200,
        date: yesterday
      })

    assert {:ok, _plan} =
             PlanningService.generate_weekly_plan(user, %{
               "kcal_target" => 2000,
               "weekly_budget_cents" => 40_000
             })

    assert_receive {:optimizer_payload, payload}

    macro_bounds = payload["constraints"]["macro_bounds"]
    assert macro_bounds["protein_g"] == %{"min" => 100.0, "max" => 150.0}
    assert macro_bounds["carbs_g"] == %{"min" => 225.0, "max" => 325.0}
    assert macro_bounds["fat_g"] == %{"min" => 44.44, "max" => 77.78}

    breakfast_candidates = payload["candidates_by_slot"]["breakfast"]

    breakfast_candidate =
      Enum.find(breakfast_candidates, fn candidate ->
        candidate["recipe_id"] == recipes.breakfast.id
      end)

    assert breakfast_candidate["estimated_cost_cents"] == 3200
  end

  # Issue #312: the optimizer's answer is external input. A recipe it returns
  # that is not among the candidates of its slot never reaches the plan.
  describe "optimizer answers outside the candidates" do
    test "refuses a recipe the User's Excluded ingredient removed from the candidates" do
      %{user: user, account: account} =
        create_identity_with_recipes("u_allergen", "free", "individual")

      allergen_recipe = insert_excluded_breakfast!(user, account)

      Application.put_env(:meal_planner_api, :out_of_candidate_recipe_id, allergen_recipe.id)

      assert {:error, :optimization_failed} =
               PlanningService.generate_weekly_plan(
                 user,
                 %{},
                 MealPlannerApi.TestSupport.OutOfCandidateOptimizer
               )
    end

    test "refuses a recipe that is a candidate of another slot only" do
      %{user: user, recipes: recipes} =
        create_identity_with_recipes("u_other_slot", "free", "individual")

      # The first meal is a breakfast; the lunch recipe is not a breakfast candidate.
      Application.put_env(:meal_planner_api, :out_of_candidate_recipe_id, recipes.lunch.id)

      assert {:error, :optimization_failed} =
               PlanningService.generate_weekly_plan(
                 user,
                 %{},
                 MealPlannerApi.TestSupport.OutOfCandidateOptimizer
               )
    end

    for optimizer <- [OptimizerMock, OptimizerFallback] do
      test "keeps the plan of a valid #{inspect(optimizer)} answer unchanged" do
        %{user: user, recipes: recipes} =
          create_identity_with_recipes("u_valid", "free", "individual")

        assert {:ok, plan} =
                 PlanningService.generate_weekly_plan(user, %{"days" => 2}, unquote(optimizer))

        assert Enum.map(plan.days, & &1.day) == ["monday", "tuesday"]

        for day <- plan.days do
          assert Enum.map(day.meals, &{&1["day"], &1["slot"], &1["recipe_id"]}) == [
                   {day.day, "breakfast", recipes.breakfast.id},
                   {day.day, "lunch", recipes.lunch.id},
                   {day.day, "dinner", recipes.dinner.id}
                 ]
        end

        assert plan.estimated_cost_cents ==
                 plan.days
                 |> Enum.flat_map(& &1.meals)
                 |> Enum.map(&(&1["estimated_cost_cents"] || 0))
                 |> Enum.sum()
      end
    end
  end

  defp insert_excluded_breakfast!(user, account) do
    ingredient =
      %Ingredient{}
      |> Ingredient.changeset(%{name: "Mani #{user.id}", category: :otros})
      |> Repo.insert!()

    recipe =
      %Recipe{}
      |> Recipe.changeset(%{
        account_id: account.id,
        name: "Tostada con mani #{user.id}",
        source: :user_created,
        servings: 1,
        calories_per_serving: 400,
        suitable_for_slots: [:breakfast]
      })
      |> Repo.insert!()

    %RecipeIngredient{}
    |> RecipeIngredient.changeset(%{
      recipe_id: recipe.id,
      ingredient_id: ingredient.id,
      quantity_milli: 100,
      unit: :g
    })
    |> Repo.insert!()

    %UserExcludedIngredient{}
    |> UserExcludedIngredient.changeset(%{
      user_id: user.id,
      ingredient_id: ingredient.id,
      reason: :allergy
    })
    |> Repo.insert!()

    recipe
  end

  defp create_identity_with_recipes(user_id, subscription_tier, account_type) do
    %{user: user, account: account} =
      insert_identity!(plan: if(account_type == "group", do: :family_4, else: :individual))

    {:ok, _breakfast} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Avena #{user_id}",
        source: :user_created,
        servings: 1,
        calories_per_serving: 450,
        suitable_for_slots: [:breakfast]
      })

    {:ok, _lunch} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Pollo #{user_id}",
        source: :user_created,
        servings: 1,
        calories_per_serving: 700,
        suitable_for_slots: [:lunch]
      })

    {:ok, _dinner} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Tortilla #{user_id}",
        source: :user_created,
        servings: 1,
        calories_per_serving: 650,
        suitable_for_slots: [:dinner]
      })

    user =
      user
      |> Map.put(:account_type, if(account_type == "group", do: :group, else: :individual))
      |> Map.put(
        :subscription_tier,
        if(subscription_tier == "premium", do: :premium, else: :free)
      )

    %{
      user: user,
      account: account,
      recipes: %{
        breakfast:
          Repo.get_by!(MealPlannerApi.Persistence.Catalog.Recipe, name: "Avena #{user_id}"),
        lunch: Repo.get_by!(MealPlannerApi.Persistence.Catalog.Recipe, name: "Pollo #{user_id}"),
        dinner:
          Repo.get_by!(MealPlannerApi.Persistence.Catalog.Recipe, name: "Tortilla #{user_id}")
      }
    }
  end
end
