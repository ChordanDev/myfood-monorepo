defmodule MealPlannerApiWeb.ShoppingControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Accounts.Account, as: PersistenceAccount
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo

  describe "shopping capability gate — flag enabled (#36 AC 1)" do
    test "expired Account receives 403 trial_expired", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "shopping_expired_#{Ecto.UUID.generate()}@example.com"},
          [{%{plan: :family_4, name: "Expired shopping account"}, :owner}]
        )

      [membership] = user.memberships
      _account = persist_trial_window!(membership.account, :expired)
      token = issue_access_v2_token(user, membership)

      with_capability_enforcement(fn ->
        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> get("/api/shopping-list")

        assert %{"error" => %{"code" => "trial_expired"}} = json_response(conn, 403)
      end)
    end

    test "active Account can read shopping without a false denial", %{conn: conn} do
      user =
        user_with_memberships(
          %{email: "shopping_active_#{Ecto.UUID.generate()}@example.com"},
          [{%{plan: :family_4, name: "Active shopping account"}, :owner}]
        )

      [membership] = user.memberships
      _account = persist_trial_window!(membership.account, :eligible)
      token = issue_access_v2_token(user, membership)

      with_capability_enforcement(fn ->
        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> get("/api/shopping-list")

        assert %{"data" => _} = json_response(conn, 200)
      end)
    end
  end

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.17) ───────────────────────────
  # See calendar_controller_test.exs (task 3.14) for why a tampered
  # `account_id` claim is the genuine RED-discriminating case here.
  describe "multi-familia tenancy scoping (task 3.17)" do
    test "GET /api/shopping-list resolves items via current_membership.account_id, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "shopping_tamper@example.com"}, [
          {%{plan: :family_4, name: "Shopping Tamper Account A"}, :owner},
          {%{plan: :family_4, name: "Shopping Tamper Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      {:ok, ingredient} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Shopping Tamper Ingredient",
          category: :verduras,
          calories_per_100: 40,
          protein_g_per_100: Decimal.new("1.2"),
          carbs_g_per_100: Decimal.new("9.3"),
          fat_g_per_100: Decimal.new("0.1")
        })

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: membership_a.account_id,
          created_by_user_id: user.id,
          name: "Shopping Tamper Recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:dinner]
        })

      today = Date.utc_today()

      {:ok, meal} =
        Planning.schedule_meal(%{
          account_id: membership_a.account_id,
          date: today,
          slot: :dinner,
          recipe_id: recipe.id,
          is_cooked: false
        })

      {:ok, _item} =
        Shopping.create_shopping_item(%{
          account_id: membership_a.account_id,
          scheduled_meal_id: meal.id,
          planned_date: today,
          ingredient_id: ingredient.id,
          quantity_milli: 500,
          unit: :g,
          status: :pending
        })

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/shopping-list")

      body = json_response(conn, 200)
      ingredient_ids = Enum.map(body["data"]["planned"], & &1["ingredientId"])

      assert ingredient.id in ingredient_ids
    end
  end

  describe "shopping provenance and isolation (#36 AC 4)" do
    test "GET /api/shopping-list returns no plan-derived items before any confirmation", %{
      conn: conn
    } do
      user =
        user_with_memberships(
          %{email: "shopping_provenance_pending@example.com"},
          [{%{plan: :family_4, name: "Shopping Provenance Pending Account"}, :owner}]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      {:ok, ingredient} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Shopping Provenance Pending Ingredient",
          category: :verduras
        })

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: membership.account_id,
          created_by_user_id: user.id,
          name: "Shopping Provenance Pending Recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, _recipe_ingredient} =
        Catalog.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: ingredient.id,
          quantity_milli: 450_000,
          unit: :g
        })

      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: membership.account_id,
          user_id: user.id,
          status: :processing,
          started_at: DateTime.utc_now(),
          input_context: %{}
        })

      today = Date.utc_today()

      {:ok, _proposal} =
        PlanningRepo.create_proposal(%{
          generation_run_id: run.id,
          status: :pending,
          proposal_json: %{
            slots: [
              %{
                slot_key: "#{Date.to_iso8601(today)}_lunch",
                date: Date.to_iso8601(today),
                slot: "lunch",
                recipe_id: recipe.id,
                recipe_name: recipe.name,
                price_cents: 1000
              }
            ]
          }
        })

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/shopping-list")

      assert %{"data" => %{"planned" => planned, "plannedDates" => planned_dates}} =
               json_response(conn, 200)

      assert planned == []
      assert planned_dates == []
    end

    test "another Account's membership cannot read this cart", %{conn: conn} do
      user_a =
        user_with_memberships(
          %{email: "shopping_isolation_owner_a@example.com"},
          [{%{plan: :family_4, name: "Shopping Isolation Account A"}, :owner}]
        )

      [membership_a] = user_a.memberships

      user_b =
        user_with_memberships(
          %{email: "shopping_isolation_reader_b@example.com"},
          [{%{plan: :family_4, name: "Shopping Isolation Account B"}, :owner}]
        )

      [membership_b] = user_b.memberships
      token_b = issue_access_v2_token(user_b, membership_b)

      {:ok, ingredient_a} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Shopping Isolation Ingredient A",
          category: :verduras
        })

      {:ok, recipe_a} =
        Catalog.create_recipe(%{
          account_id: membership_a.account_id,
          created_by_user_id: user_a.id,
          name: "Shopping Isolation Recipe A",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:dinner]
        })

      today = Date.utc_today()

      {:ok, meal_a} =
        Planning.schedule_meal(%{
          account_id: membership_a.account_id,
          date: today,
          slot: :dinner,
          recipe_id: recipe_a.id,
          is_cooked: false
        })

      {:ok, _item_a} =
        Shopping.create_shopping_item(%{
          account_id: membership_a.account_id,
          scheduled_meal_id: meal_a.id,
          planned_date: today,
          ingredient_id: ingredient_a.id,
          quantity_milli: 625_000,
          unit: :g,
          status: :pending
        })

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token_b)
        |> get("/api/shopping-list")

      assert %{"data" => %{"planned" => planned, "cart" => nil}} = json_response(conn, 200)
      refute ingredient_a.id in Enum.map(planned, & &1["ingredientId"])
    end
  end

  # ─── Issue #39 — the list the mobile app reads ──────────────────────────────
  # One ingredient needed by two meals: lunch today and dinner in two days,
  # 400 g each. The read itself derives the Shopping items from the plan.
  describe "GET /api/shopping-list contract (#39)" do
    setup do
      suffix = Ecto.UUID.generate()
      account = Fixtures.insert_account("Shopping list #{suffix}")
      owner = Fixtures.insert_user_with_membership(account, "list-owner-#{suffix}@example.com")

      member =
        Fixtures.insert_user_with_membership(
          account,
          "list-member-#{suffix}@example.com",
          :member
        )

      ingredient = Fixtures.insert_ingredient("List ingredient #{suffix}")

      recipe =
        Fixtures.insert_recipe("List recipe #{suffix}",
          account_id: account.id,
          created_by_user_id: owner.id
        )

      Fixtures.attach_recipe_ingredient(recipe, ingredient, 400, :g)

      today = Date.utc_today()
      later = Date.add(today, 2)

      [first_meal, second_meal] =
        for {date, slot} <- [{today, :lunch}, {later, :dinner}] do
          {:ok, meal} =
            Planning.schedule_meal(%{
              account_id: account.id,
              date: date,
              slot: slot,
              recipe_id: recipe.id,
              is_cooked: false
            })

          meal
        end

      %{
        account: account,
        ingredient: ingredient,
        first_meal: first_meal,
        second_meal: second_meal,
        today: Date.to_iso8601(today),
        later: Date.to_iso8601(later),
        owner_token: membership_token(owner, account),
        member_token: membership_token(member, account)
      }
    end

    test "responds with planned lines, manual, cart, totals and plannedDates in camelCase", c do
      data = shopping_list(c.owner_token)

      assert sorted_keys(data) == ~w(cart manual planned plannedDates totals)
      assert [line] = data["planned"]

      assert sorted_keys(line) ==
               ~w(allocations category id ingredientId name quantityMilli source status supermarketId unit)

      assert line["id"] == "#{c.ingredient.id}:g"
      assert line["ingredientId"] == c.ingredient.id
      assert line["name"] == c.ingredient.name
      assert line["category"] == "otros"
      assert line["quantityMilli"] == 800
      assert line["unit"] == "g"
      assert line["status"] == "needed"
      assert line["source"] == "planned_meal"
      assert line["supermarketId"] == nil

      assert [first, second] = line["allocations"]
      assert sorted_keys(first) == ~w(date itemId quantityMilli scheduledMealId slot)
      assert is_binary(first["itemId"])

      assert Map.delete(first, "itemId") == %{
               "scheduledMealId" => c.first_meal.id,
               "date" => c.today,
               "slot" => "lunch",
               "quantityMilli" => 400
             }

      assert Map.delete(second, "itemId") == %{
               "scheduledMealId" => c.second_meal.id,
               "date" => c.later,
               "slot" => "dinner",
               "quantityMilli" => 400
             }

      assert data["manual"] == []
      assert data["cart"] == nil

      assert data["totals"] == %{
               "needed" => 1,
               "inCart" => 0,
               "removed" => 0,
               "estimatedCents" => 0
             }

      assert data["plannedDates"] == [c.today, c.later]
    end

    test "groupBy=ingredient aggregates the two meals and is the default", c do
      data = shopping_list(c.owner_token, %{"groupBy" => "ingredient"})

      assert [%{"quantityMilli" => 800, "allocations" => [_, _]}] = data["planned"]
      assert data == shopping_list(c.owner_token)
    end

    test "groupBy=meal splits the ingredient into one line per meal", c do
      data = shopping_list(c.owner_token, %{"groupBy" => "meal"})

      assert [first, second] = data["planned"]

      for {line, meal} <- [{first, c.first_meal}, {second, c.second_meal}] do
        assert [%{"itemId" => item_id, "scheduledMealId" => scheduled_meal_id}] =
                 line["allocations"]

        assert line["id"] == item_id
        assert scheduled_meal_id == meal.id
        assert line["ingredientId"] == c.ingredient.id
        assert line["quantityMilli"] == 400
      end

      assert data["totals"]["needed"] == 2
    end

    test "untilDate keeps the boundary day and leaves out the day after", c do
      day_before = c.later |> Date.from_iso8601!() |> Date.add(-1) |> Date.to_iso8601()
      first_meal_id = c.first_meal.id

      limited = shopping_list(c.owner_token, %{"untilDate" => day_before})

      assert [
               %{
                 "quantityMilli" => 400,
                 "allocations" => [%{"scheduledMealId" => ^first_meal_id}]
               }
             ] =
               limited["planned"]

      # The meal after the limit has no Shopping item derived yet.
      assert length(Shopping.list_items_for_account(c.account.id)) == 1

      boundary = shopping_list(c.owner_token, %{"untilDate" => c.later})

      assert [%{"quantityMilli" => 800, "allocations" => [_, _]}] = boundary["planned"]

      # Once that item exists, the limit still keeps it off the list.
      assert shopping_list(c.owner_token, %{"untilDate" => day_before}) == limited
    end

    test "plannedDates lists every planned day whatever untilDate is", c do
      assert shopping_list(c.owner_token, %{"untilDate" => c.today})["plannedDates"] ==
               [c.today, c.later]
    end

    test "cart is null without a Cart and carries the caller's own Cart once items are marked",
         c do
      before = shopping_list(c.owner_token, %{"groupBy" => "meal"})

      assert before["cart"] == nil

      marked =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> c.owner_token)
        |> post("/api/shopping-items/mark-cart", %{
          "itemIds" => Enum.map(before["planned"], & &1["id"])
        })
        |> json_response(200)
        |> Map.fetch!("data")

      own = shopping_list(c.owner_token)

      # Reading the list does not renew the lease.
      assert own["cart"] == %{
               "sessionId" => marked["sessionId"],
               "leaseExpiresAt" => marked["leaseExpiresAt"]
             }

      assert [%{"status" => "in_cart"}] = own["planned"]

      assert own["totals"] == %{
               "needed" => 0,
               "inCart" => 1,
               "removed" => 0,
               "estimatedCents" => 0
             }

      # A line held in another member's Cart reads in_cart; the Cart is theirs.
      theirs = shopping_list(c.member_token)

      assert [%{"status" => "in_cart"}] = theirs["planned"]
      assert theirs["cart"] == nil
    end

    test "a malformed untilDate is rejected with the error envelope", c do
      assert rejected_shopping_list(c.owner_token, %{"untilDate" => "08/10/2026"}) ==
               "validation_error"

      # A rejected read derives nothing from the plan.
      assert Shopping.list_items_for_account(c.account.id) == []
    end

    test "an untilDate before the Account's today is rejected with the error envelope", c do
      yesterday = c.today |> Date.from_iso8601!() |> Date.add(-1) |> Date.to_iso8601()

      assert rejected_shopping_list(c.owner_token, %{"untilDate" => yesterday}) ==
               "validation_error"
    end

    test "an unknown groupBy is rejected with the error envelope", c do
      assert rejected_shopping_list(c.owner_token, %{"groupBy" => "category"}) ==
               "validation_error"
    end
  end

  test "shopping list supports grouping, assignment, cart marking and checkout" do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    start_date = Date.utc_today()
    end_date = Date.add(start_date, 6)
    second_meal_date = Date.add(start_date, 3)

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Carne Test Shopping",
        category: :carnes,
        calories_per_100: 250,
        protein_g_per_100: Decimal.new("26.0"),
        carbs_g_per_100: Decimal.new("0.0"),
        fat_g_per_100: Decimal.new("15.0")
      })

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Milanesa y estofado",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:lunch]
      })

    {:ok, _step} =
      Catalog.add_recipe_step(%{
        recipe_id: recipe.id,
        step_number: 1,
        instructions: "Preparar carne",
        duration_minutes: 20
      })

    {:ok, _ri} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 500,
        unit: :g
      })

    {:ok, meal_1} =
      Planning.schedule_meal(%{
        account_id: account_id,
        date: start_date,
        slot: :lunch,
        recipe_id: recipe.id,
        is_cooked: false
      })

    {:ok, meal_2} =
      Planning.schedule_meal(%{
        account_id: account_id,
        date: second_meal_date,
        slot: :lunch,
        recipe_id: recipe.id,
        is_cooked: false
      })

    # Manual shopping rows so grouped quantity is deterministic: 500g + 400g = 900g
    {:ok, _item_1} =
      Shopping.create_shopping_item(%{
        account_id: account_id,
        scheduled_meal_id: meal_1.id,
        planned_date: start_date,
        ingredient_id: ingredient.id,
        quantity_milli: 500,
        unit: :g,
        status: :pending,
        estimated_price_cents: 6000
      })

    {:ok, _item_2} =
      Shopping.create_shopping_item(%{
        account_id: account_id,
        scheduled_meal_id: meal_2.id,
        planned_date: second_meal_date,
        ingredient_id: ingredient.id,
        quantity_milli: 400,
        unit: :g,
        status: :pending,
        estimated_price_cents: 4500
      })

    {:ok, supermarket_a} =
      Shopping.upsert_supermarket_by_name(%{
        name: "Coto Test",
        chain: "Coto",
        pricing_scrape_enabled: true
      })

    list_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/shopping-list")

    list_body = json_response(list_conn, 200)
    assert [grouped] = list_body["data"]["planned"]

    assert grouped["ingredientId"] == ingredient.id
    assert grouped["quantityMilli"] == 900
    assert grouped["category"] == "carnes"
    assert grouped["status"] == "needed"
    assert grouped["supermarketId"] == nil
    assert Enum.map(grouped["allocations"], & &1["quantityMilli"]) == [500, 400]
    assert list_body["data"]["cart"] == nil

    assert list_body["data"]["totals"] == %{
             "needed" => 1,
             "inCart" => 0,
             "removed" => 0,
             "estimatedCents" => 10_500
           }

    mark_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/shopping-items/mark-cart", %{
        "ingredient_id" => ingredient.id,
        "in_cart" => true,
        "start_date" => Date.to_iso8601(start_date),
        "end_date" => Date.to_iso8601(end_date)
      })

    mark_body = json_response(mark_conn, 200)
    assert %{"sessionId" => _, "leaseExpiresAt" => _, "items" => [_, _]} = mark_body["data"]
    refute Map.has_key?(mark_body["data"], "updatedRows")

    assign_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/shopping-items/assign-supermarket", %{
        "ingredient_id" => ingredient.id,
        "supermarket_id" => supermarket_a.id,
        "start_date" => Date.to_iso8601(start_date),
        "end_date" => Date.to_iso8601(end_date)
      })

    assign_body = json_response(assign_conn, 200)
    assert assign_body["data"]["assignedSupermarketId"] == supermarket_a.id
    assert assign_body["data"]["updatedRows"] == 2

    # The list reads the reservation and the assignment back.
    in_cart_body =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/shopping-list")
      |> json_response(200)

    assert [%{"status" => "in_cart", "supermarketId" => supermarket_id}] =
             in_cart_body["data"]["planned"]

    assert supermarket_id == supermarket_a.id
    assert in_cart_body["data"]["cart"]["sessionId"] == mark_body["data"]["sessionId"]

    assert in_cart_body["data"]["totals"] == %{
             "needed" => 0,
             "inCart" => 1,
             "removed" => 0,
             "estimatedCents" => 0
           }

    checkout_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/checkout/confirm", %{
        "checkout_type" => "physical",
        "session_id" => mark_body["data"]["sessionId"],
        "lines" => [
          %{"item_id" => "#{ingredient.id}:g", "quantity_milli" => 900, "total_cents" => 10_000}
        ],
        "start_date" => Date.to_iso8601(start_date),
        "end_date" => Date.to_iso8601(end_date)
      })

    checkout_body = json_response(checkout_conn, 200)
    assert checkout_body["data"]["status"] == "completed"
    assert checkout_body["data"]["checkoutType"] == "physical"
    # Two shopping items moved to inventory
    assert checkout_body["data"]["movedToInventoryCount"] == 2

    inventory = Inventory.list_inventory(account_id)
    assert length(inventory) == 2
    # Total quantity: 500 + 400 = 900g
    total_qty = Enum.reduce(inventory, 0, fn i, acc -> acc + (i.quantity_milli || 0) end)
    assert total_qty == 900

    shopping_items = Shopping.list_items_for_account(account_id)
    assert Enum.all?(shopping_items, &(&1.status == :checked_out))
  end

  test "shopping list creates only the missing quantity after subtracting available inventory" do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    start_date = Date.add(Date.utc_today(), 1)

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Carne Delta Shopping",
        category: :carnes,
        calories_per_100: 250,
        protein_g_per_100: Decimal.new("26.0"),
        carbs_g_per_100: Decimal.new("0.0"),
        fat_g_per_100: Decimal.new("15.0")
      })

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Bife delta",
        source: :user_created,
        servings: 1,
        suitable_for_slots: [:lunch]
      })

    {:ok, _ri} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 400,
        unit: :g
      })

    {:ok, _meal} =
      Planning.schedule_meal(%{
        account_id: account_id,
        date: start_date,
        slot: :lunch,
        recipe_id: recipe.id,
        is_cooked: false
      })

    {:ok, _inventory_item} =
      Inventory.apply_delta_and_log(%{
        account_id: account_id,
        ingredient_id: ingredient.id,
        unit: :g,
        source_kind: :planned,
        delta: 500,
        source_user_id: user_id,
        trigger_type: :purchase,
        operation: :add
      })

    list_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/shopping-list")

    body = json_response(list_conn, 200)

    # 400g needed, 500g in inventory = no purchase needed (surplus)
    assert body["data"]["planned"] == []
    assert body["data"]["plannedDates"] == [Date.to_iso8601(start_date)]
  end

  test "past unpurchased rows are auto-pruned" do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Leche Test Prune",
        category: :lacteos,
        calories_per_100: 60,
        protein_g_per_100: Decimal.new("3.2"),
        carbs_g_per_100: Decimal.new("4.8"),
        fat_g_per_100: Decimal.new("3.3")
      })

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Cafe con leche",
        source: :user_created,
        servings: 1,
        suitable_for_slots: [:breakfast]
      })

    {:ok, _ri} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 250,
        unit: :ml
      })

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account_id,
        date: Date.add(Date.utc_today(), -2),
        slot: :breakfast,
        recipe_id: recipe.id,
        is_cooked: false
      })

    {:ok, _item} =
      Shopping.create_shopping_item(%{
        account_id: account_id,
        scheduled_meal_id: meal.id,
        planned_date: Date.add(Date.utc_today(), -2),
        ingredient_id: ingredient.id,
        quantity_milli: 250,
        unit: :ml,
        status: :pending
      })

    _ =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/shopping-list")

    items = Shopping.list_items_for_account(account_id, include_archived: true)
    assert Enum.any?(items, &(&1.status == :archived))
  end

  test "online purchase confirmation adds inventory once its delivery is acknowledged" do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    start_date = Date.utc_today()
    end_date = Date.add(start_date, 6)
    planned_date = Date.add(start_date, 1)

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Arroz Test Online",
        category: :granos,
        calories_per_100: 130,
        protein_g_per_100: Decimal.new("2.7"),
        carbs_g_per_100: Decimal.new("28.0"),
        fat_g_per_100: Decimal.new("0.3")
      })

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Arroz simple",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    {:ok, _ri} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 300,
        unit: :g
      })

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account_id,
        date: planned_date,
        slot: :dinner,
        recipe_id: recipe.id,
        is_cooked: false
      })

    {:ok, item} =
      Shopping.create_shopping_item(%{
        account_id: account_id,
        scheduled_meal_id: meal.id,
        planned_date: planned_date,
        ingredient_id: ingredient.id,
        quantity_milli: 300,
        unit: :g,
        status: :pending,
        estimated_price_cents: 2000
      })

    cart =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/shopping-items/mark-cart", %{"item_ids" => [item.id]})
      |> json_response(200)
      |> Map.fetch!("data")

    checkout_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/checkout/confirm", %{
        "checkout_type" => "online",
        "session_id" => cart["sessionId"],
        "lines" => [
          %{"item_id" => "#{ingredient.id}:g", "quantity_milli" => 300, "total_cents" => 2000}
        ],
        "start_date" => Date.to_iso8601(start_date),
        "end_date" => Date.to_iso8601(end_date)
      })

    checkout_body = json_response(checkout_conn, 200)

    # An online purchase waits for its delivery: nothing is stocked at confirm.
    assert checkout_body["data"]["status"] == "pending_delivery"
    assert checkout_body["data"]["movedToInventoryCount"] == 0
    assert Inventory.list_inventory(account_id) == []

    shopping_items = Shopping.list_items_for_account(account_id)
    assert Enum.all?(shopping_items, &(&1.status == :pending_delivery))

    delivered_body =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/checkout/sessions/#{cart["sessionId"]}/delivered", %{})
      |> json_response(200)

    assert delivered_body["data"]["status"] == "completed"
    assert delivered_body["data"]["movedToInventoryCount"] == 1

    inventory = Inventory.list_inventory(account_id)
    assert length(inventory) == 1
    assert hd(inventory).quantity_milli == 300

    shopping_items = Shopping.list_items_for_account(account_id)
    assert Enum.all?(shopping_items, &(&1.status == :checked_out))
  end

  # ---- shopping list read helpers (#39) -------------------------------------

  defp membership_token(user, account) do
    membership =
      AccountMembership
      |> Repo.get_by!(user_id: user.id, account_id: account.id)
      |> Repo.preload(:account)

    issue_access_v2_token(user, membership)
  end

  # The `data` of a 200 read, after checking that every key is camelCase.
  defp shopping_list(token, params \\ %{}) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> get("/api/shopping-list", params)
    |> json_response(200)
    |> assert_camel_case_keys()
    |> Map.fetch!("data")
  end

  # The code of a 422 read, after checking that the body is the envelope.
  defp rejected_shopping_list(token, params) do
    body =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/shopping-list", params)
      |> json_response(422)

    assert %{"error" => %{"code" => code, "message" => message} = error} = body
    assert sorted_keys(body) == ["error"]
    assert sorted_keys(error) == ["code", "message"]
    assert is_binary(message) and message != ""

    code
  end

  defp sorted_keys(map), do: map |> Map.keys() |> Enum.sort()

  # ---- capability-gate helpers (#36 AC 1) ---------------------------------

  defp persist_trial_window!(%PersistenceAccount{} = account, :eligible) do
    started = DateTime.utc_now()
    ends = DateTime.add(started, 7 * 86_400, :second)

    account
    |> PersistenceAccount.changeset(%{trial_started_at: started, trial_ends_at: ends})
    |> Repo.update!()
  end

  defp persist_trial_window!(%PersistenceAccount{} = account, :expired) do
    past = DateTime.add(DateTime.utc_now(), -30 * 86_400, :second)

    account
    |> PersistenceAccount.changeset(%{trial_started_at: past, trial_ends_at: past})
    |> Repo.update!()
  end

  defp with_capability_enforcement(fun) do
    previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
    Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

    try do
      fun.()
    after
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, previous)
    end
  end
end
