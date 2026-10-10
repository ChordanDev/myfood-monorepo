defmodule MealPlannerApi.Services.InventoryServiceTest do
  use ExUnit.Case, async: false

  import Ecto.Query, warn: false

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.Account, as: PersistenceAccount
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Persistence.Catalog.Ingredient
  alias MealPlannerApi.Persistence.Inventory, as: InventoryPersistence
  alias MealPlannerApi.Persistence.Inventory.InventoryMutationEvent
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.InventoryService

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    :ok
  end

  describe "freshness_status/2" do
    test "preserves legacy category rules and the fallback for persisted Spanish categories" do
      now = ~U[2026-10-05 12:00:00Z]

      for {category, days} <- [produce: 5, dairy: 7, meat: 3, carnes: 14, otros: 14] do
        item = %{
          expired_at: nil,
          acquired_at: DateTime.add(now, -days * 86_400),
          ingredient: %{category: category}
        }

        assert "warning" = InventoryService.freshness_status(item, now)

        assert "expired" =
                 InventoryService.freshness_status(
                   %{item | acquired_at: DateTime.add(item.acquired_at, -86_400)},
                   now
                 )
      end
    end

    test "returns ok when expiry is far in future" do
      future = DateTime.add(DateTime.utc_now(), 10 * 86_400)
      item = %{expired_at: future}
      assert "ok" = InventoryService.freshness_status(item, DateTime.utc_now())
    end

    test "returns warning when expiry within 2 days" do
      soon = DateTime.add(DateTime.utc_now(), 1 * 86_400)
      item = %{expired_at: soon, acquired_at: nil, ingredient: nil}
      assert "warning" = InventoryService.freshness_status(item, DateTime.utc_now())
    end

    test "returns expired when expiry is in the past" do
      past = DateTime.add(DateTime.utc_now(), -1 * 86_400)
      item = %{expired_at: past}
      assert "expired" = InventoryService.freshness_status(item, DateTime.utc_now())
    end

    test "uses the inferred boundary day and lets explicit expiry supersede inference" do
      today = Date.utc_today()
      now = DateTime.new!(today, ~T[12:00:00], "Etc/UTC")
      ingredient = %{category: :otros}

      boundary = %{
        expired_at: nil,
        acquired_at: DateTime.new!(Date.add(today, -14), ~T[01:00:00], "Etc/UTC"),
        ingredient: ingredient
      }

      explicit_override = %{
        boundary
        | expired_at: DateTime.new!(Date.add(today, 3), ~T[01:00:00], "Etc/UTC"),
          acquired_at: DateTime.new!(Date.add(today, -30), ~T[01:00:00], "Etc/UTC")
      }

      assert "warning" = InventoryService.freshness_status(boundary, now)
      assert "ok" = InventoryService.freshness_status(explicit_override, now)
      assert "ok" = InventoryService.freshness_status(%{boundary | acquired_at: nil}, now)
    end
  end

  describe "inventory_view/1 — item shape" do
    test "an item carries exactly the read fields, with the leftover and notes defaults" do
      account = insert_account("Service View Shape Acc")
      user = insert_user_with_active_membership(account.id, "view_shape@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service View Flour")
      lot = seed_lot(account, user, flour, %{delta: 500, source_kind: :extra})

      assert {:ok, view} = InventoryService.inventory_view(scoped_user)
      assert [item] = view.sections.ok

      assert item |> Map.keys() |> Enum.sort() == [
               :acquired_at,
               :category,
               :expires_at,
               :freshness,
               :id,
               :ingredient_id,
               :is_leftover,
               :name,
               :notes,
               :quantity_milli,
               :source_kind,
               :unit
             ]

      assert %{
               name: "Service View Flour",
               category: "otros",
               quantity_milli: 500,
               unit: "g",
               source_kind: "extra",
               acquired_at: nil,
               freshness: "ok",
               is_leftover: false,
               notes: nil
             } = item

      assert item.id == lot.id
      assert item.ingredient_id == flour.id

      assert view.sections == %{ok: [item], warning: [], expired: []}
      assert view.by_category == %{"otros" => [item]}
      assert view.extras == [item]
      assert view.totals == %{items_count: 1, warning_count: 0, expired_count: 0}
    end

    test "an item carries the leftover flag and the notes stored on its lot" do
      account = insert_account("Service View Leftover Acc")
      user = insert_user_with_active_membership(account.id, "view_leftover@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      lot = seed_lot(account, user, insert_ingredient("Service View Stew"), %{delta: 300})

      assert {:ok, _lot} =
               InventoryPersistence.update_inventory_item(lot, %{
                 is_leftover: true,
                 notes: "Sunday stew"
               })

      assert {:ok, view} = InventoryService.inventory_view(scoped_user)
      assert [%{is_leftover: true, notes: "Sunday stew"}] = view.sections.ok
    end

    test "expires_at is the date of the explicit expiry when the lot has one, else the inferred one" do
      account = insert_account("Service View Expiry Acc")
      user = insert_user_with_active_membership(account.id, "view_expiry@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service View Expiry Flour")

      today = Date.utc_today()
      acquired_at = DateTime.new!(Date.add(today, -1), ~T[12:00:00.000000], "Etc/UTC")
      explicit_expiry = DateTime.new!(Date.add(today, 30), ~T[12:00:00.000000], "Etc/UTC")

      explicit =
        seed_lot(account, user, flour, %{
          delta: 100,
          acquired_at: acquired_at,
          expired_at: explicit_expiry
        })

      inferred = seed_lot(account, user, flour, %{delta: 200, acquired_at: acquired_at})

      assert {:ok, view} = InventoryService.inventory_view(scoped_user)
      items = Map.new(view.sections.ok, &{&1.id, &1})

      assert items[explicit.id].expires_at == Date.to_iso8601(Date.add(today, 30))
      assert items[explicit.id].acquired_at == DateTime.to_iso8601(acquired_at)

      # `otros` falls back to a 14-day shelf life counted from the acquisition date.
      assert items[inferred.id].expires_at == Date.to_iso8601(Date.add(today, 13))
    end

    test "a lot at quantity zero is absent from every group and from the totals" do
      account = insert_account("Service View Zero Acc")
      user = insert_user_with_active_membership(account.id, "view_zero@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      kept = seed_lot(account, user, insert_ingredient("Service View Kept"), %{delta: 400})

      # An expired extra lot would show up in `expired`, `extras`, its own category
      # and two of the totals if it were not hidden once disposed.
      disposed =
        seed_lot(account, user, insert_ingredient("Service View Disposed", :lacteos), %{
          delta: 250,
          source_kind: :extra,
          expired_at: DateTime.add(DateTime.utc_now(), -3 * 86_400)
        })

      assert {:ok, before_dispose} = InventoryService.inventory_view(scoped_user)
      assert [%{id: disposed_id}] = before_dispose.sections.expired
      assert disposed_id == disposed.id
      assert before_dispose.totals == %{items_count: 2, warning_count: 0, expired_count: 1}

      assert {:ok, _result} = InventoryService.dispose_item(scoped_user, disposed.id, %{})

      # The lot is kept at zero for the ledger.
      assert %{quantity_milli: 0} =
               InventoryPersistence.get_inventory_item_for_account(account.id, disposed.id)

      assert {:ok, view} = InventoryService.inventory_view(scoped_user)
      assert [%{id: kept_id} = kept_item] = view.sections.ok
      assert kept_id == kept.id

      assert view.sections == %{ok: [kept_item], warning: [], expired: []}
      assert view.by_category == %{"otros" => [kept_item]}
      assert view.extras == []
      assert view.totals == %{items_count: 1, warning_count: 0, expired_count: 0}
    end
  end

  describe "function signatures" do
    test "inventory_view/1 is callable" do
      assert is_function(&InventoryService.inventory_view/1)
    end

    test "add_extra_item/2 is callable" do
      assert is_function(&InventoryService.add_extra_item/2)
    end

    test "adjust_item_quantity/3 is callable" do
      assert is_function(&InventoryService.adjust_item_quantity/3)
    end

    test "get_inventory_item/2 is callable" do
      assert is_function(&InventoryService.get_inventory_item/2)
    end
  end

  describe "add_extra_item/2 — audited extra movements" do
    test "adds extra item and records audited mutation event with before/delta/after" do
      account = insert_account("Service Extra Acc")
      user = insert_user_with_active_membership(account.id, "extra@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service Flour")

      payload = %{
        "ingredient_id" => flour.id,
        "quantity_milli" => 500,
        "unit" => "g"
      }

      assert {:ok, result} = InventoryService.add_extra_item(scoped_user, payload)
      assert result |> Map.keys() |> Enum.sort() == [:item, :mutation_event]

      # Verify persistence and event
      [item] = InventoryPersistence.list_inventory(account.id)
      assert item.quantity_milli == 500
      assert item.source_kind == :extra
      assert item.unit == :g
      assert item.is_leftover == false
      assert item.notes == nil
      assert item.expired_at == nil

      # The item is the one the read lists.
      assert {:ok, view} = InventoryService.inventory_view(scoped_user)
      assert view.sections.ok == [result.item]
      assert %{id: item_id, quantity_milli: 500, unit: "g", source_kind: "extra"} = result.item
      assert item_id == item.id

      event = Repo.get!(InventoryMutationEvent, result.mutation_event.id)

      assert result.mutation_event == %{
               id: event.id,
               inventory_item_id: item.id,
               trigger_type: "manual",
               operation: "add",
               quantity_before_milli: 0,
               quantity_delta_milli: 500,
               quantity_after_milli: 500,
               inserted_at: DateTime.to_iso8601(event.inserted_at)
             }

      assert event.account_id == account.id
      assert event.source_user_id == user.id
      assert event.inventory_item_id == item.id
      assert event.trigger_type == :manual
      assert event.operation == :add
      assert event.quantity_before_milli == 0
      assert event.quantity_delta_milli == 500
      assert event.quantity_after_milli == 500
    end

    test "stores expires_at, notes and the leftover flag on the lot" do
      account = insert_account("Service Extra Meta Acc")
      user = insert_user_with_active_membership(account.id, "extra_meta@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      stew = insert_ingredient("Service Meta Stew")
      expires_on = Date.add(Date.utc_today(), 3)

      assert {:ok, result} =
               InventoryService.add_extra_item(scoped_user, %{
                 "ingredient_id" => stew.id,
                 "quantity_milli" => 300,
                 "unit" => "g",
                 "expires_at" => Date.to_iso8601(expires_on),
                 "notes" => "  Sunday stew  ",
                 "is_leftover" => true
               })

      assert %{expires_at: expires_at, notes: "Sunday stew", is_leftover: true} = result.item
      assert expires_at == Date.to_iso8601(expires_on)

      assert [lot] = InventoryPersistence.list_inventory(account.id)
      assert %{notes: "Sunday stew", is_leftover: true} = lot
      assert DateTime.to_date(lot.expired_at) == expires_on
    end

    test "an ISO datetime expires_at is stored and read back as its date" do
      account = insert_account("Service Extra Datetime Acc")
      user = insert_user_with_active_membership(account.id, "extra_dt@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service Datetime Flour")
      expires_at = DateTime.new!(Date.add(Date.utc_today(), 9), ~T[18:45:00], "Etc/UTC")

      assert {:ok, result} =
               InventoryService.add_extra_item(scoped_user, %{
                 "ingredient_id" => flour.id,
                 "quantity_milli" => 100,
                 "unit" => "g",
                 "expires_at" => DateTime.to_iso8601(expires_at)
               })

      assert result.item.expires_at == expires_at |> DateTime.to_date() |> Date.to_iso8601()
      assert [lot] = InventoryPersistence.list_inventory(account.id)
      assert DateTime.compare(lot.expired_at, expires_at) == :eq
    end

    test "a lot with notes or the leftover flag stays distinct while plain adds merge" do
      account = insert_account("Service Extra Lots Acc")
      user = insert_user_with_active_membership(account.id, "extra_lots@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      rice = insert_ingredient("Service Lots Rice")
      add = &Map.merge(%{"ingredient_id" => rice.id, "unit" => "g"}, &1)

      payloads = [
        add.(%{"quantity_milli" => 100, "is_leftover" => true}),
        add.(%{"quantity_milli" => 200, "notes" => "Opened bag"}),
        add.(%{"quantity_milli" => 300}),
        # A blank note and an explicit `false` carry no lot metadata.
        add.(%{"quantity_milli" => 400, "notes" => "  ", "is_leftover" => false}),
        add.(%{"quantity_milli" => 500, "is_leftover" => true})
      ]

      results =
        Enum.map(payloads, fn payload ->
          assert {:ok, result} = InventoryService.add_extra_item(scoped_user, payload)
          result
        end)

      lots = InventoryPersistence.list_inventory(account.id)

      assert lots |> Enum.map(&{&1.quantity_milli, &1.is_leftover, &1.notes}) |> Enum.sort() == [
               {100, true, nil},
               {200, false, "Opened bag"},
               {500, true, nil},
               {700, false, nil}
             ]

      # The merging add answers with the accumulated lot.
      assert [_, _, plain, merged, _] = results
      assert plain.item.id == merged.item.id
      assert merged.item.quantity_milli == 700
      assert %{quantity_before_milli: 300, quantity_after_milli: 700} = merged.mutation_event
    end

    test "rejects an unknown unit, a bad expiry, bad notes and a bad leftover flag" do
      account = insert_account("Service Invalid Meta Acc")
      user = insert_user_with_active_membership(account.id, "invalid_meta@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service Invalid Meta Flour")
      valid = %{"ingredient_id" => flour.id, "quantity_milli" => 100, "unit" => "g"}

      for {payload, reason} <- [
            {%{valid | "unit" => "kg"}, :invalid_unit},
            {Map.delete(valid, "unit"), :missing_unit},
            {Map.put(valid, "expires_at", "tomorrow"), :invalid_expires_at},
            {Map.put(valid, "expires_at", "2026-02-30"), :invalid_expires_at},
            {Map.put(valid, "notes", 42), :invalid_notes},
            {Map.put(valid, "is_leftover", "yes"), :invalid_is_leftover},
            {%{valid | "quantity_milli" => 0}, :invalid_quantity},
            {%{valid | "quantity_milli" => "12abc"}, :invalid_quantity},
            {%{valid | "quantity_milli" => 1.5}, :invalid_quantity}
          ] do
        assert {payload, InventoryService.add_extra_item(scoped_user, payload)} ==
                 {payload, {:error, reason}}
      end

      assert InventoryPersistence.list_inventory(account.id) == []
    end

    test "rejects notes longer than 1000 characters once trimmed" do
      account = insert_account("Service Notes Bound Acc")
      user = insert_user_with_active_membership(account.id, "notes_bound@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service Notes Bound Flour")
      valid = %{"ingredient_id" => flour.id, "quantity_milli" => 100, "unit" => "g"}

      too_long = Map.put(valid, "notes", String.duplicate("a", 1001))

      assert InventoryService.add_extra_item(scoped_user, too_long) == {:error, :invalid_notes}
      assert InventoryPersistence.list_inventory(account.id) == []

      at_the_limit = String.duplicate("a", 1000)
      padded = Map.put(valid, "notes", "  " <> at_the_limit <> "  ")

      assert {:ok, result} = InventoryService.add_extra_item(scoped_user, padded)
      assert result.item.notes == at_the_limit
    end

    test "rejects missing or negative quantity" do
      account = insert_account("Service Invalid Qty Acc")
      user = insert_user_with_active_membership(account.id, "invalid_qty@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service Flour Qty")

      assert {:error, :invalid_quantity} =
               InventoryService.add_extra_item(scoped_user, %{
                 "ingredient_id" => flour.id,
                 "quantity_milli" => -100
               })

      assert {:error, :missing_quantity} =
               InventoryService.add_extra_item(scoped_user, %{
                 "ingredient_id" => flour.id
               })
    end

    test "rejects unknown ingredient" do
      account = insert_account("Service Unknown Ing Acc")
      user = insert_user_with_active_membership(account.id, "unknown_ing@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}

      assert {:error, :missing_ingredient} =
               InventoryService.add_extra_item(scoped_user, %{
                 "quantity_milli" => 500
               })

      assert {:error, :ingredient_not_found} =
               InventoryService.add_extra_item(scoped_user, %{
                 "ingredient_id" => Ecto.UUID.generate(),
                 "quantity_milli" => 500,
                 "unit" => "g"
               })

      assert {:error, :ingredient_not_found} =
               InventoryService.add_extra_item(scoped_user, %{
                 "ingredient_name" => "Service No Such Ingredient",
                 "quantity_milli" => 500,
                 "unit" => "g"
               })

      assert {:error, :invalid_ingredient_id} =
               InventoryService.add_extra_item(scoped_user, %{
                 "ingredient_id" => "12abc",
                 "quantity_milli" => 500,
                 "unit" => "g"
               })

      assert InventoryPersistence.list_inventory(account.id) == []
    end
  end

  describe "adjust_item_quantity/3 — atomic quantity adjustments" do
    test "atomically sets target quantity and records before/delta/after movement" do
      account = insert_account("Service Adjust Acc")
      user = insert_user_with_active_membership(account.id, "adjust@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service Adjust Flour")

      # Seed with initial 1000g
      {:ok, seed} =
        InventoryPersistence.apply_delta_and_log(%{
          account_id: account.id,
          ingredient_id: flour.id,
          unit: :g,
          source_kind: :planned,
          delta: 1000,
          source_user_id: user.id,
          trigger_type: :purchase,
          operation: :add
        })

      item_id = seed.item.id

      # Adjust to 750g
      assert {:ok, res} =
               InventoryService.adjust_item_quantity(scoped_user, item_id, %{
                 "quantity_milli" => 750
               })

      assert res |> Map.keys() |> Enum.sort() == [:item, :mutation_event]
      assert %{id: ^item_id, quantity_milli: 750, name: "Service Adjust Flour"} = res.item

      assert %{
               inventory_item_id: ^item_id,
               trigger_type: "manual",
               operation: "set",
               quantity_before_milli: 1000,
               quantity_delta_milli: -250,
               quantity_after_milli: 750
             } = res.mutation_event

      # Check database item state
      updated_item = InventoryPersistence.get_inventory_item_for_account(account.id, item_id)
      assert updated_item.quantity_milli == 750

      # Verify mutation event
      events =
        Repo.all(
          Ecto.Query.from(e in InventoryMutationEvent,
            where: e.inventory_item_id == ^item_id,
            order_by: [asc: e.inserted_at]
          )
        )

      assert length(events) == 2
      adjust_event = List.last(events)
      assert adjust_event.account_id == account.id
      assert adjust_event.source_user_id == user.id
      assert adjust_event.trigger_type == :manual
      assert adjust_event.operation == :set
      assert adjust_event.quantity_before_milli == 1000
      assert adjust_event.quantity_delta_milli == -250
      assert adjust_event.quantity_after_milli == 750
    end

    test "refuses adjustment on non-existent item" do
      account = insert_account("Service Missing Item Acc")
      user = insert_user_with_active_membership(account.id, "missing_item@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}

      assert {:error, :inventory_item_not_found} =
               InventoryService.adjust_item_quantity(scoped_user, Ecto.UUID.generate(), %{
                 "quantity_milli" => 500
               })

      assert {:error, :inventory_item_not_found} =
               InventoryService.adjust_item_quantity(scoped_user, "not-a-uuid", %{
                 "quantity_milli" => 500
               })
    end

    test "rejects a negative or non-integer quantity without touching the lot or the ledger" do
      account = insert_account("Service Adjust Invalid Acc")
      user = insert_user_with_active_membership(account.id, "adjust_bad@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}

      lot =
        seed_lot(account, user, insert_ingredient("Service Adjust Invalid Flour"), %{delta: 800})

      for {quantity, reason} <- [
            {-1, :invalid_quantity},
            {7.5, :invalid_quantity},
            {"7.5", :invalid_quantity},
            {"abc", :invalid_quantity},
            {nil, :missing_quantity}
          ] do
        assert {quantity,
                InventoryService.adjust_item_quantity(scoped_user, lot.id, %{
                  "quantity_milli" => quantity
                })} == {quantity, {:error, reason}}
      end

      assert [%{quantity_milli: 800}] = InventoryPersistence.list_inventory(account.id)

      assert Repo.aggregate(
               from(e in InventoryMutationEvent, where: e.inventory_item_id == ^lot.id),
               :count
             ) == 1
    end

    test "refuses cross-account item adjustment (account isolation)" do
      account_a = insert_account("Cross Adjust A")
      account_b = insert_account("Cross Adjust B")

      user = insert_user_with_active_membership(account_a.id, "cross_adj@example.com", :owner)
      _membership_b = insert_active_membership_for(account_b.id, user, :member)
      scoped_user_a = %{id: user.id, account_id: account_a.id, plan: :family_4}

      flour = insert_ingredient("Cross Flour")

      # Seed item on Account B
      {:ok, seed_b} =
        InventoryPersistence.apply_delta_and_log(%{
          account_id: account_b.id,
          ingredient_id: flour.id,
          unit: :g,
          source_kind: :planned,
          delta: 500,
          source_user_id: user.id
        })

      # User with Account A scope attempts to adjust Account B's item
      assert {:error, :inventory_item_not_found} =
               InventoryService.adjust_item_quantity(scoped_user_a, seed_b.item.id, %{
                 "quantity_milli" => 100
               })

      # Account B's item remains untouched
      item_b = InventoryPersistence.get_inventory_item_for_account(account_b.id, seed_b.item.id)
      assert item_b.quantity_milli == 500
    end
  end

  describe "dispose_item/3 — item disposal" do
    test "disposes item setting stock to 0 and records delete movement" do
      account = insert_account("Service Dispose Acc")
      user = insert_user_with_active_membership(account.id, "dispose@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Service Dispose Flour")

      {:ok, seed} =
        InventoryPersistence.apply_delta_and_log(%{
          account_id: account.id,
          ingredient_id: flour.id,
          unit: :g,
          source_kind: :planned,
          delta: 600,
          source_user_id: user.id
        })

      assert {:ok, res} =
               InventoryService.dispose_item(scoped_user, seed.item.id, %{"reason" => "spoiled"})

      assert res |> Map.keys() |> Enum.sort() == [:disposed, :mutation_event]
      assert res.disposed == true

      assert %{
               inventory_item_id: item_id,
               trigger_type: "manual",
               operation: "delete",
               quantity_before_milli: 600,
               quantity_delta_milli: -600,
               quantity_after_milli: 0
             } = res.mutation_event

      assert item_id == seed.item.id

      item = InventoryPersistence.get_inventory_item_for_account(account.id, seed.item.id)
      assert item.quantity_milli == 0

      events =
        Repo.all(
          Ecto.Query.from(e in InventoryMutationEvent,
            where: e.inventory_item_id == ^seed.item.id,
            order_by: [desc: e.inserted_at]
          )
        )

      dispose_event = hd(events)
      assert dispose_event.operation == :delete
      assert dispose_event.quantity_before_milli == 600
      assert dispose_event.quantity_delta_milli == -600
      assert dispose_event.quantity_after_milli == 0
    end

    test "refuses disposal for non-existent or cross-account item" do
      account = insert_account("Service Dispose Missing Acc")
      user = insert_user_with_active_membership(account.id, "disp_missing@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}

      assert {:error, :inventory_item_not_found} =
               InventoryService.dispose_item(scoped_user, Ecto.UUID.generate(), %{})

      assert {:error, :inventory_item_not_found} =
               InventoryService.dispose_item(scoped_user, "not-a-uuid", %{})
    end
  end

  describe "voice_preview/2 and voice_apply/2 — spoken subtract" do
    setup do
      account = insert_account("Service Voice Acc")
      user = insert_user_with_active_membership(account.id, "voice@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      cheese = insert_ingredient("Queso crema")
      %{account: account, user: user, scoped_user: scoped_user, cheese: cheese}
    end

    test "preview reads a confident intent from the transcript", ctx do
      seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})

      assert {:ok, preview} =
               InventoryService.voice_preview(ctx.scoped_user, %{
                 "transcript" => "me comí la mitad del queso crema"
               })

      assert preview.confirmation_required == false
      assert preview.confidence >= 0.8

      assert preview.intent == %{
               operation: "subtract",
               ingredient_id: ctx.cheese.id,
               name: "Queso crema",
               quantity_milli: 200_000,
               unit: "g"
             }
    end

    test "preview of a vague amount asks for confirmation", ctx do
      seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})

      assert {:ok, %{confirmation_required: true, confidence: c, intent: intent}} =
               InventoryService.voice_preview(ctx.scoped_user, %{
                 "transcript" => "se me acabó el queso crema"
               })

      assert c < 0.8
      assert intent.quantity_milli == 400_000
    end

    test "preview fails when no ingredient in stock is named", ctx do
      assert {:error, :voice_parse_failed} =
               InventoryService.voice_preview(ctx.scoped_user, %{
                 "transcript" => "me comí el queso crema"
               })

      seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})

      assert {:error, :voice_parse_failed} =
               InventoryService.voice_preview(ctx.scoped_user, %{"transcript" => "hola"})
    end

    test "preview ignores an expired lot and a lot of another Account", ctx do
      seed_lot(ctx.account, ctx.user, ctx.cheese, %{
        delta: 400_000,
        expired_at: DateTime.add(DateTime.utc_now(), -5 * 86_400)
      })

      other = insert_account("Service Voice Other")
      other_user = insert_user_with_active_membership(other.id, "voice_other@example.com", :owner)
      seed_lot(other, other_user, ctx.cheese, %{delta: 900_000})

      assert {:error, :voice_parse_failed} =
               InventoryService.voice_preview(ctx.scoped_user, %{
                 "transcript" => "me comí la mitad del queso crema"
               })
    end

    test "preview rejects a payload without a transcript", ctx do
      assert {:error, :invalid_voice_payload} =
               InventoryService.voice_preview(ctx.scoped_user, %{})

      assert {:error, :invalid_voice_payload} =
               InventoryService.voice_preview(ctx.scoped_user, %{"text" => "me comí el queso"})

      assert {:error, :invalid_voice_payload} =
               InventoryService.voice_preview(ctx.scoped_user, %{"transcript" => "  "})
    end

    test "apply subtracts a confident intent and logs the voice event with the transcript", ctx do
      lot = seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})
      transcript = "me comí la mitad del queso crema"
      {:ok, %{intent: intent}} = preview(ctx, transcript)

      assert {:ok, result} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "transcript" => transcript,
                 "intent" => stringify(intent),
                 "confirmed" => false
               })

      assert result.ingredient_id == ctx.cheese.id
      assert result.quantity_delta_milli == -200_000
      assert [event] = result.mutation_events

      assert %{
               inventory_item_id: item_id,
               trigger_type: "voice",
               operation: "subtract",
               quantity_before_milli: 400_000,
               quantity_delta_milli: -200_000,
               quantity_after_milli: 200_000
             } = event

      assert item_id == lot.id

      assert InventoryPersistence.get_inventory_item_for_account(ctx.account.id, lot.id).quantity_milli ==
               200_000

      stored = Repo.get!(InventoryMutationEvent, event.id)
      assert stored.trigger_type == :voice
      assert stored.operation == :subtract
      assert stored.raw_voice_text == transcript
      assert stored.source_user_id == ctx.user.id
    end

    test "apply refuses a low-confidence intent that is not confirmed", ctx do
      lot = seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})
      transcript = "se me acabó el queso crema"
      {:ok, %{intent: intent}} = preview(ctx, transcript)

      for confirmed <- [nil, false, "true", 1] do
        payload = %{"transcript" => transcript, "intent" => stringify(intent)}

        payload =
          if is_nil(confirmed), do: payload, else: Map.put(payload, "confirmed", confirmed)

        assert {:error, :voice_confirmation_required} =
                 InventoryService.voice_apply(ctx.scoped_user, payload)
      end

      assert InventoryPersistence.get_inventory_item_for_account(ctx.account.id, lot.id).quantity_milli ==
               400_000

      assert {:ok, result} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "transcript" => transcript,
                 "intent" => stringify(intent),
                 "confirmed" => true
               })

      assert result.quantity_delta_milli == -400_000
    end

    test "apply never trusts the client: an inflated intent needs confirmation", ctx do
      seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})
      transcript = "me comí la mitad del queso crema"
      {:ok, %{intent: intent}} = preview(ctx, transcript)
      inflated = %{intent | quantity_milli: 390_000}

      assert {:error, :voice_confirmation_required} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "transcript" => transcript,
                 "intent" => stringify(inflated),
                 "confidence" => 1.0
               })
    end

    test "apply needs confirmation when the client names another unit than the transcript", ctx do
      eggs = insert_ingredient("Huevo")
      seed_lot(ctx.account, ctx.user, eggs, %{unit: :unit, delta: 12_000})
      grams = seed_lot(ctx.account, ctx.user, eggs, %{unit: :g, delta: 600_000})
      transcript = "me comí 300 gramos de huevos"
      {:ok, %{intent: intent}} = preview(ctx, transcript)
      assert intent.unit == "g"

      assert {:error, :voice_confirmation_required} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "transcript" => transcript,
                 "intent" => %{stringify(intent) | "unit" => "unit"}
               })

      assert {:ok, _result} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "transcript" => transcript,
                 "intent" => stringify(intent)
               })

      assert InventoryPersistence.get_inventory_item_for_account(ctx.account.id, grams.id).quantity_milli ==
               300_000
    end

    test "apply caps the subtraction at the stock and never goes negative", ctx do
      lot = seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})
      transcript = "me comí la mitad del queso crema"
      {:ok, %{intent: intent}} = preview(ctx, transcript)

      # Stock fell between the preview and the apply.
      {:ok, _} =
        InventoryPersistence.apply_delta_and_log(%{
          account_id: ctx.account.id,
          inventory_item_id: lot.id,
          target_quantity_milli: 50_000,
          source_user_id: ctx.user.id,
          trigger_type: :manual,
          operation: :set
        })

      assert {:ok, result} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "transcript" => transcript,
                 "intent" => stringify(intent),
                 "confirmed" => true
               })

      assert result.quantity_delta_milli == -50_000

      assert InventoryPersistence.get_inventory_item_for_account(ctx.account.id, lot.id).quantity_milli ==
               0
    end

    test "apply consumes several lots in FEFO order", ctx do
      now = DateTime.utc_now()

      later =
        seed_lot(ctx.account, ctx.user, ctx.cheese, %{
          delta: 300_000,
          expired_at: DateTime.add(now, 20 * 86_400),
          notes: "later"
        })

      sooner =
        seed_lot(ctx.account, ctx.user, ctx.cheese, %{
          delta: 100_000,
          expired_at: DateTime.add(now, 5 * 86_400),
          notes: "sooner"
        })

      transcript = "usé 250 gramos de queso crema"
      {:ok, %{intent: intent}} = preview(ctx, transcript)
      assert intent.quantity_milli == 250_000

      assert {:ok, result} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "transcript" => transcript,
                 "intent" => stringify(intent)
               })

      assert result.quantity_delta_milli == -250_000
      assert Enum.map(result.mutation_events, & &1.inventory_item_id) == [sooner.id, later.id]
      assert Enum.all?(result.mutation_events, &(&1.trigger_type == "voice"))

      assert InventoryPersistence.get_inventory_item_for_account(ctx.account.id, sooner.id).quantity_milli ==
               0

      assert InventoryPersistence.get_inventory_item_for_account(ctx.account.id, later.id).quantity_milli ==
               150_000
    end

    test "apply refuses a transcript that parses to nothing", ctx do
      seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})

      intent = %{
        "operation" => "subtract",
        "ingredient_id" => ctx.cheese.id,
        "quantity_milli" => 1_000,
        "unit" => "g"
      }

      assert {:error, :voice_parse_failed} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "transcript" => "hola",
                 "intent" => intent,
                 "confirmed" => true
               })
    end

    test "apply rejects malformed payloads", ctx do
      seed_lot(ctx.account, ctx.user, ctx.cheese, %{delta: 400_000})
      transcript = "me comí la mitad del queso crema"

      good = %{
        "operation" => "subtract",
        "ingredient_id" => ctx.cheese.id,
        "quantity_milli" => 200_000,
        "unit" => "g"
      }

      for payload <- [
            %{},
            %{"transcript" => transcript},
            %{"transcript" => transcript, "intent" => "x"},
            %{"transcript" => transcript, "intent" => %{good | "quantity_milli" => 0}},
            %{"transcript" => transcript, "intent" => %{good | "quantity_milli" => -5}},
            %{"transcript" => transcript, "intent" => %{good | "ingredient_id" => "nope"}},
            %{"transcript" => transcript, "intent" => %{good | "operation" => "add"}},
            %{"intent" => good}
          ] do
        assert {:error, :invalid_voice_payload} =
                 InventoryService.voice_apply(ctx.scoped_user, payload)
      end
    end

    test "the old text and operations contract is gone", ctx do
      assert {:error, :invalid_voice_payload} =
               InventoryService.voice_apply(ctx.scoped_user, %{
                 "raw_text" => "me comí el queso crema",
                 "operations" => [
                   %{"inventory_item_id" => Ecto.UUID.generate(), "quantity_milli" => 1}
                 ]
               })
    end

    defp preview(ctx, transcript),
      do: InventoryService.voice_preview(ctx.scoped_user, %{"transcript" => transcript})

    defp stringify(intent), do: Map.new(intent, fn {k, v} -> {Atom.to_string(k), v} end)
  end

  describe "concurrency & lost update prevention" do
    test "concurrent add_extra_item calls safely accumulate deltas without lost updates" do
      account = insert_account("Concurrent Service Acc")
      user = insert_user_with_active_membership(account.id, "conc_service@example.com", :owner)
      scoped_user = %{id: user.id, account_id: account.id, plan: :family_4}
      flour = insert_ingredient("Concurrent Flour")

      Sandbox.mode(Repo, {:shared, self()})

      deltas = [100, 200, 150, 50, 300]
      expected_total = Enum.sum(deltas)

      tasks =
        Enum.map(deltas, fn delta ->
          Task.async(fn ->
            InventoryService.add_extra_item(scoped_user, %{
              "ingredient_id" => flour.id,
              "quantity_milli" => delta,
              "unit" => "g"
            })
          end)
        end)

      results = Enum.map(tasks, &Task.await/1)
      assert Enum.all?(results, &match?({:ok, %{item: _, mutation_event: _}}, &1))

      [item] = InventoryPersistence.list_inventory(account.id)
      assert item.quantity_milli == expected_total

      events =
        Repo.all(
          Ecto.Query.from(e in InventoryMutationEvent,
            where: e.inventory_item_id == ^item.id,
            order_by: [asc: e.inserted_at]
          )
        )

      assert length(events) == length(deltas)
      total_delta_in_events = Enum.reduce(events, 0, &(&1.quantity_delta_milli + &2))
      assert total_delta_in_events == expected_total

      # Verify each event correctly links before + delta == after
      Enum.each(events, fn e ->
        assert e.quantity_before_milli + e.quantity_delta_milli == e.quantity_after_milli
        assert e.account_id == account.id
        assert e.source_user_id == user.id
      end)
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp insert_account(name) do
    plan = Repo.get_by!(MealPlannerApi.Subscriptions.Plan, name: "family_4")

    {:ok, account} =
      %PersistenceAccount{}
      |> PersistenceAccount.changeset(%{
        name: name,
        plan: :family_4,
        default_budget_cents: 0,
        subscription_plan_id: plan.id
      })
      |> Repo.insert()

    account
  end

  defp insert_user_with_active_membership(account_id, email, role) do
    user =
      %PersistenceUser{}
      |> PersistenceUser.changeset(%{email: email, name: email, role: role})
      |> Repo.insert!()

    insert_active_membership_for(account_id, user, role)
    user
  end

  defp insert_active_membership_for(account_id, user, role) do
    %AccountMembership{}
    |> AccountMembership.changeset(%{
      account_id: account_id,
      user_id: user.id,
      role: role,
      status: :active,
      joined_at: DateTime.utc_now()
    })
    |> Repo.insert!()
  end

  defp insert_ingredient(name, category \\ :otros) do
    %Ingredient{}
    |> Ingredient.changeset(%{name: name, category: category})
    |> Repo.insert!()
  end

  defp seed_lot(account, user, ingredient, attrs) do
    {:ok, result} =
      %{
        account_id: account.id,
        ingredient_id: ingredient.id,
        unit: :g,
        source_kind: :planned,
        source_user_id: user.id,
        trigger_type: :purchase,
        operation: :add
      }
      |> Map.merge(attrs)
      |> InventoryPersistence.apply_delta_and_log()

    result.item
  end
end
