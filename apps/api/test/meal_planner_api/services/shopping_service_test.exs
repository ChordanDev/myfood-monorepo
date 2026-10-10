defmodule MealPlannerApi.ShoppingServiceTest do
  use ExUnit.Case, async: true

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.ShoppingService

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  defp create_test_ingredient(_account_id) do
    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Test Ingredient #{System.unique_integer([:positive])}",
        category: :carnes,
        calories_per_100: 250,
        protein_g_per_100: Decimal.new("26.0"),
        carbs_g_per_100: Decimal.new("0.0"),
        fat_g_per_100: Decimal.new("15.0")
      })

    ingredient
  end

  defp create_test_recipe(account_id, user_id) do
    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Test Recipe #{:rand.uniform(10000)}",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:lunch]
      })

    {:ok, _step} =
      Catalog.add_recipe_step(%{
        recipe_id: recipe.id,
        step_number: 1,
        instructions: "Cook it",
        duration_minutes: 20
      })

    recipe
  end

  # ==========================================================================
  # TASK-11: Tests for confirm_checkout transaction and get_shopping_list pruning
  # ==========================================================================

  describe "confirm_checkout/3" do
    test "wraps in transaction and calls move_items_to_inventory" do
      {:ok, identity} =
        Identity.ensure_persistent_identity(%{
          id: "u_checkout_txn_#{:rand.uniform(10000)}",
          account_id: "acct_checkout_txn_#{:rand.uniform(10000)}",
          plan: :family_4
        })

      account_id = identity.account_id
      user = %{id: identity.user_id, account_id: account_id, plan: :family_4}
      ensure_membership!(user)

      ingredient = create_test_ingredient(account_id)
      recipe = create_test_recipe(account_id, identity.user_id)

      {:ok, _ri} =
        Catalog.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: ingredient.id,
          quantity_milli: 500,
          unit: :g
        })

      {:ok, meal} =
        Planning.schedule_meal(%{
          account_id: account_id,
          date: Date.utc_today(),
          slot: :lunch,
          recipe_id: recipe.id,
          is_cooked: false
        })

      {:ok, session} =
        Shopping.create_checkout_session(%{
          account_id: account_id,
          status: :draft,
          checkout_type: :physical,
          started_at: DateTime.utc_now()
        })

      {:ok, item} =
        Shopping.create_shopping_item(%{
          account_id: account_id,
          scheduled_meal_id: meal.id,
          checkout_session_id: session.id,
          planned_date: Date.utc_today(),
          ingredient_id: ingredient.id,
          quantity_milli: 500,
          unit: :g,
          status: :pending
        })

      {:ok, cart} = ShoppingService.mark_in_cart(user, [item.id])

      result =
        ShoppingService.confirm_checkout(user, cart.session_id, %{
          "checkout_type" => "physical",
          "items" =>
            Enum.map(
              cart.reservations,
              &(Map.new(&1, fn {k, v} -> {Atom.to_string(k), v} end)
                |> Map.put("total_cents", 5000))
            )
        })

      assert {:ok, response} = result
      assert response.status == "completed"
      assert response.moved_to_inventory_count >= 0
    end

    test "returns moved_to_inventory_count in response" do
      {:ok, identity} =
        Identity.ensure_persistent_identity(%{
          id: "u_count_#{:rand.uniform(10000)}",
          account_id: "acct_count_#{:rand.uniform(10000)}",
          plan: :family_4
        })

      account_id = identity.account_id
      user = %{id: identity.user_id, account_id: account_id, plan: :family_4}
      ensure_membership!(user)

      ingredient = create_test_ingredient(account_id)
      recipe = create_test_recipe(account_id, identity.user_id)

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
          date: Date.utc_today(),
          slot: :dinner,
          recipe_id: recipe.id,
          is_cooked: false
        })

      {:ok, session} =
        Shopping.create_checkout_session(%{
          account_id: account_id,
          status: :draft,
          checkout_type: :physical,
          started_at: DateTime.utc_now()
        })

      {:ok, item1} =
        Shopping.create_shopping_item(%{
          account_id: account_id,
          scheduled_meal_id: meal.id,
          checkout_session_id: session.id,
          planned_date: Date.utc_today(),
          ingredient_id: ingredient.id,
          quantity_milli: 200,
          unit: :g,
          status: :pending
        })

      # A second Scheduled meal: only one open Shopping item is allowed per
      # Scheduled meal, planned date, Ingredient and unit.
      {:ok, second_meal} =
        Planning.schedule_meal(%{
          account_id: account_id,
          date: Date.utc_today(),
          slot: :lunch,
          recipe_id: recipe.id,
          is_cooked: false
        })

      {:ok, item2} =
        Shopping.create_shopping_item(%{
          account_id: account_id,
          scheduled_meal_id: second_meal.id,
          checkout_session_id: session.id,
          planned_date: Date.utc_today(),
          ingredient_id: ingredient.id,
          quantity_milli: 100,
          unit: :g,
          status: :pending
        })

      {:ok, cart} = ShoppingService.mark_in_cart(user, [item1.id, item2.id])

      result =
        ShoppingService.confirm_checkout(user, cart.session_id, %{
          "checkout_type" => "physical",
          "items" =>
            Enum.map(
              cart.reservations,
              &(Map.new(&1, fn {k, v} -> {Atom.to_string(k), v} end)
                |> Map.put("total_cents", 1500))
            )
        })

      assert {:ok, response} = result
      assert Map.has_key?(response, :moved_to_inventory_count)
      assert is_integer(response.moved_to_inventory_count)
    end

    test "rejects a missing cart" do
      {:ok, identity} =
        Identity.ensure_persistent_identity(%{
          id: "u_rollback_#{:rand.uniform(10000)}",
          account_id: "acct_rollback_#{:rand.uniform(10000)}",
          plan: :family_4
        })

      user = %{id: identity.user_id, account_id: identity.account_id, plan: :family_4}
      ensure_membership!(user)

      # Try to confirm a non-existent session
      fake_session_id = Ecto.UUID.generate()

      result =
        ShoppingService.confirm_checkout(user, fake_session_id, %{"actual_total_cents" => 1000})

      # Should return error for session not found
      assert result == {:error, :cart_not_found}
    end
  end

  defp ensure_membership!(user) do
    %AccountMembership{}
    |> AccountMembership.changeset(%{
      account_id: user.account_id,
      user_id: user.id,
      role: :owner,
      status: :active,
      joined_at: DateTime.utc_now()
    })
    |> Repo.insert!()
  end

  # Issue #39: the read takes the instant as its third argument. These tests
  # leave it at its default and build their dates from the current UTC day;
  # the "Account's today" block below is the one that fixes "now".
  describe "get_shopping_list/3" do
    test "archives past-dated pending items on every call" do
      {account_id, user} = identity!("archive")
      ingredient = create_test_ingredient(account_id)
      past_date = Date.add(Date.utc_today(), -5)

      meal = schedule_meal!(account_id, user.id, past_date, :breakfast, ingredient, 200)
      past_item = pending_item!(account_id, meal, ingredient, 200)

      assert {:ok, _response} = ShoppingService.get_shopping_list(user)

      # The same row is archived in place, and the write is stamped.
      assert %{status: :archived} = archived = Repo.get!(Shopping.ShoppingItem, past_item.id)
      assert archived.quantity_milli == 200
      assert archived.inserted_at == past_item.inserted_at
      assert DateTime.compare(archived.updated_at, past_item.updated_at) == :gt
    end

    test "does not list a past item it has just archived" do
      {account_id, user} = identity!("exclude")
      ingredient = create_test_ingredient(account_id)
      past_date = Date.add(Date.utc_today(), -3)

      meal = schedule_meal!(account_id, user.id, past_date, :lunch, ingredient, 150)
      _item = pending_item!(account_id, meal, ingredient, 150)

      assert {:ok, response} = ShoppingService.get_shopping_list(user)

      assert response.planned == []
      assert response.planned_dates == []
    end

    test "lists only pending and in cart items, as needed and in_cart" do
      {account_id, user} = identity!("statuses")
      date = Date.add(Date.utc_today(), 1)

      [pending, in_cart, archived, checked_out] =
        for {status, slot} <- [
              pending: :breakfast,
              in_cart: :lunch,
              archived: :snack,
              checked_out: :dinner
            ] do
          ingredient = create_test_ingredient(account_id)
          meal = schedule_meal!(account_id, user.id, date, slot)
          pending_item!(account_id, meal, ingredient, 100, %{status: status})
          ingredient.id
        end

      assert {:ok, response} = ShoppingService.get_shopping_list(user)

      assert Enum.map(response.planned, &{&1.ingredient_id, &1.status, &1.source}) == [
               {pending, "needed", "planned_meal"},
               {in_cart, "in_cart", "planned_meal"}
             ]

      refute archived in Enum.map(response.planned, & &1.ingredient_id)
      refute checked_out in Enum.map(response.planned, & &1.ingredient_id)
      assert response.manual == []
      assert response.totals.needed == 1
      assert response.totals.in_cart == 1
      assert response.totals.removed == 0
    end

    test "estimated_cents adds up the needed items only" do
      {account_id, user} = identity!("estimate")
      date = Date.add(Date.utc_today(), 1)
      ingredient = create_test_ingredient(account_id)

      for {slot, status, cents} <- [
            {:breakfast, :pending, 6000},
            {:lunch, :pending, 4500},
            {:dinner, :in_cart, 900}
          ] do
        meal = schedule_meal!(account_id, user.id, date, slot)

        pending_item!(account_id, meal, ingredient, 100, %{
          status: status,
          estimated_price_cents: cents
        })
      end

      assert {:ok, %{totals: totals}} = ShoppingService.get_shopping_list(user)

      # One ingredient line: part of it is in a Cart, so it still reads needed.
      assert totals == %{needed: 1, in_cart: 0, removed: 0, estimated_cents: 10_500}
    end

    test "orders lines by date, then by slot in the order of the day" do
      {account_id, user} = identity!("order")
      today = Date.utc_today()
      tomorrow = Date.add(today, 1)

      # Alphabetical slot order would put dinner before lunch and snack.
      planned =
        for {date, slot} <- [
              {tomorrow, :breakfast},
              {today, :dinner},
              {today, :snack},
              {today, :lunch}
            ] do
          ingredient = create_test_ingredient(account_id)
          schedule_meal!(account_id, user.id, date, slot, ingredient, 100)
          {date, slot, ingredient.id}
        end

      assert {:ok, response} = ShoppingService.get_shopping_list(user, %{"group_by" => "meal"})

      # The meals above are scheduled in the reverse of the expected order.
      expected =
        planned
        |> Enum.reverse()
        |> Enum.map(fn {date, slot, ingredient_id} ->
          {date, Atom.to_string(slot), ingredient_id}
        end)

      assert Enum.map(response.planned, fn %{allocations: [allocation]} = line ->
               {allocation.date, allocation.slot, line.ingredient_id}
             end) == expected

      assert response.planned_dates == [today, tomorrow]
    end

    test "rejects a malformed until_date and an unknown group_by" do
      {_account_id, user} = identity!("validation")

      for until_date <- ["08/10/2026", "2026-13-40", "", "tomorrow", 20_261_008] do
        assert {:error, {:validation_error, :until_date}} ==
                 ShoppingService.get_shopping_list(user, %{"until_date" => until_date})
      end

      for group_by <- ["category", "", "INGREDIENT", 1] do
        assert {:error, {:validation_error, :group_by}} ==
                 ShoppingService.get_shopping_list(user, %{"group_by" => group_by})
      end
    end
  end

  # 23:30 UTC on 8 October is already 9 October in Auckland (UTC+13).
  @late_utc_evening ~U[2026-10-08 23:30:00Z]

  describe "get_shopping_list/3 — the Account's today" do
    test "an Account ahead of UTC does not list a meal on the UTC day that is already its yesterday" do
      {account_id, user} = identity!("tz_ahead")
      set_timezone!(account_id, "Pacific/Auckland")

      utc_day = create_test_ingredient(account_id)
      account_day = create_test_ingredient(account_id)

      past_meal = schedule_meal!(account_id, user.id, ~D[2026-10-08], :dinner, utc_day, 300)
      past_item = pending_item!(account_id, past_meal, utc_day, 300)
      schedule_meal!(account_id, user.id, ~D[2026-10-09], :lunch, account_day, 300)

      assert {:ok, response} = ShoppingService.get_shopping_list(user, %{}, @late_utc_evening)

      assert Enum.map(response.planned, & &1.ingredient_id) == [account_day.id]
      assert response.planned_dates == [~D[2026-10-09]]

      # The item of the Account's yesterday is pruned by the same clock.
      assert Repo.get!(Shopping.ShoppingItem, past_item.id).status == :archived
    end

    test "an Account ahead of UTC rejects an until_date equal to the UTC day" do
      {account_id, user} = identity!("tz_until")
      set_timezone!(account_id, "Pacific/Auckland")

      assert {:error, {:validation_error, :until_date}} ==
               ShoppingService.get_shopping_list(
                 user,
                 %{"until_date" => "2026-10-08"},
                 @late_utc_evening
               )

      assert {:ok, _response} =
               ShoppingService.get_shopping_list(
                 user,
                 %{"until_date" => "2026-10-09"},
                 @late_utc_evening
               )
    end

    test "an Account with no timezone uses the UTC day" do
      {account_id, user} = identity!("tz_none")
      ingredient = create_test_ingredient(account_id)

      schedule_meal!(account_id, user.id, ~D[2026-10-08], :dinner, ingredient, 300)

      assert {:ok, response} =
               ShoppingService.get_shopping_list(
                 user,
                 %{"until_date" => "2026-10-08"},
                 @late_utc_evening
               )

      assert Enum.map(response.planned, & &1.ingredient_id) == [ingredient.id]
      assert response.planned_dates == [~D[2026-10-08]]

      assert {:error, {:validation_error, :until_date}} ==
               ShoppingService.get_shopping_list(
                 user,
                 %{"until_date" => "2026-10-07"},
                 @late_utc_evening
               )
    end
  end

  defp identity!(tag) do
    {:ok, identity} =
      Identity.ensure_persistent_identity(%{
        id: "u_#{tag}_#{:rand.uniform(1_000_000)}",
        account_id: "acct_#{tag}_#{:rand.uniform(1_000_000)}",
        plan: :family_4
      })

    {identity.account_id,
     %{id: identity.user_id, account_id: identity.account_id, plan: :family_4}}
  end

  defp set_timezone!(account_id, timezone) do
    Account
    |> Repo.get!(account_id)
    |> Account.changeset(%{timezone: timezone})
    |> Repo.update!()
  end

  # A Scheduled meal of a fresh recipe. Given an ingredient, the recipe needs
  # `quantity_milli` grams of it, so the read derives a Shopping item for it.
  defp schedule_meal!(account_id, user_id, date, slot, ingredient \\ nil, quantity_milli \\ nil) do
    recipe = create_test_recipe(account_id, user_id)

    if ingredient do
      {:ok, _ri} =
        Catalog.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: ingredient.id,
          quantity_milli: quantity_milli,
          unit: :g
        })
    end

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account_id,
        date: date,
        slot: slot,
        recipe_id: recipe.id,
        is_cooked: false
      })

    meal
  end

  defp pending_item!(account_id, meal, ingredient, quantity_milli, overrides \\ %{}) do
    {:ok, item} =
      Shopping.create_shopping_item(
        Map.merge(
          %{
            account_id: account_id,
            scheduled_meal_id: meal.id,
            planned_date: meal.date,
            ingredient_id: ingredient.id,
            quantity_milli: quantity_milli,
            unit: :g,
            status: :pending
          },
          overrides
        )
      )

    item
  end
end
