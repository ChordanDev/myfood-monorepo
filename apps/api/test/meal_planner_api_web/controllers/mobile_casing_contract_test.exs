defmodule MealPlannerApiWeb.MobileCasingContractTest do
  @moduledoc """
  Contract of the `:mobile_casing` router pipeline (issue #11), one product
  area at a time: a request may send camelCase params, and a success response
  carries camelCase keys only, nested lists included.

  The last block proves the pipeline is opt-in: a route outside it keeps its
  snake_case keys and does not read camelCase params.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.CartFixtures
  import MealPlannerApi.FactoryHelpers

  import MealPlannerApiWeb.ChannelHelpers,
    only: [persist_trial_window!: 2, with_enforcement_enabled!: 1]

  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Repo

  # `fixture/0` gives an Account inside its trial with an owner, a recipe, a
  # dinner scheduled for today and two pending shopping items of one
  # ingredient.
  setup do
    f = fixture()

    membership =
      AccountMembership
      |> Repo.get_by!(user_id: f.owner.id, account_id: f.account.id)
      |> Repo.preload(:account)

    {:ok, Map.put(f, :token, issue_access_v2_token(f.owner, membership))}
  end

  describe "assert_camel_case_keys/1" do
    test "fails on a snake_case key at any depth and names its path" do
      error =
        assert_raise ExUnit.AssertionError, fn ->
          assert_camel_case_keys(%{"data" => %{"meals" => [%{"id" => 1}, %{"recipe_id" => 2}]}})
        end

      assert error.message =~ "data.meals.[1].recipe_id"
    end

    test "skips the data keys of an opaque map and checks the payloads below them" do
      body = %{"byCategory" => %{"no_perecederos" => [%{"ingredientId" => 7}]}}

      assert assert_camel_case_keys(body) == body

      assert_raise ExUnit.AssertionError,
                   ~r/byCategory\.no_perecederos\.\[0\]\.ingredient_id/,
                   fn ->
                     assert_camel_case_keys(%{
                       "byCategory" => %{"no_perecederos" => [%{"ingredient_id" => 7}]}
                     })
                   end
    end
  end

  describe "planning" do
    test "GET /api/planning/weekly responds with camelCase keys", f do
      body = f |> request(:get, "/api/planning/weekly") |> success()

      assert %{
               "days" => [%{"meals" => meals} | _],
               "maxPlanningDays" => max_planning_days,
               "estimatedCostCents" => _,
               "optimizerUsed" => true,
               "subscriptionTier" => _
             } = body["data"]

      assert is_integer(max_planning_days)
      assert [%{"recipeId" => recipe_id, "caloriesPerServing" => _} | _] = meals
      assert recipe_id == f.recipe.id
    end

    test "POST /api/planning/confirm reads camelCase params nested in a list", f do
      today = Date.utc_today()

      body =
        f
        |> request(:post, "/api/planning/confirm", %{
          "meals" => [
            %{
              "date" => Date.to_iso8601(today),
              "slot" => "lunch",
              "recipeId" => f.recipe.id,
              "selectedQuantity" => 3
            }
          ]
        })
        |> success()

      assert body == %{"data" => %{"scheduledMealsCount" => 1}}

      assert [lunch] =
               f.account.id
               |> Planning.list_scheduled_meals(Date.add(today, -7), Date.add(today, 7))
               |> Enum.filter(&(&1.slot == :lunch))

      assert lunch.recipe_id == f.recipe.id
      assert lunch.selected_quantity == 3
    end
  end

  describe "calendar" do
    test "GET /api/calendar reads camelCase query params and responds with camelCase keys", f do
      today = Date.to_iso8601(Date.utc_today())

      body =
        f
        |> request(:get, "/api/calendar", %{
          "startDate" => today,
          "endDate" => today,
          "selectedDate" => today,
          "selectedSlot" => "dinner"
        })
        |> success()

      assert %{
               "startDate" => ^today,
               "endDate" => ^today,
               "selectedSlot" => "dinner",
               "days" => [%{"date" => ^today, "dayState" => _, "hasPlannedMenu" => true}],
               "meals" => [%{"mealId" => meal_id, "isCooked" => false}],
               "selectedMeal" => %{"mealId" => meal_id, "canCreate" => false}
             } = body["data"]

      assert meal_id == f.meal.id
      assert hd(body["data"]["meals"])["recipeId"] == f.recipe.id
    end
  end

  describe "recipes" do
    test "GET /api/recipes/:id responds with camelCase keys", f do
      body = f |> request(:get, "/api/recipes/#{f.recipe.id}") |> success()

      assert %{"id" => id, "version" => 1, "recipeVersionId" => version_id} = body["data"]
      assert id == f.recipe.id
      assert is_binary(version_id)
      assert Map.has_key?(body["data"], "successorRecipeId")
    end
  end

  describe "cooking" do
    test "a session is started, tracked and read back with camelCase params and keys", f do
      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: f.account.id,
          created_by_user_id: f.owner.id,
          name: "Casing contract recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, step} =
        Catalog.add_recipe_step(%{
          recipe_id: recipe.id,
          step_number: 1,
          instructions: "Boil the eggs",
          duration_minutes: 8
        })

      {:ok, meal} =
        Planning.schedule_meal(%{
          account_id: f.account.id,
          date: Date.utc_today(),
          slot: :lunch,
          recipe_id: recipe.id,
          is_cooked: false
        })

      started =
        f |> request(:post, "/api/cooking/start", %{"scheduledMealId" => meal.id}) |> success()

      assert %{"sessionId" => session_id, "scheduledMealId" => scheduled_meal_id} =
               started["data"]

      assert scheduled_meal_id == meal.id
      assert [%{"stepNumber" => 1}] = started["data"]["recipe"]["steps"]

      # The timer id is chosen by the client and is not a field name.
      timers = %{"eggTimer" => %{"remainingSeconds" => 90}}

      tracked =
        f
        |> request(:post, "/api/cooking/sessions/#{session_id}/step", %{
          "recipeStepId" => step.id,
          "status" => "paused",
          "timers" => timers
        })
        |> success()

      assert tracked["data"]["status"] == "paused"

      state = f |> request(:get, "/api/cooking/sessions/#{session_id}") |> success()

      assert state["data"]["sessionId"] == session_id

      assert %{"currentStepId" => current_step_id, "stepStatus" => "paused"} =
               state["data"]["snapshot"]

      assert current_step_id == step.id
      assert state["data"]["snapshot"]["timers"] == timers
    end
  end

  describe "shopping and cart" do
    test "GET /api/shopping-list reads camelCase query params and responds with camelCase keys",
         f do
      listed = f |> request(:get, "/api/shopping-list") |> success()

      assert [%{"ingredientId" => ingredient_id, "lines" => [_ | _]}] = listed["data"]["items"]
      assert ingredient_id == f.ingredient.id

      # Without the rewrite the range falls back to the default one, which
      # holds the two items above.
      later = Date.add(Date.utc_today(), 30)

      empty =
        f
        |> request(:get, "/api/shopping-list", %{
          "fromDate" => Date.to_iso8601(later),
          "toDate" => Date.to_iso8601(Date.add(later, 1))
        })
        |> success()

      assert empty["data"]["items"] == []
    end

    test "a cart is reserved and bought with camelCase params and keys", f do
      cart =
        f
        |> request(:post, "/api/shopping-items/mark-cart", %{
          "itemIds" => Enum.map(f.items, & &1.id)
        })
        |> success()

      assert %{"sessionId" => session_id, "reservations" => [_, _] = reservations} = cart["data"]

      items =
        Enum.map(reservations, fn %{"itemId" => item_id, "reservationToken" => token} ->
          %{
            "itemId" => item_id,
            "reservationToken" => token,
            "quantityMilli" => 300,
            "totalCents" => 250
          }
        end)

      bought =
        f
        |> request(:post, "/api/checkout/confirm", %{
          "sessionId" => session_id,
          "checkoutType" => "physical",
          "items" => items
        })
        |> success()

      assert bought["data"]["actualTotalCents"] == 500
    end
  end

  describe "inventory" do
    test "an extra item is added and listed with camelCase params and keys", f do
      {:ok, ingredient} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Casing contract rice",
          category: :no_perecederos,
          calories_per_100: 130,
          protein_g_per_100: Decimal.new("2.7"),
          carbs_g_per_100: Decimal.new("28.0"),
          fat_g_per_100: Decimal.new("0.3")
        })

      f
      |> request(:post, "/api/inventory/items/add-extra", %{
        "ingredientId" => ingredient.id,
        "quantityMilli" => 250,
        "unit" => "g"
      })
      |> success()

      body = f |> request(:get, "/api/inventory") |> success()

      assert body["data"]["totals"] == %{
               "itemsCount" => 1,
               "warningCount" => 0,
               "expiredCount" => 0
             }

      # `no_perecederos` is an ingredient category, not a field name.
      assert %{"no_perecederos" => [item]} = body["data"]["byCategory"]

      assert %{
               "ingredientId" => ingredient_id,
               "quantityMilli" => 250,
               "sourceKind" => "extra",
               "freshnessStatus" => "ok"
             } = item

      assert ingredient_id == ingredient.id
      assert body["data"]["extras"] == [item]
    end
  end

  describe "me" do
    test "GET /api/me responds with camelCase keys, like its alias outside the pipeline", f do
      body = f |> request(:get, "/api/me") |> success()

      assert %{
               "user" => %{"displayName" => _, "householdSize" => nil, "cookingSkill" => nil},
               "account" => %{
                 "trialEndsAt" => trial_ends_at,
                 "subscriptionStatus" => "none",
                 "access" => %{"canUseApp" => true, "reason" => nil}
               },
               "onboarding" => %{"isComplete" => false}
             } = body

      assert is_binary(trial_ends_at)
      assert body == f |> request(:get, "/api/auth/me") |> json_response(200)
    end

    test "PUT /api/me/profile reads camelCase params and responds with camelCase keys", f do
      profile = %{"displayName" => "Ana", "householdSize" => 3, "cookingSkill" => "advanced"}

      body = f |> request(:put, "/api/me/profile", profile) |> success()

      assert %{"id" => _, "email" => _} = body["user"]
      assert Map.take(body["user"], Map.keys(profile)) == profile
      assert f |> request(:get, "/api/me") |> success() |> Map.fetch!("user") == body["user"]
    end
  end

  describe "routes outside the pipeline" do
    test "/api/account/excluded-ingredients reads snake_case params only and keeps its snake_case keys",
         f do
      path = "/api/account/excluded-ingredients"

      camel = %{"ingredientId" => f.ingredient.id, "reason" => "allergy"}

      assert f |> request(:post, path, camel) |> json_response(400) ==
               %{"error" => "invalid_exclusion"}

      exclusion = %{"ingredient_id" => f.ingredient.id, "reason" => "allergy"}

      assert f |> request(:post, path, exclusion) |> json_response(201) == %{"data" => exclusion}
      assert f |> request(:get, path) |> json_response(200) == %{"data" => [exclusion]}
    end
  end

  # The router wiring, read off the conn the endpoint returns: a camelCase
  # query param comes back in snake_case only when the request went through
  # `Plugs.MobileCasing`. Removing the pipeline from a scope fails these
  # tests, and so does moving it after a pipeline that halts, because Phoenix
  # runs no pipeline after a halt.
  describe "router wiring" do
    @query "?selectedSlot=dinner"
    @rewritten %{"selected_slot" => "dinner"}
    @untouched %{"selectedSlot" => "dinner"}

    test "a product request halted by :auth has been through the plug first" do
      conn = dispatch(build_conn(), @endpoint, :get, "/api/planning/weekly" <> @query)

      assert conn.halted
      assert %{"error" => %{"code" => "unauthenticated"}} = json_response(conn, 401)
      assert conn.query_params == @rewritten
    end

    test "a product request halted by :enforce_capability has been through the plug first", f do
      persist_trial_window!(f.account, :expired)

      conn =
        with_enforcement_enabled!(fn -> request(f, :get, "/api/planning/weekly" <> @query) end)

      assert conn.halted
      assert %{"error" => %{"code" => "trial_expired"}} = json_response(conn, 403)
      assert conn.query_params == @rewritten
    end

    test "GET /api/me goes through the plug, halted by :auth or not", f do
      halted = dispatch(build_conn(), @endpoint, :get, "/api/me" <> @query)

      assert halted.halted
      assert halted.status == 401
      assert halted.query_params == @rewritten

      served = request(f, :get, "/api/me" <> @query)

      assert served.status == 200
      assert served.query_params == @rewritten
    end

    test "GET /api/auth/me and /api/account/* never go through the plug", f do
      for path <- ["/api/auth/me", "/api/account/excluded-ingredients"] do
        halted = dispatch(build_conn(), @endpoint, :get, path <> @query)

        assert {path, halted.status} == {path, 401}
        assert {path, halted.query_params} == {path, @untouched}

        served = request(f, :get, path <> @query)

        assert {path, served.status} == {path, 200}
        assert {path, served.query_params} == {path, @untouched}
      end
    end
  end

  defp request(f, method, path, params \\ %{}) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> f.token)
    |> dispatch(@endpoint, method, path, params)
  end

  # A 200 response whose decoded body has camelCase keys only.
  defp success(conn), do: conn |> json_response(200) |> assert_camel_case_keys()
end
