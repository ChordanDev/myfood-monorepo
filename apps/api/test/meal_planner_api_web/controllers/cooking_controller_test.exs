defmodule MealPlannerApiWeb.CookingControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Planning

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.16) ───────────────────────────
  # See calendar_controller_test.exs (task 3.14) for why a tampered
  # `account_id` claim is the genuine RED-discriminating case here.
  describe "multi-familia tenancy scoping (task 3.16)" do
    test "POST /api/cooking/start resolves the scheduled meal via current_membership.account_id, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "cooking_tamper@example.com"}, [
          {%{plan: :family_4, name: "Cooking Tamper Account A"}, :owner},
          {%{plan: :family_4, name: "Cooking Tamper Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships
      MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(membership_a.account, :eligible)

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: membership_a.account_id,
          created_by_user_id: user.id,
          name: "Cooking Tamper Recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:dinner]
        })

      {:ok, meal} =
        Planning.schedule_meal(%{
          account_id: membership_a.account_id,
          date: Date.utc_today(),
          slot: :dinner,
          recipe_id: recipe.id,
          is_cooked: false
        })

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/cooking/start", %{"scheduled_meal_id" => meal.id})

      body = json_response(conn, 200)
      assert body["data"]["scheduledMealId"] == meal.id
    end
  end

  test "start step finish cooking session", %{conn: conn} do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(
      MealPlannerApi.Repo.get!(MealPlannerApi.Persistence.Accounts.Account, account_id),
      :eligible
    )

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Cebolla Test Cooking",
        category: :verduras,
        calories_per_100: 40,
        protein_g_per_100: Decimal.new("1.2"),
        carbs_g_per_100: Decimal.new("9.3"),
        fat_g_per_100: Decimal.new("0.1")
      })

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Salsa de prueba",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    {:ok, step} =
      Catalog.add_recipe_step(%{
        recipe_id: recipe.id,
        step_number: 1,
        instructions: "Sofreir cebolla",
        duration_minutes: 8
      })

    {:ok, _recipe_ingredient} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 200,
        unit: :g
      })

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account_id,
        date: Date.utc_today(),
        slot: :dinner,
        recipe_id: recipe.id,
        is_cooked: false
      })

    start_conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/cooking/start", %{"scheduled_meal_id" => meal.id})

    start_body = json_response(start_conn, 200)
    session_id = start_body["data"]["sessionId"]

    assert is_binary(session_id)
    assert start_body["data"]["slot"] == "dinner"
    assert length(start_body["data"]["recipe"]["steps"]) == 1

    step_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/cooking/sessions/#{session_id}/step", %{
        "recipe_step_id" => step.id,
        "status" => "completed",
        "view" => "chat"
      })

    step_body = json_response(step_conn, 200)
    assert step_body["data"]["status"] == "completed"

    finish_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/cooking/sessions/#{session_id}/finish")

    finish_body = json_response(finish_conn, 200)

    assert %{
             "scheduledMeal" => scheduled_meal,
             "inventoryMutations" => [],
             "shortages" => [short]
           } =
             finish_body["data"]

    assert scheduled_meal["id"] == meal.id
    assert scheduled_meal["isCooked"] == true
    assert scheduled_meal["isSkipped"] == false

    # No stock: the whole requirement is missing.
    assert %{
             "ingredientId" => ingredient_id,
             "unit" => "g",
             "requestedMilli" => 200,
             "missingMilli" => 200
           } = short

    assert ingredient_id == ingredient.id
    assert_camel_case_keys(finish_body)

    again_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/cooking/sessions/#{session_id}/finish")

    assert %{"error" => %{"code" => "cooking_already_finished"}} = json_response(again_conn, 409)

    step_after_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/cooking/sessions/#{session_id}/step", %{
        "recipe_step_id" => step.id,
        "status" => "started"
      })

    assert %{"error" => %{"code" => "cooking_session_not_active"}} =
             json_response(step_after_conn, 409)
  end

  test "finish reports consumed lots in camelCase", %{conn: conn} do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(
      MealPlannerApi.Repo.get!(MealPlannerApi.Persistence.Accounts.Account, account_id),
      :eligible
    )

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{name: "Harina Finish Test", category: :otros})

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Pan",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    {:ok, _} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 300,
        unit: :g
      })

    lot =
      %MealPlannerApi.Persistence.Inventory.InventoryItem{}
      |> MealPlannerApi.Persistence.Inventory.InventoryItem.changeset(%{
        account_id: account_id,
        ingredient_id: ingredient.id,
        quantity_milli: 1000,
        unit: :g,
        source_kind: :planned,
        last_mutation_at: DateTime.utc_now(),
        expired_at: DateTime.add(DateTime.utc_now(), 5 * 86_400)
      })
      |> MealPlannerApi.Repo.insert!()

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account_id,
        date: Date.utc_today(),
        slot: :dinner,
        recipe_id: recipe.id
      })

    authed = put_req_header(conn, "authorization", "Bearer " <> token)

    session_id =
      authed
      |> post("/api/cooking/start", %{"scheduledMealId" => meal.id})
      |> json_response(200)
      |> get_in(["data", "sessionId"])

    body =
      authed
      |> post("/api/cooking/sessions/#{session_id}/finish")
      |> json_response(200)

    assert_camel_case_keys(body)
    lot_id = lot.id

    assert %{
             "inventoryMutations" => [
               %{
                 "inventoryItemId" => ^lot_id,
                 "unit" => "g",
                 "quantityBeforeMilli" => 1000,
                 "quantityDeltaMilli" => -300,
                 "quantityAfterMilli" => 700
               }
             ],
             "shortages" => []
           } = body["data"]
  end

  describe "errors use the ApiError envelope" do
    setup %{conn: conn} do
      %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
        insert_identity_with_token!(plan: :family_4)

      MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(
        MealPlannerApi.Repo.get!(MealPlannerApi.Persistence.Accounts.Account, account_id),
        :eligible
      )

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: account_id,
          created_by_user_id: user_id,
          name: "Envelope recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:dinner]
        })

      {:ok,
       conn: put_req_header(conn, "authorization", "Bearer " <> token),
       account_id: account_id,
       recipe: recipe}
    end

    test "start with an unknown meal is 404 scheduled_meal_not_found", %{conn: conn} do
      conn = post(conn, "/api/cooking/start", %{"scheduledMealId" => Ecto.UUID.generate()})
      assert %{"error" => %{"code" => "scheduled_meal_not_found"}} = json_response(conn, 404)
    end

    test "start with a malformed meal id is 404 scheduled_meal_not_found", %{conn: conn} do
      conn = post(conn, "/api/cooking/start", %{"scheduledMealId" => "nope"})
      assert %{"error" => %{"code" => "scheduled_meal_not_found"}} = json_response(conn, 404)
    end

    test "start for a meal not scheduled today is 409 cooking_chat_unavailable",
         %{conn: conn, account_id: account_id, recipe: recipe} do
      {:ok, meal} =
        Planning.schedule_meal(%{
          account_id: account_id,
          date: Date.add(Date.utc_today(), 2),
          slot: :dinner,
          recipe_id: recipe.id
        })

      conn = post(conn, "/api/cooking/start", %{"scheduledMealId" => meal.id})
      assert %{"error" => %{"code" => "cooking_chat_unavailable"}} = json_response(conn, 409)
    end

    test "start without a meal id is a validation error", %{conn: conn} do
      conn = post(conn, "/api/cooking/start", %{})
      assert %{"error" => %{"code" => "validation_error"}} = json_response(conn, 422)
    end

    test "finish and step on an unknown session are 404 not_found", %{conn: conn} do
      finish = post(conn, "/api/cooking/sessions/#{Ecto.UUID.generate()}/finish")
      assert %{"error" => %{"code" => "not_found"}} = json_response(finish, 404)

      step =
        post(conn, "/api/cooking/sessions/#{Ecto.UUID.generate()}/step", %{
          "recipeStepId" => Ecto.UUID.generate()
        })

      assert %{"error" => %{"code" => "not_found"}} = json_response(step, 404)
    end

    test "step without a recipe step id is a validation error", %{conn: conn} do
      conn = post(conn, "/api/cooking/sessions/#{Ecto.UUID.generate()}/step", %{})
      assert %{"error" => %{"code" => "validation_error"}} = json_response(conn, 422)
    end

    test "ask without a message is a validation error", %{conn: conn} do
      conn = post(conn, "/api/cooking/sessions/#{Ecto.UUID.generate()}/ask", %{})
      assert %{"error" => %{"code" => "validation_error"}} = json_response(conn, 422)
    end

    test "a request without a subscription is 403 subscription_required", %{
      conn: conn,
      account_id: account_id,
      recipe: recipe
    } do
      {:ok, meal} =
        Planning.schedule_meal(%{
          account_id: account_id,
          date: Date.utc_today(),
          slot: :dinner,
          recipe_id: recipe.id
        })

      account = MealPlannerApi.Repo.get!(MealPlannerApi.Persistence.Accounts.Account, account_id)
      MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(account, :expired)

      conn = post(conn, "/api/cooking/start", %{"scheduledMealId" => meal.id})
      assert %{"error" => %{"code" => "subscription_required"}} = json_response(conn, 403)
    end
  end
end
