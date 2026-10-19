defmodule MealPlannerApi.Persistence.ShoppingTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  # ==========================================================================
  # TASK-12: Tests for list_items_by_session
  # ==========================================================================

  describe "list_items_by_session/2" do
    test "returns all items for a given checkout_session_id" do
      {:ok, identity} =
        Identity.ensure_persistent_identity(%{
          id: "u_session_items_#{:rand.uniform(10000)}",
          account_id: "acct_session_items_#{:rand.uniform(10000)}",
          plan: :family_4
        })

      account_id = identity.account_id

      {:ok, ingredient1} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Test Ingredient 1 #{:rand.uniform(10000)}",
          category: :carnes,
          calories_per_100: 250,
          protein_g_per_100: Decimal.new("26.0"),
          carbs_g_per_100: Decimal.new("0.0"),
          fat_g_per_100: Decimal.new("15.0")
        })

      {:ok, ingredient2} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Test Ingredient 2 #{:rand.uniform(10000)}",
          category: :verduras,
          calories_per_100: 50,
          protein_g_per_100: Decimal.new("2.0"),
          carbs_g_per_100: Decimal.new("10.0"),
          fat_g_per_100: Decimal.new("0.5")
        })

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: account_id,
          created_by_user_id: identity.user_id,
          name: "Test Recipe #{:rand.uniform(10000)}",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
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

      {:ok, _item1} =
        Shopping.create_shopping_item(%{
          account_id: account_id,
          scheduled_meal_id: meal.id,
          checkout_session_id: session.id,
          planned_date: Date.utc_today(),
          ingredient_id: ingredient1.id,
          quantity_milli: 500,
          unit: :g,
          status: :pending
        })

      {:ok, _item2} =
        Shopping.create_shopping_item(%{
          account_id: account_id,
          scheduled_meal_id: meal.id,
          checkout_session_id: session.id,
          planned_date: Date.utc_today(),
          ingredient_id: ingredient2.id,
          quantity_milli: 300,
          unit: :g,
          status: :in_cart
        })

      items = Shopping.list_items_by_session(account_id, session.id)

      assert length(items) == 2
      assert Enum.any?(items, &(&1.ingredient_id == ingredient1.id))
      assert Enum.any?(items, &(&1.ingredient_id == ingredient2.id))
    end

    test "handles empty session (returns empty list)" do
      {:ok, identity} =
        Identity.ensure_persistent_identity(%{
          id: "u_empty_session_#{:rand.uniform(10000)}",
          account_id: "acct_empty_session_#{:rand.uniform(10000)}",
          plan: :family_4
        })

      account_id = identity.account_id
      fake_session_id = Ecto.UUID.generate()

      items = Shopping.list_items_by_session(account_id, fake_session_id)

      assert items == []
    end

    test "returns only items for the specified session (not all account items)" do
      {:ok, identity} =
        Identity.ensure_persistent_identity(%{
          id: "u_other_session_#{:rand.uniform(10000)}",
          account_id: "acct_other_session_#{:rand.uniform(10000)}",
          plan: :family_4
        })

      account_id = identity.account_id

      {:ok, ingredient} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Test Ingredient Filter #{:rand.uniform(10000)}",
          category: :frutas,
          calories_per_100: 30,
          protein_g_per_100: Decimal.new("0.5"),
          carbs_g_per_100: Decimal.new("7.0"),
          fat_g_per_100: Decimal.new("0.2")
        })

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: account_id,
          created_by_user_id: identity.user_id,
          name: "Test Recipe Filter #{:rand.uniform(10000)}",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, meal} =
        Planning.schedule_meal(%{
          account_id: account_id,
          date: Date.utc_today(),
          slot: :lunch,
          recipe_id: recipe.id,
          is_cooked: false
        })

      {:ok, session1} =
        Shopping.create_checkout_session(%{
          account_id: account_id,
          status: :draft,
          checkout_type: :physical,
          started_at: DateTime.utc_now()
        })

      {:ok, session2} =
        Shopping.create_checkout_session(%{
          account_id: account_id,
          status: :draft,
          checkout_type: :physical,
          started_at: DateTime.utc_now()
        })

      {:ok, _item_in_session1} =
        Shopping.create_shopping_item(%{
          account_id: account_id,
          scheduled_meal_id: meal.id,
          checkout_session_id: session1.id,
          planned_date: Date.utc_today(),
          ingredient_id: ingredient.id,
          quantity_milli: 100,
          unit: :g,
          status: :pending
        })

      # Item without session (or different session). It belongs to a second
      # Scheduled meal: only one open Shopping item is allowed per Scheduled
      # meal, planned date, Ingredient and unit.
      {:ok, second_meal} =
        Planning.schedule_meal(%{
          account_id: account_id,
          date: Date.utc_today(),
          slot: :dinner,
          recipe_id: recipe.id,
          is_cooked: false
        })

      {:ok, _item_no_session} =
        Shopping.create_shopping_item(%{
          account_id: account_id,
          scheduled_meal_id: second_meal.id,
          planned_date: Date.utc_today(),
          ingredient_id: ingredient.id,
          quantity_milli: 200,
          unit: :g,
          status: :pending
        })

      items_session1 = Shopping.list_items_by_session(account_id, session1.id)
      items_session2 = Shopping.list_items_by_session(account_id, session2.id)

      assert length(items_session1) == 1
      assert items_session2 == []
    end
  end

  # ==========================================================================
  # At most one open Shopping item (:pending or :in_cart) per planned key:
  # Account, Scheduled meal, planned date, Ingredient and unit.
  # ==========================================================================

  describe "create_shopping_item/1 open planned key" do
    for open_status <- [:pending, :in_cart] do
      test "rejects a second open Shopping item when the first one is #{open_status}" do
        attrs = planned_key_attrs()

        assert {:ok, _first} =
                 Shopping.create_shopping_item(Map.put(attrs, :status, unquote(open_status)))

        assert {:error, changeset} =
                 Shopping.create_shopping_item(Map.put(attrs, :status, :pending))

        assert %{ingredient_id: [_message]} = errors_on(changeset)
        assert [_only_one] = Shopping.list_items_for_account(attrs.account_id)
      end
    end

    test "accepts an open Shopping item next to closed twins" do
      attrs = planned_key_attrs()

      for closed_status <- [:checked_out, :pending_delivery, :archived] do
        assert {:ok, _closed} =
                 Shopping.create_shopping_item(Map.put(attrs, :status, closed_status))
      end

      assert {:ok, open} = Shopping.create_shopping_item(Map.put(attrs, :status, :pending))
      assert open.status == :pending

      assert length(Shopping.list_items_for_account(attrs.account_id, include_archived: true)) ==
               4
    end

    test "accepts open Shopping items that differ in one part of the planned key" do
      attrs = planned_key_attrs()

      assert {:ok, _} = Shopping.create_shopping_item(attrs)
      assert {:ok, _} = Shopping.create_shopping_item(%{attrs | unit: :ml})

      assert {:ok, _} =
               Shopping.create_shopping_item(%{
                 attrs
                 | planned_date: Date.add(attrs.planned_date, 1)
               })
    end
  end

  # ==========================================================================
  # Set-based insert of the Shopping items derived from Scheduled meals.
  # ==========================================================================

  describe "insert_planned_items/2" do
    test "stores each planned line once when called twice with the same lines" do
      %{account_id: account_id} = attrs = planned_key_attrs()
      lines = [planned_line(attrs), planned_line(%{attrs | unit: :ml})]

      # Both calls go through the single statement: the one-by-one retry would
      # store the same rows, so only the absence of its log tells them apart.
      log =
        capture_log(fn ->
          assert :ok = Shopping.insert_planned_items(account_id, lines)
          assert :ok = Shopping.insert_planned_items(account_id, lines)
        end)

      refute log =~ "shopping planned items batch insert failed"

      items = Shopping.list_items_for_account(account_id)
      assert Enum.sort(Enum.map(items, & &1.unit)) == [:g, :ml]
      assert Enum.all?(items, &(&1.status == :pending and &1.quantity_milli == 100))
      assert Enum.all?(items, &(not is_nil(&1.id) and not is_nil(&1.inserted_at)))
    end

    test "keeps the first of two lines that share a planned key" do
      %{account_id: account_id} = attrs = planned_key_attrs()
      lines = [planned_line(attrs), planned_line(%{attrs | quantity_milli: 900})]

      assert :ok = Shopping.insert_planned_items(account_id, lines)

      assert [%{quantity_milli: 100}] = Shopping.list_items_for_account(account_id)
    end

    test "leaves an open Shopping item with the same planned key untouched" do
      %{account_id: account_id} = attrs = planned_key_attrs()
      {:ok, reserved} = Shopping.create_shopping_item(%{attrs | status: :in_cart})

      assert :ok =
               Shopping.insert_planned_items(account_id, [
                 planned_line(%{attrs | quantity_milli: 900})
               ])

      assert [stored] = Shopping.list_items_for_account(account_id)
      assert stored.id == reserved.id
      assert stored.status == :in_cart
      assert stored.quantity_milli == 100
    end

    test "logs and skips a line the changeset rejects, and stores the others" do
      %{account_id: account_id} = attrs = planned_key_attrs()

      lines = [
        planned_line(attrs),
        planned_line(%{attrs | unit: :ml, quantity_milli: 0}),
        planned_line(%{attrs | unit: :unit})
      ]

      log =
        capture_log(fn ->
          assert :ok = Shopping.insert_planned_items(account_id, lines)
        end)

      assert log =~ "shopping planned item skipped"
      assert log =~ "account_id=#{account_id}"

      assert account_id |> Shopping.list_items_for_account() |> Enum.map(& &1.unit) |> Enum.sort() ==
               [:g, :unit]
    end

    test "logs a line the database rejects and still stores the others" do
      %{account_id: account_id} = attrs = planned_key_attrs()
      unknown_ingredient_id = Ecto.UUID.generate()

      lines = [
        planned_line(attrs),
        planned_line(%{attrs | ingredient_id: unknown_ingredient_id}),
        planned_line(%{attrs | unit: :unit})
      ]

      log =
        capture_log(fn ->
          assert :ok = Shopping.insert_planned_items(account_id, lines)
        end)

      assert log =~ "shopping planned items batch insert failed"
      assert log =~ "shopping planned item insert failed"
      assert log =~ "ingredient_id=#{unknown_ingredient_id}"

      items = Shopping.list_items_for_account(account_id)
      assert Enum.sort(Enum.map(items, & &1.unit)) == [:g, :unit]
      assert Enum.all?(items, &(&1.ingredient_id == attrs.ingredient_id))
    end
  end

  describe "Shopping removals (#334)" do
    test "a pair without a Scheduled meal deletes nothing and does not fail" do
      %{account_id: account_id, scheduled_meal_id: meal_id} = attrs = planned_key_attrs()
      :ok = Shopping.put_removals(account_id, [{meal_id, attrs.ingredient_id}])

      assert :ok = Shopping.delete_removals(account_id, [{nil, attrs.ingredient_id}])
      assert removal_count(meal_id) == 1
    end

    test "a removal sets to removed the pending items of its meal and Ingredient" do
      %{account_id: account_id, scheduled_meal_id: meal_id} = attrs = planned_key_attrs()
      {:ok, item} = Shopping.create_shopping_item(attrs)
      {:ok, other_unit} = Shopping.create_shopping_item(%{attrs | unit: :ml})

      assert :ok = Shopping.put_removals(account_id, [{meal_id, attrs.ingredient_id}])
      assert Shopping.mark_removed_items(account_id, [meal_id]) == 2

      assert Repo.get!(ShoppingItem, item.id).status == :removed
      assert Repo.get!(ShoppingItem, other_unit.id).status == :removed
    end

    test "without a removal nothing is marked removed" do
      %{account_id: account_id, scheduled_meal_id: meal_id} = attrs = planned_key_attrs()
      {:ok, item} = Shopping.create_shopping_item(attrs)

      assert Shopping.mark_removed_items(account_id, [meal_id]) == 0
      assert Repo.get!(ShoppingItem, item.id).status == :pending
    end

    test "a meal and Ingredient hold one removal, and deleting it lets items stay pending" do
      %{account_id: account_id, scheduled_meal_id: meal_id} = attrs = planned_key_attrs()
      pair = {meal_id, attrs.ingredient_id}

      assert :ok = Shopping.put_removals(account_id, [pair, pair])
      assert :ok = Shopping.put_removals(account_id, [pair])
      assert removal_count(meal_id) == 1

      assert :ok = Shopping.delete_removals(account_id, [pair])
      assert removal_count(meal_id) == 0

      {:ok, item} = Shopping.create_shopping_item(attrs)
      assert Shopping.mark_removed_items(account_id, [meal_id]) == 0
      assert Repo.get!(ShoppingItem, item.id).status == :pending
    end

    test "a removal of another Account is never written or read" do
      %{account_id: account_id, scheduled_meal_id: meal_id} = attrs = planned_key_attrs()
      %{account_id: other_account_id} = planned_key_attrs()
      {:ok, item} = Shopping.create_shopping_item(attrs)

      assert :ok = Shopping.put_removals(other_account_id, [{meal_id, attrs.ingredient_id}])
      assert removal_count(meal_id) == 0
      assert Shopping.mark_removed_items(account_id, [meal_id]) == 0
      assert Repo.get!(ShoppingItem, item.id).status == :pending
    end

    test "delete_open_items_for_meal/2 drops the meal's removals with its open items" do
      %{account_id: account_id, scheduled_meal_id: meal_id} = attrs = planned_key_attrs()
      {:ok, _item} = Shopping.create_shopping_item(%{attrs | status: :removed})
      :ok = Shopping.put_removals(account_id, [{meal_id, attrs.ingredient_id}])

      assert Shopping.delete_open_items_for_meal(account_id, meal_id) == 1
      assert removal_count(meal_id) == 0
    end

    test "a removal goes with its Scheduled meal" do
      %{account_id: account_id, scheduled_meal_id: meal_id} = attrs = planned_key_attrs()
      :ok = Shopping.put_removals(account_id, [{meal_id, attrs.ingredient_id}])

      Repo.delete!(Repo.get!(MealPlannerApi.Persistence.Planning.ScheduledMeal, meal_id))
      assert removal_count(meal_id) == 0
    end
  end

  describe "update_pending_quantities/2 (#277)" do
    test "skips and logs a quantity the column cannot hold" do
      %{account_id: account_id} = attrs = planned_key_attrs()
      {:ok, item} = Shopping.create_shopping_item(attrs)

      log =
        capture_log(fn ->
          assert Shopping.update_pending_quantities(account_id, [{item.id, 2_147_483_648}]) == 0
        end)

      assert log =~ "shopping pending quantity skipped"
      assert log =~ "item_id=#{item.id}"
      assert Repo.get!(ShoppingItem, item.id).quantity_milli == attrs.quantity_milli
    end
  end

  defp removal_count(meal_id) do
    import Ecto.Query, only: [from: 2]

    Repo.aggregate(
      from(r in MealPlannerApi.Persistence.Shopping.ShoppingRemoval,
        where: r.scheduled_meal_id == ^meal_id
      ),
      :count
    )
  end

  # The shape `ShoppingRebuilder.compute_net_shortages/2` emits: no Account
  # and no status.
  defp planned_line(attrs),
    do:
      Map.take(attrs, [:scheduled_meal_id, :planned_date, :ingredient_id, :unit, :quantity_milli])

  defp planned_key_attrs do
    suffix = System.unique_integer([:positive])

    {:ok, identity} =
      Identity.ensure_persistent_identity(%{
        id: "u_planned_key_#{suffix}",
        account_id: "acct_planned_key_#{suffix}",
        plan: :family_4
      })

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Planned Key Ingredient #{suffix}",
        category: :frutas,
        calories_per_100: 30,
        protein_g_per_100: Decimal.new("0.5"),
        carbs_g_per_100: Decimal.new("7.0"),
        fat_g_per_100: Decimal.new("0.2")
      })

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: identity.account_id,
        created_by_user_id: identity.user_id,
        name: "Planned Key Recipe #{suffix}",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:lunch]
      })

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: identity.account_id,
        date: Date.utc_today(),
        slot: :lunch,
        recipe_id: recipe.id,
        is_cooked: false
      })

    %{
      account_id: identity.account_id,
      scheduled_meal_id: meal.id,
      planned_date: meal.date,
      ingredient_id: ingredient.id,
      quantity_milli: 100,
      unit: :g,
      status: :pending
    }
  end

  describe "ShoppingItem source validations (#40)" do
    alias MealPlannerApi.Persistence.Shopping.ShoppingItem

    test "a planned item still needs its Scheduled meal, date and Ingredient" do
      changeset =
        ShoppingItem.changeset(%ShoppingItem{}, %{
          account_id: Ecto.UUID.generate(),
          quantity_milli: 100,
          unit: :g,
          status: :pending
        })

      assert %{
               scheduled_meal_id: ["can't be blank"],
               planned_date: ["can't be blank"],
               ingredient_id: ["can't be blank"]
             } = errors_on(changeset)
    end

    test "a manual item needs a name, not a Scheduled meal, date or Ingredient" do
      attrs = %{account_id: Ecto.UUID.generate(), quantity_milli: 1_000, unit: :unit}

      assert ShoppingItem.manual_changeset(%ShoppingItem{}, Map.put(attrs, :name, " Soap ")).valid?

      changeset = ShoppingItem.manual_changeset(%ShoppingItem{}, Map.put(attrs, :name, "   "))
      assert %{name: ["can't be blank"]} = errors_on(changeset)

      changeset = ShoppingItem.manual_changeset(%ShoppingItem{}, attrs)
      assert %{name: ["can't be blank"]} = errors_on(changeset)
    end

    test "a manual changeset is always manual, pending and for no meal" do
      changeset =
        ShoppingItem.manual_changeset(%ShoppingItem{}, %{
          account_id: Ecto.UUID.generate(),
          name: "Soap",
          quantity_milli: 1_000,
          unit: :unit,
          source: :planned_meal,
          status: :checked_out,
          scheduled_meal_id: Ecto.UUID.generate(),
          planned_date: ~D[2026-10-10]
        })

      assert Ecto.Changeset.get_field(changeset, :source) == :manual
      assert Ecto.Changeset.get_field(changeset, :status) == :pending
      assert Ecto.Changeset.get_field(changeset, :scheduled_meal_id) == nil
      assert Ecto.Changeset.get_field(changeset, :planned_date) == nil
    end

    test "the database refuses a row that is neither planned nor named" do
      {:ok, identity} =
        Identity.ensure_persistent_identity(%{
          id: "u_shape_#{:rand.uniform(1_000_000)}",
          account_id: "acct_shape_#{:rand.uniform(1_000_000)}",
          plan: :family_4
        })

      assert_raise Postgrex.Error, ~r/shopping_items_source_shape_check/, fn ->
        Repo.insert_all(ShoppingItem, [
          %{
            account_id: identity.account_id,
            source: :manual,
            quantity_milli: 1_000,
            unit: :unit,
            status: :pending,
            inserted_at: DateTime.utc_now(),
            updated_at: DateTime.utc_now()
          }
        ])
      end
    end
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
  end
end
