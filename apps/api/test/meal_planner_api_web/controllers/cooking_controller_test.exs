defmodule MealPlannerApiWeb.CookingControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory.InventoryItem
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
      %InventoryItem{}
      |> InventoryItem.changeset(%{
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

  describe "cooking chat (issue #36)" do
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
          name: "Chat recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:dinner]
        })

      # The server gates on the Account's day, so the meal is scheduled on it.
      {:ok, meal} =
        Planning.schedule_meal(%{
          account_id: account_id,
          date: MealPlannerApi.AccountClock.today(account_id),
          slot: :dinner,
          recipe_id: recipe.id
        })

      conn = put_req_header(conn, "authorization", "Bearer " <> token)

      session_id =
        conn
        |> post("/api/cooking/start", %{"scheduledMealId" => meal.id})
        |> json_response(200)
        |> get_in(["data", "sessionId"])

      {:ok, conn: conn, meal: meal, session_id: session_id, account_id: account_id}
    end

    defp chat_count,
      do:
        MealPlannerApi.Repo.aggregate(
          MealPlannerApi.Persistence.Planning.CookingChatMessage,
          :count
        )

    test "ask stores both turns and the session read recovers them in camelCase",
         %{conn: conn, meal: meal, session_id: session_id} do
      ask_body =
        conn
        |> post("/api/cooking/sessions/#{session_id}/ask", %{"message" => "How long?"})
        |> json_response(200)
        |> assert_camel_case_keys()

      assert %{"sessionId" => ^session_id, "message" => answer, "contentType" => "text"} =
               ask_body["data"]

      assert Map.has_key?(ask_body["data"], "stepContext")

      conn
      |> post("/api/cooking/sessions/#{session_id}/ask", %{"message" => "And after?"})
      |> json_response(200)

      read_body =
        conn
        |> get("/api/cooking/sessions/#{session_id}")
        |> json_response(200)
        |> assert_camel_case_keys()

      assert [
               %{"role" => "user", "content" => "How long?"} = first,
               %{"role" => "assistant", "content" => ^answer},
               %{"role" => "user", "content" => "And after?"},
               %{"role" => "assistant"}
             ] = read_body["data"]["chatMessages"]

      assert first |> Map.keys() |> Enum.sort() == ~w(content id insertedAt role)
      assert {:ok, _, _} = DateTime.from_iso8601(first["insertedAt"])
      refute Map.has_key?(read_body["data"]["snapshot"], "frozen")

      # Reopening the chat starts the meal again and lands on the same session.
      restart_body =
        conn
        |> post("/api/cooking/start", %{"scheduledMealId" => meal.id})
        |> json_response(200)

      assert restart_body["data"]["sessionId"] == session_id
      assert restart_body["data"]["chatMessages"] == read_body["data"]["chatMessages"]
    end

    test "ask answers with the two stored turns, and a repeat of its id with the same pair",
         %{conn: conn, session_id: session_id} do
      params = %{"message" => "How long?", "clientMessageId" => Ecto.UUID.generate()}

      body =
        conn
        |> post("/api/cooking/sessions/#{session_id}/ask", params)
        |> json_response(200)
        |> assert_camel_case_keys()

      assert [
               %{"role" => "user", "content" => "How long?"} = question,
               %{"role" => "assistant", "content" => answer} = reply
             ] = body["data"]["turns"]

      assert body["data"]["message"] == answer

      for turn <- [question, reply] do
        assert turn |> Map.keys() |> Enum.sort() == ~w(content id insertedAt role)
        assert {:ok, _} = Ecto.UUID.cast(turn["id"])
        assert {:ok, _, _} = DateTime.from_iso8601(turn["insertedAt"])
      end

      repeat =
        conn
        |> post("/api/cooking/sessions/#{session_id}/ask", params)
        |> json_response(200)

      assert repeat["data"] == body["data"]
      assert chat_count() == 2
    end

    test "a malformed clientMessageId is a validation error",
         %{conn: conn, session_id: session_id} do
      for bad <- ["not-a-uuid", 42] do
        conn =
          post(conn, "/api/cooking/sessions/#{session_id}/ask", %{
            "message" => "Hi",
            "clientMessageId" => bad
          })

        assert %{"error" => %{"code" => "validation_error"}} = json_response(conn, 422)
      end

      assert chat_count() == 0
    end

    test "start on a cooked meal returns its finished session with the history",
         %{conn: conn, meal: meal, session_id: session_id} do
      conn
      |> post("/api/cooking/sessions/#{session_id}/ask", %{"message" => "Before?"})
      |> json_response(200)

      conn |> post("/api/cooking/sessions/#{session_id}/finish") |> json_response(200)

      body =
        conn
        |> post("/api/cooking/start", %{"scheduledMealId" => meal.id})
        |> json_response(200)
        |> assert_camel_case_keys()

      assert %{"sessionId" => ^session_id, "status" => "completed"} = body["data"]

      assert [%{"role" => "user", "content" => "Before?"}, %{"role" => "assistant"}] =
               body["data"]["chatMessages"]

      refute Map.has_key?(body["data"]["snapshot"], "frozen")

      again = post(conn, "/api/cooking/sessions/#{session_id}/ask", %{"message" => "After?"})
      assert %{"error" => %{"code" => "cooking_already_finished"}} = json_response(again, 409)
      assert chat_count() == 2
    end

    test "ask for a meal no longer on today is 409 cooking_chat_unavailable",
         %{conn: conn, meal: meal, session_id: session_id, account_id: account_id} do
      meal
      |> Planning.ScheduledMeal.changeset(%{
        date: Date.add(MealPlannerApi.AccountClock.today(account_id), 1)
      })
      |> MealPlannerApi.Repo.update!()

      conn = post(conn, "/api/cooking/sessions/#{session_id}/ask", %{"message" => "Hi"})
      assert %{"error" => %{"code" => "cooking_chat_unavailable"}} = json_response(conn, 409)
      assert chat_count() == 0
    end

    test "ask on a finished session is 409 cooking_already_finished",
         %{conn: conn, session_id: session_id} do
      conn |> post("/api/cooking/sessions/#{session_id}/finish") |> json_response(200)

      conn = post(conn, "/api/cooking/sessions/#{session_id}/ask", %{"message" => "Hi"})
      assert %{"error" => %{"code" => "cooking_already_finished"}} = json_response(conn, 409)
      assert chat_count() == 0
    end

    test "a blank message is a validation error", %{conn: conn, session_id: session_id} do
      conn = post(conn, "/api/cooking/sessions/#{session_id}/ask", %{"message" => "  "})
      assert %{"error" => %{"code" => "validation_error"}} = json_response(conn, 422)
      assert chat_count() == 0
    end

    test "another Account can neither read nor ask", %{session_id: session_id} do
      %{token: token, account: %{id: other_id}} = insert_identity_with_token!(plan: :family_4)

      MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(
        MealPlannerApi.Repo.get!(MealPlannerApi.Persistence.Accounts.Account, other_id),
        :eligible
      )

      stranger = put_req_header(build_conn(), "authorization", "Bearer " <> token)

      read = get(stranger, "/api/cooking/sessions/#{session_id}")
      assert %{"error" => %{"code" => "not_found"}} = json_response(read, 404)

      ask = post(stranger, "/api/cooking/sessions/#{session_id}/ask", %{"message" => "Hi"})
      assert %{"error" => %{"code" => "not_found"}} = json_response(ask, 404)
      assert chat_count() == 0
    end
  end
end
