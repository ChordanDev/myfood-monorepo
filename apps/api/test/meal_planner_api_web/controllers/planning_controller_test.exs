defmodule MealPlannerApiWeb.PlanningControllerTest do
  use MealPlannerApiWeb.ConnCase, async: true

  import MealPlannerApi.AccountClockFixtures
  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.SlotFavorite
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Repo

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.15) ───────────────────────────
  # See calendar_controller_test.exs (task 3.14) for why a tampered
  # `account_id` claim — rather than a plain "scoped JWT" — is the genuine
  # RED-discriminating case for this codebase (Guardian re-attaches
  # `account_id` straight from claims for dual-write compatibility, so a
  # well-formed claim alone can't distinguish `current_user.account_id`
  # from `current_membership.account_id`).
  describe "multi-familia tenancy scoping (task 3.15)" do
    test "GET /api/planning/weekly resolves candidates via current_membership.account_id, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "plan_weekly_tamper@example.com"}, [
          {%{plan: :family_4, name: "Planning Weekly Account A"}, :owner},
          {%{plan: :family_4, name: "Planning Weekly Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      {:ok, recipe_a} =
        Catalog.create_recipe(%{
          name: "Weekly Breakfast Only In A",
          account_id: membership_a.account_id,
          created_by_user_id: user.id,
          source: :user_created,
          servings: 1,
          calories_per_serving: 400,
          prep_time_minutes: 10,
          suitable_for_slots: [:breakfast]
        })

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/planning/weekly")

      body = json_response(conn, 200)

      breakfast_recipe_ids =
        body["data"]["days"]
        |> Enum.flat_map(& &1["meals"])
        |> Enum.filter(&(&1["slot"] == "breakfast"))
        |> Enum.map(& &1["recipeId"])

      assert recipe_a.id in breakfast_recipe_ids
    end

    test "POST /api/planning/confirm persists via current_membership.account_id, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "plan_confirm_tamper@example.com"}, [
          {%{plan: :family_4, name: "Planning Confirm Account A"}, :owner},
          {%{plan: :family_4, name: "Planning Confirm Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      {:ok, recipe} =
        Catalog.create_recipe(%{
          name: "Confirm Test Recipe",
          account_id: membership_a.account_id,
          created_by_user_id: user.id,
          source: :user_created,
          servings: 1,
          calories_per_serving: 400,
          prep_time_minutes: 10,
          suitable_for_slots: [:breakfast]
        })

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      today = Date.utc_today()
      # `PlanningService.save_plan/4` resolves the persisted date from
      # `meal["day"]` (a weekday name), not `meal["date"]` — a
      # pre-existing, unrelated quirk also present in this file's
      # original "confirm endpoint persists scheduled meals" test above.
      # Use an inclusive range so this test isn't coupled to that quirk.
      range_end = Date.add(today, 1)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/planning/confirm", %{
          "meals" => [
            %{"date" => Date.to_iso8601(today), "slot" => "breakfast", "recipe_id" => recipe.id}
          ]
        })

      body = json_response(conn, 200)
      assert body["data"]["scheduledMealsCount"] == 1

      assert Planning.list_scheduled_meals(membership_a.account_id, today, range_end)
             |> length() == 1

      assert Planning.list_scheduled_meals(membership_b.account_id, today, range_end)
             |> length() == 0
    end
  end

  test "requires auth token", %{conn: conn} do
    conn = get(conn, "/api/planning/weekly")

    assert %{"error" => %{"code" => "unauthenticated"}} = json_response(conn, 401)
  end

  test "account plan returns 7 planning days", %{conn: conn} do
    %{token: token} = insert_identity_with_token!(subscription_tier: :premium)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/planning/weekly")

    body = json_response(conn, 200)

    assert length(body["data"]["days"]) == 7
    assert body["data"]["maxPlanningDays"] == 7
    assert body["data"]["subscriptionTier"] == "premium"
  end

  test "premium tier receives 7 planning days", %{conn: conn} do
    %{token: token} = insert_identity_with_token!(subscription_tier: :premium)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/planning/weekly")

    body = json_response(conn, 200)

    assert length(body["data"]["days"]) == 7
    assert body["data"]["maxPlanningDays"] == 7
    assert body["data"]["subscriptionTier"] == "premium"
  end

  test "weekly endpoint rejects days exceeding account max", %{conn: conn} do
    %{token: token} = insert_identity_with_token!()

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/planning/weekly", %{"days" => 8})

    body = json_response(conn, 400)
    assert body["error"] == "exceeds_max_planning_days"
  end

  test "confirm endpoint persists scheduled meals", %{conn: conn} do
    %{token: token, user: user, account: account} =
      insert_identity_with_token!(plan: :family_4, subscription_tier: :premium)

    {:ok, breakfast} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Desayuno confirm",
        source: :user_created,
        servings: 1,
        calories_per_serving: 420,
        suitable_for_slots: [:breakfast]
      })

    {:ok, lunch} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Almuerzo confirm",
        source: :user_created,
        servings: 1,
        calories_per_serving: 730,
        suitable_for_slots: [:lunch]
      })

    today = Date.utc_today()
    tomorrow = Date.add(today, 1)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/planning/confirm", %{
        "meals" => [
          %{"date" => Date.to_iso8601(today), "slot" => "breakfast", "recipe_id" => breakfast.id},
          %{"date" => Date.to_iso8601(tomorrow), "slot" => "lunch", "recipe_id" => lunch.id}
        ]
      })

    body = json_response(conn, 200)
    assert body["data"]["scheduledMealsCount"] == 2

    persisted = Planning.list_scheduled_meals(account.id, today, tomorrow)
    assert length(persisted) == 2
  end

  test "confirm endpoint rejects invalid payload", %{conn: conn} do
    %{token: token} = insert_identity_with_token!()

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/planning/confirm", %{"meals" => "invalid"})

    body = json_response(conn, 400)
    assert body["error"] == "invalid_payload"
  end

  describe "PUT /api/planning/slots/favorite" do
    test "turns the favorite on and off for a slot with a recipe, as the calendar shows it" do
      %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account.id)

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "Slot favorite recipe",
          source: :user_created,
          servings: 1,
          calories_per_serving: 500,
          suitable_for_slots: [:lunch]
        })

      {:ok, meal} =
        Calendar.upsert_scheduled_meal(account.id, %{
          date: today,
          slot: :lunch,
          recipe_id: recipe.id
        })

      toggle = fn ->
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/planning/slots/favorite", %{
          "date" => Date.to_iso8601(today),
          "slot" => "lunch"
        })
      end

      calendar_favorite = fn ->
        conn =
          build_conn()
          |> put_req_header("authorization", "Bearer " <> token)
          |> get("/api/calendar", %{
            "start_date" => Date.to_iso8601(today),
            "end_date" => Date.to_iso8601(today)
          })

        [listed] = json_response(conn, 200)["data"]["meals"]
        assert listed["mealId"] == meal.id
        listed["isFavorite"]
      end

      refute calendar_favorite.()

      assert json_response(toggle.(), 200) == %{"isFavorite" => true}
      assert calendar_favorite.() == true

      assert json_response(toggle.(), 200) == %{"isFavorite" => false}
      assert calendar_favorite.() == false
    end

    test "answers 404 meal_not_found when the slot has no Scheduled meal" do
      %{token: token, account: account} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account.id)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/planning/slots/favorite", %{
          "date" => Date.to_iso8601(today),
          "slot" => "dinner"
        })

      assert json_response(conn, 404) == %{"error" => "meal_not_found"}
      assert Repo.aggregate(SlotFavorite, :count) == 0
    end

    test "answers 422 meal_without_recipe when the Scheduled meal has no recipe" do
      %{token: token, account: account} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account.id)

      {:ok, _meal} = Calendar.upsert_scheduled_meal(account.id, %{date: today, slot: :snack})

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/planning/slots/favorite", %{
          "date" => Date.to_iso8601(today),
          "slot" => "snack"
        })

      assert json_response(conn, 422) == %{"error" => "meal_without_recipe"}
      assert Repo.aggregate(SlotFavorite, :count) == 0
    end
  end
end
