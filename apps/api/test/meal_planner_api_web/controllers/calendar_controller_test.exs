defmodule MealPlannerApiWeb.CalendarControllerTest do
  use MealPlannerApiWeb.ConnCase, async: true

  import MealPlannerApi.AccountClockFixtures
  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.14) ───────────────────────────
  # Controller sweep: `CalendarController` must resolve tenancy scope from
  # `conn.assigns.current_membership.account_id` (the DB-resolved,
  # `membership_id`-backed row `LoadCurrentMembership` assigns), not the
  # legacy `current_user.account_id` field — which Guardian's
  # `resource_from_claims/1` re-attaches straight from the JWT's
  # (redundant, non-authoritative) `account_id` claim for dual-write
  # backward compatibility (see `lib/meal_planner_api/auth/guardian.ex`).
  # Because that reattachment already mirrors a well-formed `access_v2`
  # token's `account_id` claim, a naive "JWT scoped to Account_A" test
  # alone cannot distinguish the two fields (it's GREEN either way). The
  # discriminating case is a validly-signed token whose `membership_id`
  # (canonical) and `account_id` claim (redundant, must never be trusted
  # directly) disagree — exactly the shape a stale/legacy claim could take.
  describe "GET /api/calendar — multi-familia tenancy scoping (task 3.14)" do
    setup do
      user =
        user_with_memberships(%{email: "cal_multi_a@example.com"}, [
          {%{plan: :family_4, name: "Calendar Account A"}, :owner},
          {%{plan: :family_4, name: "Calendar Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      # The server judges "today" on the Account's clock at the real now, so
      # dates relative to today come from an Account pinned to midday.
      today = pin_account_to_midday!(membership_a.account_id)

      {:ok, recipe_a} =
        Catalog.create_recipe(%{
          name: "Only In Account A",
          account_id: membership_a.account_id,
          created_by_user_id: user.id,
          source: :user_created,
          servings: 2,
          calories_per_serving: 300,
          prep_time_minutes: 10,
          suitable_for_slots: [:lunch]
        })

      {:ok, recipe_b} =
        Catalog.create_recipe(%{
          name: "Only In Account B",
          account_id: membership_b.account_id,
          created_by_user_id: user.id,
          source: :user_created,
          servings: 2,
          calories_per_serving: 300,
          prep_time_minutes: 10,
          suitable_for_slots: [:lunch]
        })

      {:ok, _meal_a} =
        Calendar.upsert_scheduled_meal(membership_a.account_id, %{
          date: today,
          slot: :lunch,
          recipe_id: recipe_a.id
        })

      {:ok, _meal_b} =
        Calendar.upsert_scheduled_meal(membership_b.account_id, %{
          date: today,
          slot: :lunch,
          recipe_id: recipe_b.id
        })

      %{user: user, membership_a: membership_a, membership_b: membership_b, today: today}
    end

    test "JWT scoped to Account_A (via membership_id) returns Account_A data only", %{
      conn: conn,
      user: user,
      membership_a: membership_a,
      today: today
    } do
      token_a = issue_access_v2_token(user, membership_a)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token_a)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(today),
          "end_date" => Date.to_iso8601(Date.add(today, 6))
        })

      body = json_response(conn, 200)
      recipe_names = Enum.map(body["data"]["meals"], & &1["recipeName"])

      assert "Only In Account A" in recipe_names
      refute "Only In Account B" in recipe_names
    end

    test "trusts the DB-resolved current_membership.account_id, not a tampered account_id claim",
         %{
           conn: conn,
           user: user,
           membership_a: membership_a,
           membership_b: membership_b,
           today: today
         } do
      # membership_id points at Account A (the canonical scope pointer);
      # the redundant account_id claim is tampered to point at Account B.
      # A controller reading `current_membership.account_id` (resolved via
      # membership_id) must return Account A's data regardless.
      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(today),
          "end_date" => Date.to_iso8601(Date.add(today, 6))
        })

      body = json_response(conn, 200)
      recipe_names = Enum.map(body["data"]["meals"], & &1["recipeName"])

      assert "Only In Account A" in recipe_names
      refute "Only In Account B" in recipe_names
    end
  end

  # ─── Gap 1: show_slot endpoint ──────────────────────────────────────────────

  describe "GET /api/calendar/slot — filled slot" do
    test "returns meal with canCreate: false" do
      %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
        insert_identity_with_token!(plan: :family_4)

      # Create a recipe and scheduled meal for the target slot
      {:ok, recipe} =
        Catalog.create_recipe(%{
          name: "Pollo a la Plancha Test Slot",
          account_id: account_id,
          created_by_user_id: user_id,
          source: :user_created,
          servings: 2,
          calories_per_serving: 450,
          prep_time_minutes: 20,
          suitable_for_slots: [:lunch]
        })

      {:ok, _meal} =
        Calendar.upsert_scheduled_meal(account_id, %{
          date: ~D[2026-06-15],
          slot: :lunch,
          recipe_id: recipe.id
        })

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar/slot", %{
          "date" => "2026-06-15",
          "slot" => "lunch"
        })

      assert %{
               "data" => %{
                 "mealId" => meal_id,
                 "canCreate" => false,
                 "slot" => "lunch",
                 "recipeId" => recipe_id
               }
             } = json_response(conn, 200)

      assert is_binary(meal_id)
      assert is_binary(recipe_id)
    end
  end

  describe "GET /api/calendar/slot — empty slot" do
    test "returns canCreate: true when no meal exists" do
      %{token: token} = insert_identity_with_token!(plan: :family_4)

      # No scheduled meal for 2026-06-20 / dinner
      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar/slot", %{
          "date" => "2026-06-20",
          "slot" => "dinner"
        })

      assert %{
               "data" => %{
                 "mealId" => nil,
                 "canCreate" => true,
                 "slot" => "dinner",
                 "recipeId" => nil,
                 "recipeName" => nil,
                 "macros" => nil,
                 "prepTimeMinutes" => nil,
                 "isCooked" => false,
                 "isFavorite" => false
               }
             } = json_response(conn, 200)
    end
  end

  describe "GET /api/calendar/slot — validation errors" do
    test "returns 422 for invalid date format" do
      %{token: token} = insert_identity_with_token!(plan: :family_4)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar/slot", %{
          "date" => "not-a-date",
          "slot" => "lunch"
        })

      assert %{"error" => "invalid_date_format"} = json_response(conn, 422)
    end

    test "returns 422 for invalid slot value" do
      %{token: token} = insert_identity_with_token!(plan: :family_4)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar/slot", %{
          "date" => "2026-06-15",
          "slot" => "supper"
        })

      assert %{"error" => "invalid_slot"} = json_response(conn, 422)
    end

    test "returns 422 for missing date param" do
      %{token: token} = insert_identity_with_token!(plan: :family_4)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar/slot", %{"slot" => "lunch"})

      assert %{"error" => "missing_date_param"} = json_response(conn, 422)
    end

    test "returns 422 for missing slot param" do
      %{token: token} = insert_identity_with_token!(plan: :family_4)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar/slot", %{"date" => "2026-06-15"})

      assert %{"error" => "missing_slot_param"} = json_response(conn, 422)
    end
  end

  # ─── Gap 3: canCreate in index response ─────────────────────────────────────

  describe "GET /api/calendar — canCreate in selectedMeal" do
    test "selectedMeal has canCreate: false when slot is filled" do
      %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
        insert_identity_with_token!(plan: :family_4)

      today = pin_account_to_midday!(account_id)

      {:ok, recipe} =
        Catalog.create_recipe(%{
          name: "Ensalada César Test Index",
          account_id: account_id,
          created_by_user_id: user_id,
          source: :user_created,
          servings: 2,
          calories_per_serving: 320,
          prep_time_minutes: 15,
          suitable_for_slots: [:lunch]
        })

      {:ok, _meal} =
        Calendar.upsert_scheduled_meal(account_id, %{
          date: today,
          slot: :lunch,
          recipe_id: recipe.id
        })

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(today),
          "end_date" => Date.to_iso8601(Date.add(today, 6)),
          "selected_date" => Date.to_iso8601(today),
          "selected_slot" => "lunch"
        })

      assert %{
               "data" => %{
                 "selectedMeal" => %{
                   "canCreate" => false,
                   "mealId" => meal_id
                 }
               }
             } = json_response(conn, 200)

      assert is_binary(meal_id)
    end

    test "selectedMeal has canCreate: true when slot is empty" do
      %{token: token, account: %{id: account_id}} = insert_identity_with_token!(plan: :family_4)

      today = pin_account_to_midday!(account_id)
      tomorrow = Date.add(today, 10)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(today),
          "end_date" => Date.to_iso8601(Date.add(today, 6)),
          "selected_date" => Date.to_iso8601(tomorrow),
          "selected_slot" => "dinner"
        })

      assert %{
               "data" => %{
                 "selectedMeal" => nil
               }
             } = json_response(conn, 200)
    end
  end

  describe "GET /api/calendar — canCreate in meals list" do
    test "meals list items have canCreate: false" do
      %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
        insert_identity_with_token!(plan: :family_4)

      today = pin_account_to_midday!(account_id)

      {:ok, recipe} =
        Catalog.create_recipe(%{
          name: "Tortilla Española Test Meals",
          account_id: account_id,
          created_by_user_id: user_id,
          source: :user_created,
          servings: 2,
          calories_per_serving: 280,
          prep_time_minutes: 10,
          suitable_for_slots: [:breakfast]
        })

      {:ok, _meal} =
        Calendar.upsert_scheduled_meal(account_id, %{
          date: today,
          slot: :breakfast,
          recipe_id: recipe.id
        })

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(today),
          "end_date" => Date.to_iso8601(Date.add(today, 6))
        })

      body = json_response(conn, 200)
      meals = body["data"]["meals"]
      assert is_list(meals)

      for meal <- meals do
        assert Map.has_key?(meal, "canCreate"),
               "meal missing canCreate field: #{inspect(meal)}"

        assert meal["canCreate"] == false,
               "meal canCreate should be false: #{inspect(meal)}"
      end
    end
  end

  describe "PUT /api/calendar/meals/range — capability and tenancy" do
    test "denies an expired account when capability enforcement is enabled", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-expired@example.com"},
          [{%{name: "Expired calendar account", plan: :family_4}, :owner}]
        )

      membership = hd(user.memberships)
      account = Repo.get!(Account, membership.account_id)
      now = DateTime.utc_now()

      account
      |> Account.changeset(%{
        trial_started_at: DateTime.add(now, -86_400, :second),
        trial_ends_at: DateTime.add(now, -1, :second)
      })
      |> Repo.update!()

      token = issue_access_v2_token(user, membership)
      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      try do
        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> put("/api/calendar/meals/range", %{
            "from" => "2026-07-01",
            "to" => "2026-07-07",
            "meals" => []
          })

        assert %{"error" => %{"code" => "trial_expired"}} = json_response(conn, 403)
      after
        Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, previous)
      end
    end

    test "rejects replacement input from another account before writing", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-controller-scope@example.com"},
          [
            {%{name: "Controller account A", plan: :family_4}, :owner},
            {%{name: "Controller account B", plan: :family_4}, :member}
          ]
        )

      [membership_a, membership_b] = user.memberships

      {:ok, existing} =
        Calendar.upsert_scheduled_meal(membership_b.account_id, %{
          date: ~D[2026-07-02],
          slot: :lunch
        })

      token = issue_access_v2_token(user, membership_a)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/calendar/meals/range", %{
          "from" => "2026-07-01",
          "to" => "2026-07-07",
          "meals" => [
            %{
              "account_id" => membership_b.account_id,
              "date" => "2026-07-03",
              "slot" => "dinner"
            }
          ]
        })

      assert %{"error" => "cross_account"} = json_response(conn, 422)

      assert [meal] =
               PlanningRepo.list_scheduled_meals(
                 membership_b.account_id,
                 ~D[2026-07-01],
                 ~D[2026-07-07]
               )

      assert meal.id == existing.id
    end
  end

  describe "PUT /api/calendar/meals/range — happy path and validation" do
    test "replaces meals in the selected range and returns the replaced count", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-controller-happy@example.com"},
          [{%{name: "Calendar happy path account", plan: :family_4}, :owner}]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/calendar/meals/range", %{
          "from" => "2026-07-01",
          "to" => "2026-07-07",
          "meals" => [
            %{"date" => "2026-07-02", "slot" => "lunch"},
            %{"date" => "2026-07-03", "slot" => "dinner"}
          ]
        })

      assert %{"data" => %{"replaced" => 2}} = json_response(conn, 200)

      meals =
        PlanningRepo.list_scheduled_meals(
          membership.account_id,
          ~D[2026-07-01],
          ~D[2026-07-07]
        )

      assert length(meals) == 2
      assert Enum.any?(meals, &(&1.date == ~D[2026-07-02] and &1.slot == :lunch))
      assert Enum.any?(meals, &(&1.date == ~D[2026-07-03] and &1.slot == :dinner))
    end

    test "keeps recipe, cooked flag and quantity of the replacement meals", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-controller-keep-attrs@example.com"},
          [{%{name: "Calendar keep attrs account", plan: :family_4}, :owner}]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      {:ok, recipe} =
        Catalog.create_recipe(%{
          name: "Kept Recipe",
          account_id: membership.account_id,
          created_by_user_id: user.id,
          source: :user_created,
          servings: 2,
          calories_per_serving: 300,
          prep_time_minutes: 10,
          suitable_for_slots: [:lunch]
        })

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/calendar/meals/range", %{
          "from" => "2026-07-01",
          "to" => "2026-07-07",
          "meals" => [
            %{
              "date" => "2026-07-02",
              "slot" => "lunch",
              "recipeId" => recipe.id,
              "isCooked" => true,
              "selectedQuantity" => 2
            }
          ]
        })

      assert %{"data" => %{"replaced" => 1}} = json_response(conn, 200)

      [meal] =
        PlanningRepo.list_scheduled_meals(
          membership.account_id,
          ~D[2026-07-01],
          ~D[2026-07-07]
        )

      assert meal.recipe_id == recipe.id
      assert meal.is_cooked == true
      assert meal.selected_quantity == 2
    end

    test "returns 422 when `from` is missing", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-controller-missing-from@example.com"},
          [{%{name: "Calendar validation missing-from account", plan: :family_4}, :owner}]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/calendar/meals/range", %{
          "to" => "2026-07-07",
          "meals" => []
        })

      assert %{"error" => "missing_date_param"} = json_response(conn, 422)
    end

    test "returns 422 when `to` is not a valid ISO date", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-controller-bad-to@example.com"},
          [{%{name: "Calendar validation bad-to account", plan: :family_4}, :owner}]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/calendar/meals/range", %{
          "from" => "2026-07-01",
          "to" => "not-a-date",
          "meals" => []
        })

      assert %{"error" => "invalid_date_format"} = json_response(conn, 422)
    end

    test "returns 422 when the range is reversed", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-controller-reversed@example.com"},
          [{%{name: "Calendar validation reversed account", plan: :family_4}, :owner}]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/calendar/meals/range", %{
          "from" => "2026-07-07",
          "to" => "2026-07-01",
          "meals" => []
        })

      assert %{"error" => "invalid_date_range"} = json_response(conn, 422)
    end

    test "returns 422 when `meals` is missing", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-controller-no-meals@example.com"},
          [{%{name: "Calendar validation no-meals account", plan: :family_4}, :owner}]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/calendar/meals/range", %{
          "from" => "2026-07-01",
          "to" => "2026-07-07"
        })

      assert %{"error" => "missing_meals"} = json_response(conn, 422)
    end
  end

  # ─── Calendar access — capability enforcement on GET /api/calendar ──────────
  # Spec scenarios: Eligible Account reads its calendar (covered above by
  # the multi-familia tenancy tests + show_slot tests) and Expired Account
  # read is denied (this block).
  describe "GET /api/calendar — capability enforcement" do
    test "denies an expired account when capability enforcement is enabled", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "calendar-get-expired@example.com"},
          [{%{name: "Expired calendar read account", plan: :family_4}, :owner}]
        )

      membership = hd(user.memberships)
      account = Repo.get!(Account, membership.account_id)
      now = DateTime.utc_now()

      account
      |> Account.changeset(%{
        trial_started_at: DateTime.add(now, -86_400, :second),
        trial_ends_at: DateTime.add(now, -1, :second)
      })
      |> Repo.update!()

      token = issue_access_v2_token(user, membership)
      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      try do
        today = pin_account_to_midday!(account.id)

        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> get("/api/calendar", %{
            "start_date" => Date.to_iso8601(today),
            "end_date" => Date.to_iso8601(Date.add(today, 6))
          })

        assert %{"error" => %{"code" => "trial_expired"}} = json_response(conn, 403)
      after
        Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, previous)
      end
    end
  end

  # ─── Helper functions ────────────────────────────────────────────────────────
  describe "isSkipped" do
    test "GET /api/calendar and /api/calendar/slot derive isSkipped, never with isCooked" do
      %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
        insert_identity_with_token!(plan: :family_4)

      {:ok, recipe} =
        Catalog.create_recipe(%{
          name: "Skipped test",
          account_id: account_id,
          created_by_user_id: user_id,
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch, :dinner]
        })

      today = pin_account_to_midday!(account_id)
      yesterday = Date.add(today, -1)

      {:ok, skipped} =
        Calendar.upsert_scheduled_meal(account_id, %{
          date: yesterday,
          slot: :lunch,
          recipe_id: recipe.id
        })

      {:ok, cooked} =
        Calendar.upsert_scheduled_meal(account_id, %{
          date: yesterday,
          slot: :dinner,
          recipe_id: recipe.id
        })

      {:ok, _} = Calendar.set_is_cooked(account_id, cooked.id, true)

      {:ok, current} =
        Calendar.upsert_scheduled_meal(account_id, %{
          date: today,
          slot: :lunch,
          recipe_id: recipe.id
        })

      body =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(yesterday),
          "end_date" => Date.to_iso8601(today)
        })
        |> json_response(200)

      flags = Map.new(body["data"]["meals"], &{&1["mealId"], {&1["isCooked"], &1["isSkipped"]}})
      assert flags[skipped.id] == {false, true}
      assert flags[cooked.id] == {true, false}
      assert flags[current.id] == {false, false}

      slot =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar/slot", %{"date" => Date.to_iso8601(yesterday), "slot" => "lunch"})
        |> json_response(200)

      assert %{"mealId" => id, "isSkipped" => true, "isCooked" => false} = slot["data"]
      assert id == skipped.id
    end
  end

  # Issue #207: the Eat today sheet disables a destination whose meal is being
  # cooked, so the calendar says which meals have an active Cooking session.
  describe "isCooking" do
    test "GET /api/calendar and /api/calendar/slot flag only a meal with an active Cooking session" do
      %{token: token, account: %{id: account_id}} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account_id)

      {:ok, cooking} = Calendar.upsert_scheduled_meal(account_id, %{date: today, slot: :lunch})
      {:ok, finished} = Calendar.upsert_scheduled_meal(account_id, %{date: today, slot: :dinner})
      {:ok, idle} = Calendar.upsert_scheduled_meal(account_id, %{date: today, slot: :snack})
      cooking_session!(cooking, :active)
      cooking_session!(finished, :completed)

      body =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(today),
          "end_date" => Date.to_iso8601(today)
        })
        |> json_response(200)

      assert Map.new(body["data"]["meals"], &{&1["mealId"], &1["isCooking"]}) == %{
               cooking.id => true,
               finished.id => false,
               idle.id => false
             }

      for {slot, is_cooking} <- [{"lunch", true}, {"dinner", false}, {"breakfast", false}] do
        data =
          build_conn()
          |> put_req_header("authorization", "Bearer " <> token)
          |> get("/api/calendar/slot", %{"date" => Date.to_iso8601(today), "slot" => slot})
          |> json_response(200)
          |> Map.fetch!("data")

        assert {slot, data["isCooking"]} == {slot, is_cooking}
      end
    end

    # Issue #337: an active session counts only while its meal is on the
    # Account's today; before or after it, the meal can be moved.
    test "GET /api/calendar and /api/calendar/slot do not flag an active session off today" do
      %{token: token, account: %{id: account_id}} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account_id)
      yesterday = Date.add(today, -1)
      tomorrow = Date.add(today, 1)

      {:ok, past} = Calendar.upsert_scheduled_meal(account_id, %{date: yesterday, slot: :lunch})
      {:ok, future} = Calendar.upsert_scheduled_meal(account_id, %{date: tomorrow, slot: :lunch})
      cooking_session!(past, :active)
      cooking_session!(future, :active)

      body =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(yesterday),
          "end_date" => Date.to_iso8601(tomorrow)
        })
        |> json_response(200)

      assert Map.new(body["data"]["meals"], &{&1["mealId"], &1["isCooking"]}) == %{
               past.id => false,
               future.id => false
             }

      for date <- [yesterday, tomorrow] do
        data =
          build_conn()
          |> put_req_header("authorization", "Bearer " <> token)
          |> get("/api/calendar/slot", %{"date" => Date.to_iso8601(date), "slot" => "lunch"})
          |> json_response(200)
          |> Map.fetch!("data")

        assert {date, data["isCooking"]} == {date, false}
      end
    end
  end

  describe "POST /api/calendar/meals/:id/move" do
    setup do
      %{token: token, account: account} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account)

      %{token: token, account_id: account.id, today: today, tomorrow: Date.add(today, 1)}
    end

    defp move(token, meal_id, body) do
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/calendar/meals/#{meal_id}/move", body)
    end

    defp scheduled!(account_id, date, slot, attrs \\ %{}) do
      {:ok, meal} =
        Calendar.upsert_scheduled_meal(account_id, Map.merge(%{date: date, slot: slot}, attrs))

      meal
    end

    defp stored_position(meal) do
      stored = Repo.get!(Planning.ScheduledMeal, meal.id)
      {stored.date, stored.slot}
    end

    test "swaps the meal with the one at the destination", f do
      source = scheduled!(f.account_id, f.tomorrow, :dinner)
      target = scheduled!(f.account_id, f.today, :lunch)

      body =
        f.token
        |> move(source.id, %{"date" => Date.to_iso8601(f.today), "slot" => "lunch"})
        |> json_response(200)

      assert body == %{
               "data" => %{
                 "moved" => %{
                   "mealId" => source.id,
                   "date" => Date.to_iso8601(f.today),
                   "slot" => "lunch"
                 },
                 "displaced" => %{
                   "mealId" => target.id,
                   "date" => Date.to_iso8601(f.tomorrow),
                   "slot" => "dinner"
                 }
               }
             }

      assert stored_position(source) == {f.today, :lunch}
      assert stored_position(target) == {f.tomorrow, :dinner}
    end

    test "moves the meal into an empty slot", f do
      source = scheduled!(f.account_id, f.tomorrow, :dinner)

      body =
        f.token
        |> move(source.id, %{"date" => Date.to_iso8601(f.today), "slot" => "snack"})
        |> json_response(200)

      assert %{"moved" => %{"mealId" => id, "slot" => "snack"}, "displaced" => nil} = body["data"]
      assert id == source.id
      assert stored_position(source) == {f.today, :snack}
    end

    test "answers 404 for the meal of another Account and leaves it in place", f do
      %{account: other_account} = insert_identity!(plan: :family_4)
      foreign = scheduled!(other_account.id, f.tomorrow, :dinner)

      conn = move(f.token, foreign.id, %{"date" => Date.to_iso8601(f.today), "slot" => "lunch"})

      assert %{"error" => %{"code" => "scheduled_meal_not_found"}} = json_response(conn, 404)
      assert stored_position(foreign) == {f.tomorrow, :dinner}
    end

    test "answers 409 for a cooked meal on either side", f do
      cooked = scheduled!(f.account_id, f.tomorrow, :dinner, %{is_cooked: true})
      source = scheduled!(f.account_id, f.tomorrow, :lunch)

      for {meal, destination} <- [{cooked, {f.today, "lunch"}}, {source, {f.tomorrow, "dinner"}}] do
        {date, slot} = destination
        conn = move(f.token, meal.id, %{"date" => Date.to_iso8601(date), "slot" => slot})

        assert %{"error" => %{"code" => "scheduled_meal_cooked"}} = json_response(conn, 409)
      end

      assert stored_position(cooked) == {f.tomorrow, :dinner}
      assert stored_position(source) == {f.tomorrow, :lunch}
    end

    test "answers 409 for a meal being cooked on either side", f do
      cooking = scheduled!(f.account_id, f.today, :lunch)
      source = scheduled!(f.account_id, f.tomorrow, :dinner)
      cooking_session!(cooking, :active)

      for {meal, {date, slot}} <- [{cooking, {f.tomorrow, "lunch"}}, {source, {f.today, "lunch"}}] do
        conn = move(f.token, meal.id, %{"date" => Date.to_iso8601(date), "slot" => slot})

        assert %{"error" => %{"code" => "calendar_meal_cooking_in_progress"}} =
                 json_response(conn, 409)
      end

      assert stored_position(cooking) == {f.today, :lunch}
      assert stored_position(source) == {f.tomorrow, :dinner}
    end

    test "answers 422 naming the field for an invalid slot or date", f do
      source = scheduled!(f.account_id, f.tomorrow, :dinner)
      today = Date.to_iso8601(f.today)
      tomorrow = Date.to_iso8601(f.tomorrow)

      for {body, field} <- [
            {%{"date" => today, "slot" => "brunch"}, "slot"},
            {%{"date" => today}, "slot"},
            {%{"date" => "08/10/2026", "slot" => "lunch"}, "date"},
            {%{"slot" => "lunch"}, "date"},
            # The position the meal already has.
            {%{"date" => tomorrow, "slot" => "dinner"}, "slot"}
          ] do
        assert %{"error" => %{"code" => "validation_error", "message" => message}} =
                 f.token |> move(source.id, body) |> json_response(422)

        assert message =~ field
      end

      assert stored_position(source) == {f.tomorrow, :dinner}
    end

    test "denies an expired account when capability enforcement is enabled", f do
      user =
        user_with_memberships(
          %{email: "calendar-move-expired@example.com"},
          [{%{name: "Expired move account", plan: :family_4}, :owner}]
        )

      membership = hd(user.memberships)
      now = DateTime.utc_now()

      Repo.get!(Account, membership.account_id)
      |> Account.changeset(%{
        trial_started_at: DateTime.add(now, -86_400, :second),
        trial_ends_at: DateTime.add(now, -1, :second)
      })
      |> Repo.update!()

      source = scheduled!(membership.account_id, f.tomorrow, :dinner)
      token = issue_access_v2_token(user, membership)
      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      try do
        conn = move(token, source.id, %{"date" => Date.to_iso8601(f.today), "slot" => "lunch"})

        assert %{"error" => %{"code" => "trial_expired"}} = json_response(conn, 403)
        assert stored_position(source) == {f.tomorrow, :dinner}
      after
        Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, previous)
      end
    end

    test "answers 404 for an id that is not a UUID", f do
      conn = move(f.token, "not-a-uuid", %{"date" => Date.to_iso8601(f.today), "slot" => "lunch"})

      assert %{"error" => %{"code" => "scheduled_meal_not_found"}} = json_response(conn, 404)
    end

    # Two open items of one meal that only differ in their planned date would
    # share a key on the new date. A retry fails the same way, so the answer
    # is not the retryable `calendar_conflict`.
    @tag :capture_log
    test "answers 409 calendar_move_not_possible when the stored Shopping items cannot follow the meal",
         f do
      source = scheduled!(f.account_id, f.tomorrow, :dinner)
      target = scheduled!(f.account_id, f.today, :lunch)
      item = open_planned_item!(source, source.date)
      open_planned_item!(source, Date.add(f.today, 5), item.ingredient_id)

      conn = move(f.token, source.id, %{"date" => Date.to_iso8601(f.today), "slot" => "lunch"})

      assert %{"error" => %{"code" => "calendar_move_not_possible", "message" => message}} =
               json_response(conn, 409)

      refute message =~ ~r/retry|again/i
      assert stored_position(source) == {f.tomorrow, :dinner}
      assert stored_position(target) == {f.today, :lunch}
      assert Repo.get!(ShoppingItem, item.id).planned_date == f.tomorrow
    end

    # The move parks a meal on a date of year 10000 while it swaps two keys,
    # which is safe only while no request can store a meal or a Slot favorite
    # there. The date parser takes four-digit years alone.
    test "answers 422 naming date for a date with a five-digit year", f do
      source = scheduled!(f.account_id, f.tomorrow, :dinner)

      for date <- ["10000-01-01", "+10000-01-01"] do
        assert %{"error" => %{"code" => "validation_error", "message" => message}} =
                 f.token
                 |> move(source.id, %{"date" => date, "slot" => "dinner"})
                 |> json_response(422)

        assert message =~ "date"
      end

      assert stored_position(source) == {f.tomorrow, :dinner}
    end

    test "PUT /api/calendar/meals/range answers 422 for a date with a five-digit year", f do
      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> f.token)
        |> put("/api/calendar/meals/range", %{
          "from" => "10000-01-01",
          "to" => "10000-01-01",
          "meals" => [%{"date" => "10000-01-01", "slot" => "dinner"}]
        })

      assert %{"error" => "invalid_date_format"} = json_response(conn, 422)
    end

    # An open planned Shopping item of the meal for `planned_date`, for an
    # Ingredient of its own unless `ingredient_id` names one.
    defp open_planned_item!(meal, planned_date, ingredient_id \\ nil) do
      ingredient_id =
        ingredient_id ||
          elem(
            Catalog.create_ingredient(%{name: "Move #{Ecto.UUID.generate()}", category: :otros}),
            1
          ).id

      %ShoppingItem{}
      |> ShoppingItem.changeset(%{
        account_id: meal.account_id,
        scheduled_meal_id: meal.id,
        ingredient_id: ingredient_id,
        planned_date: planned_date,
        quantity_milli: 200,
        unit: :g,
        status: :pending
      })
      |> Repo.insert!()
    end
  end

  defp cooking_session!(meal, status) do
    now = DateTime.utc_now()

    {:ok, session} =
      PlanningRepo.create_cooking_session(%{
        account_id: meal.account_id,
        scheduled_meal_id: meal.id,
        status: status,
        started_at: now,
        completed_at: if(status == :completed, do: now)
      })

    session
  end

  # `Date.from_iso8601/1` reads years from -9999 and PostgreSQL raises on a
  # date before 4713 BC, so such a date used to answer 500. Every route that
  # reads a date rejects one before year 1.
  describe "a date before year 1" do
    @before_year_one "-9999-01-01"

    setup do
      %{token: token, account: account} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account)

      %{token: token, account_id: account.id, today: today}
    end

    defp authorized(token) do
      build_conn() |> put_req_header("authorization", "Bearer " <> token)
    end

    test "GET /api/calendar answers 422", f do
      conn =
        f.token
        |> authorized()
        |> get("/api/calendar", %{
          "start_date" => @before_year_one,
          "end_date" => @before_year_one
        })

      assert %{"error" => "invalid_date_format"} = json_response(conn, 422)
    end

    test "GET /api/calendar/slot answers 422", f do
      conn =
        f.token
        |> authorized()
        |> get("/api/calendar/slot", %{"date" => @before_year_one, "slot" => "lunch"})

      assert %{"error" => "invalid_date_format"} = json_response(conn, 422)
    end

    test "PUT /api/calendar/meals/range answers 422", f do
      conn =
        f.token
        |> authorized()
        |> put("/api/calendar/meals/range", %{
          "from" => @before_year_one,
          "to" => @before_year_one,
          "meals" => []
        })

      assert %{"error" => "invalid_date_format"} = json_response(conn, 422)
    end

    test "POST /api/calendar/meals/:id/move answers 422 naming date and leaves the meal", f do
      source = scheduled!(f.account_id, f.today, :dinner)

      assert %{"error" => %{"code" => "validation_error", "message" => message}} =
               f.token
               |> move(source.id, %{"date" => @before_year_one, "slot" => "snack"})
               |> json_response(422)

      assert message =~ "date"
      assert stored_position(source) == {f.today, :dinner}
    end

    test "year 1 is the first date accepted", f do
      slot_on = fn date ->
        f.token |> authorized() |> get("/api/calendar/slot", %{"date" => date, "slot" => "lunch"})
      end

      assert %{"error" => "invalid_date_format"} = json_response(slot_on.("0000-12-31"), 422)
      assert %{"data" => %{"date" => "0001-01-01"}} = json_response(slot_on.("0001-01-01"), 200)
    end
  end
end
