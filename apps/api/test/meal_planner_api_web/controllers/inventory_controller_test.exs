defmodule MealPlannerApiWeb.InventoryControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query, only: [from: 2]
  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory
  alias MealPlannerApi.Persistence.Inventory.InventoryMutationEvent
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Repo

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.18) ───────────────────────────
  # See calendar_controller_test.exs (task 3.14) for why a tampered
  # `account_id` claim is the genuine RED-discriminating case here.
  describe "multi-familia tenancy scoping (task 3.18)" do
    test "GET /api/inventory resolves items via current_membership.account_id, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "inventory_tamper@example.com"}, [
          {%{plan: :family_4, name: "Inventory Tamper Account A"}, :owner},
          {%{plan: :family_4, name: "Inventory Tamper Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      {:ok, ingredient} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Inventory Tamper Ingredient",
          category: :no_perecederos,
          calories_per_100: 260,
          protein_g_per_100: Decimal.new("8.0"),
          carbs_g_per_100: Decimal.new("49.0"),
          fat_g_per_100: Decimal.new("3.2")
        })

      {:ok, _seed} =
        Inventory.apply_delta_and_log(%{
          account_id: membership_a.account_id,
          ingredient_id: ingredient.id,
          unit: :g,
          source_kind: :planned,
          delta: 1000,
          source_user_id: user.id,
          trigger_type: :purchase,
          operation: :add
        })

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/inventory")

      body = json_response(conn, 200)
      all_ingredient_ids = Enum.map(body["data"]["sections"]["ok"], & &1["ingredientId"])

      assert ingredient.id in all_ingredient_ids
    end
  end

  test "inventory list, manual adjust, dispose and voice flow" do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Pan Test Inventario",
        category: :no_perecederos,
        calories_per_100: 260,
        protein_g_per_100: Decimal.new("8.0"),
        carbs_g_per_100: Decimal.new("49.0"),
        fat_g_per_100: Decimal.new("3.2")
      })

    {:ok, _seed} =
      Inventory.apply_delta_and_log(%{
        account_id: account_id,
        ingredient_id: ingredient.id,
        unit: :g,
        source_kind: :planned,
        delta: 1000,
        source_user_id: user_id,
        trigger_type: :purchase,
        operation: :add
      })

    list_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/inventory")

    list_body = json_response(list_conn, 200)
    assert list_body["data"]["totals"]["itemsCount"] == 1

    item = hd(list_body["data"]["sections"]["ok"])
    item_id = item["id"]

    adjust_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/inventory/items/#{item_id}/quantity", %{"quantity_milli" => 750})

    adjust_body = json_response(adjust_conn, 200)
    assert adjust_body["data"]["item"]["quantityMilli"] == 750
    assert adjust_body["data"]["mutationEvent"]["quantityAfterMilli"] == 750

    transcript = "me comí la mitad del pan test inventario"

    preview_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/inventory/voice/preview", %{"transcript" => transcript})

    preview_body = json_response(preview_conn, 200)
    assert preview_body["data"]["confirmationRequired"] == false
    assert preview_body["data"]["confidence"] >= 0.8

    assert preview_body["data"]["intent"] == %{
             "operation" => "subtract",
             "ingredientId" => ingredient.id,
             "name" => "Pan Test Inventario",
             "quantityMilli" => 375,
             "unit" => "g"
           }

    apply_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/inventory/voice/apply", %{
        "transcript" => transcript,
        "intent" => preview_body["data"]["intent"],
        "confirmed" => false
      })

    apply_body = json_response(apply_conn, 200)
    assert apply_body["data"]["ingredientId"] == ingredient.id
    assert apply_body["data"]["quantityDeltaMilli"] == -375

    assert [%{"triggerType" => "voice", "operation" => "subtract", "quantityAfterMilli" => 375}] =
             apply_body["data"]["mutationEvents"]

    assert [%{trigger_type: :voice, raw_voice_text: ^transcript}] =
             Enum.filter(ledger(item_id), &(&1.trigger_type == :voice))

    dispose_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/inventory/items/#{item_id}/dispose", %{"reason" => "spoiled"})

    dispose_body = json_response(dispose_conn, 200)
    assert dispose_body["data"]["disposed"] == true
    assert dispose_body["data"]["mutationEvent"]["inventoryItemId"] == item_id

    # The disposed lot stays as a zero row for the ledger and leaves the read.
    after_dispose_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/inventory")

    assert json_response(after_dispose_conn, 200)["data"] == %{
             "sections" => %{"ok" => [], "warning" => [], "expired" => []},
             "byCategory" => %{},
             "extras" => [],
             "totals" => %{"itemsCount" => 0, "warningCount" => 0, "expiredCount" => 0}
           }
  end

  test "GET /api/inventory lists each lot with its read fields in camelCase", %{conn: conn} do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Arroz Test Forma",
        category: :no_perecederos,
        calories_per_100: 130,
        protein_g_per_100: Decimal.new("2.7"),
        carbs_g_per_100: Decimal.new("28.0"),
        fat_g_per_100: Decimal.new("0.3")
      })

    acquired_at = DateTime.add(DateTime.utc_now(), -86_400)
    expires_at = DateTime.add(DateTime.utc_now(), 20 * 86_400)

    {:ok, seed} =
      Inventory.apply_delta_and_log(%{
        account_id: account_id,
        ingredient_id: ingredient.id,
        unit: :g,
        source_kind: :extra,
        delta: 400,
        acquired_at: acquired_at,
        expired_at: expires_at,
        source_user_id: user_id,
        trigger_type: :manual,
        operation: :add
      })

    body =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/inventory")
      |> json_response(200)

    item = %{
      "id" => seed.item.id,
      "ingredientId" => ingredient.id,
      "name" => "Arroz Test Forma",
      "category" => "no_perecederos",
      "quantityMilli" => 400,
      "unit" => "g",
      "sourceKind" => "extra",
      "acquiredAt" => DateTime.to_iso8601(acquired_at),
      "expiresAt" => expires_at |> DateTime.to_date() |> Date.to_iso8601(),
      "freshness" => "ok",
      "isLeftover" => false,
      "notes" => nil
    }

    assert body["data"] == %{
             "sections" => %{"ok" => [item], "warning" => [], "expired" => []},
             "byCategory" => %{"no_perecederos" => [item]},
             "extras" => [item],
             "totals" => %{"itemsCount" => 1, "warningCount" => 0, "expiredCount" => 0}
           }
  end

  describe "POST /api/inventory/items/add-extra" do
    test "stores expiresAt, notes and isLeftover and returns the item with its mutation event" do
      actor = actor()
      rice = ingredient("Arroz Test Alta")
      expires_on = Date.add(Date.utc_today(), 20)

      body =
        actor
        |> post_json("/api/inventory/items/add-extra", %{
          "ingredientId" => rice.id,
          "quantityMilli" => 400,
          "unit" => "g",
          "expiresAt" => Date.to_iso8601(expires_on),
          "notes" => "Opened bag",
          "isLeftover" => true
        })
        |> json_response(200)

      assert [lot] = Inventory.list_inventory(actor.account_id)
      assert %{quantity_milli: 400, source_kind: :extra, is_leftover: true} = lot
      assert lot.notes == "Opened bag"
      assert DateTime.to_date(lot.expired_at) == expires_on

      item = %{
        "id" => lot.id,
        "ingredientId" => rice.id,
        "name" => "Arroz Test Alta",
        "category" => "no_perecederos",
        "quantityMilli" => 400,
        "unit" => "g",
        "sourceKind" => "extra",
        "acquiredAt" => nil,
        "expiresAt" => Date.to_iso8601(expires_on),
        "freshness" => "ok",
        "isLeftover" => true,
        "notes" => "Opened bag"
      }

      assert [ledger] = ledger(lot.id)

      assert body == %{
               "data" => %{
                 "item" => item,
                 "mutationEvent" => %{
                   "id" => ledger.id,
                   "inventoryItemId" => lot.id,
                   "triggerType" => "manual",
                   "operation" => "add",
                   "quantityBeforeMilli" => 0,
                   "quantityDeltaMilli" => 400,
                   "quantityAfterMilli" => 400,
                   "insertedAt" => DateTime.to_iso8601(ledger.inserted_at)
                 }
               }
             }

      # The write answers with the item the read lists.
      read = actor |> get_json("/api/inventory") |> json_response(200)
      assert read["data"]["sections"]["ok"] == [item]
    end

    test "expiresAt is a date for a datetime input and for an inferred expiry" do
      actor = actor()
      rice = ingredient("Arroz Test Fechas")
      today = Date.utc_today()
      expires_on = Date.add(today, 10)

      explicit =
        actor
        |> post_json("/api/inventory/items/add-extra", %{
          "ingredientId" => rice.id,
          "quantityMilli" => 100,
          "unit" => "g",
          "expiresAt" => DateTime.to_iso8601(DateTime.new!(expires_on, ~T[15:30:00], "Etc/UTC"))
        })
        |> json_response(200)

      assert explicit["data"]["item"]["expiresAt"] == Date.to_iso8601(expires_on)

      # Added by name (D9), without an expiry: `no_perecederos` falls back to
      # a 14-day shelf life. The add may land on the next UTC day, so the
      # inferred expiry is counted from the day before and the day after it.
      day_before_add = Date.utc_today()

      inferred =
        actor
        |> post_json("/api/inventory/items/add-extra", %{
          "ingredientName" => "Arroz Test Fechas",
          "quantityMilli" => 250,
          "unit" => "g"
        })
        |> json_response(200)

      assert %{"expiresAt" => inferred_on, "isLeftover" => false, "notes" => nil} =
               inferred["data"]["item"]

      assert inferred_on in Enum.map(
               [day_before_add, Date.utc_today()],
               &Date.to_iso8601(Date.add(&1, 14))
             )
    end

    test "invalid input is a validation_error and stores nothing" do
      actor = actor()
      rice = ingredient("Arroz Test Invalido")
      valid = %{"ingredientId" => rice.id, "quantityMilli" => 100, "unit" => "g"}

      invalid_payloads = [
        %{valid | "quantityMilli" => 0},
        %{valid | "quantityMilli" => -100},
        %{valid | "quantityMilli" => 1.5},
        Map.delete(valid, "quantityMilli"),
        Map.delete(valid, "ingredientId"),
        %{valid | "ingredientId" => Ecto.UUID.generate()},
        %{valid | "ingredientId" => "not-a-uuid"},
        valid |> Map.delete("ingredientId") |> Map.put("ingredientName", "No Such Ingredient"),
        %{valid | "unit" => "kg"},
        Map.delete(valid, "unit"),
        Map.put(valid, "expiresAt", "tomorrow"),
        Map.put(valid, "notes", 42),
        Map.put(valid, "isLeftover", "yes"),
        Map.put(valid, "acquiredAt", "yesterday"),
        Map.put(valid, "acquiredAt", "2026-10-15"),
        Map.put(valid, "acquiredAt", 42),
        Map.put(valid, "acquiredPriceCents", -1),
        Map.put(valid, "acquiredPriceCents", 1.5),
        Map.put(valid, "acquiredPriceCents", "120")
      ]

      for payload <- invalid_payloads do
        conn = post_json(actor, "/api/inventory/items/add-extra", payload)

        assert {payload, json_response(conn, 422)} == {payload, validation_error()}
      end

      assert Inventory.list_inventory(actor.account_id) == []
    end

    test "acquiredAt and acquiredPriceCents are stored on the lot when they are valid" do
      actor = actor()
      rice = ingredient("Arroz Test Compra")

      conn =
        post_json(actor, "/api/inventory/items/add-extra", %{
          "ingredientId" => rice.id,
          "quantityMilli" => 100,
          "unit" => "g",
          "acquiredAt" => "2026-10-10T12:30:00Z",
          "acquiredPriceCents" => 0
        })

      assert %{"acquiredAt" => "2026-10-10T12:30:00.000000Z"} =
               json_response(conn, 200)["data"]["item"]

      assert [%{acquired_price_cents: 0, acquired_at: acquired_at}] =
               Inventory.list_inventory(actor.account_id)

      assert DateTime.compare(acquired_at, ~U[2026-10-10 12:30:00Z]) == :eq
    end

    test "notes longer than 1000 characters are a validation_error and store nothing" do
      actor = actor()
      rice = ingredient("Arroz Test Notas Largas")

      conn =
        post_json(actor, "/api/inventory/items/add-extra", %{
          "ingredientId" => rice.id,
          "quantityMilli" => 100,
          "unit" => "g",
          "notes" => String.duplicate("a", 1001)
        })

      assert json_response(conn, 422) == validation_error()
      assert Inventory.list_inventory(actor.account_id) == []

      assert Repo.aggregate(
               from(e in InventoryMutationEvent, where: e.account_id == ^actor.account_id),
               :count
             ) == 0
    end
  end

  describe "POST /api/inventory/items/:item_id/quantity" do
    test "sets the quantity and returns the item with its mutation event" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Harina Test Ajuste"), 1000)

      body =
        actor
        |> post_json("/api/inventory/items/#{lot.id}/quantity", %{"quantityMilli" => 750})
        |> json_response(200)

      assert [_purchase, ledger] = ledger(lot.id)

      assert %{
               "id" => lot_id,
               "name" => "Harina Test Ajuste",
               "quantityMilli" => 750,
               "expiresAt" => expires_at,
               "freshness" => "ok"
             } = body["data"]["item"]

      assert lot_id == lot.id
      assert expires_at =~ ~r/^\d{4}-\d{2}-\d{2}$/

      assert body["data"]["mutationEvent"] == %{
               "id" => ledger.id,
               "inventoryItemId" => lot.id,
               "triggerType" => "manual",
               "operation" => "set",
               "quantityBeforeMilli" => 1000,
               "quantityDeltaMilli" => -250,
               "quantityAfterMilli" => 750,
               "insertedAt" => DateTime.to_iso8601(ledger.inserted_at)
             }

      assert body["data"] |> Map.keys() |> Enum.sort() == ["item", "mutationEvent"]
    end

    test "a negative or non-integer quantity is a validation_error and changes nothing" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Harina Test Negativa"), 1000)

      for quantity <- [-1, 7.5, "abc", "7.5", nil] do
        conn =
          post_json(actor, "/api/inventory/items/#{lot.id}/quantity", %{
            "quantityMilli" => quantity
          })

        assert {quantity, json_response(conn, 422)} == {quantity, validation_error()}
      end

      assert [%{quantity_milli: 1000}] = Inventory.list_inventory(actor.account_id)
      assert [%{operation: :add}] = ledger(lot.id)
    end
  end

  describe "POST /api/inventory/items/:item_id/dispose" do
    test "answers disposed with the mutation event, keeps the ledger and hides the lot" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Leche Test Descarte"), 600)

      body =
        actor
        |> post_json("/api/inventory/items/#{lot.id}/dispose", %{"reason" => "spoiled"})
        |> json_response(200)

      assert [_purchase, ledger] = ledger(lot.id)

      assert body == %{
               "data" => %{
                 "disposed" => true,
                 "mutationEvent" => %{
                   "id" => ledger.id,
                   "inventoryItemId" => lot.id,
                   "triggerType" => "manual",
                   "operation" => "delete",
                   "quantityBeforeMilli" => 600,
                   "quantityDeltaMilli" => -600,
                   "quantityAfterMilli" => 0,
                   "insertedAt" => DateTime.to_iso8601(ledger.inserted_at)
                 }
               }
             }

      # Soft delete (D1): the row stays at zero so its ledger survives.
      assert [%{quantity_milli: 0}] = Inventory.list_inventory(actor.account_id)

      read = actor |> get_json("/api/inventory") |> json_response(200)
      assert read["data"]["sections"] == %{"ok" => [], "warning" => [], "expired" => []}
      assert read["data"]["totals"]["itemsCount"] == 0
    end
  end

  describe "an item id that is not a lot of the Account" do
    test "is inventory_item_not_found on quantity and dispose" do
      actor = actor()
      foreign = actor()
      foreign_lot = seed_lot(foreign, ingredient("Harina Test Ajena"), 500)

      for item_id <- [Ecto.UUID.generate(), foreign_lot.id, "not-a-uuid", "42"],
          {action, params} <- [{"quantity", %{"quantityMilli" => 10}}, {"dispose", %{}}] do
        conn = post_json(actor, "/api/inventory/items/#{item_id}/#{action}", params)

        assert {item_id, action, json_response(conn, 404)} ==
                 {item_id, action,
                  %{
                    "error" => %{
                      "code" => "inventory_item_not_found",
                      "message" => "The inventory item was not found."
                    }
                  }}
      end

      assert [%{quantity_milli: 500}] = Inventory.list_inventory(foreign.account_id)
      assert [%{operation: :add}] = ledger(foreign_lot.id)
    end
  end

  describe "voice adjustment errors" do
    test "a payload without a transcript is a validation error" do
      actor = actor()

      assert actor |> post_json("/api/inventory/voice/preview", %{}) |> json_response(422) ==
               validation_error()

      assert actor
             |> post_json("/api/inventory/voice/preview", %{"text" => "me comí el queso"})
             |> json_response(422) == validation_error()

      assert actor |> post_json("/api/inventory/voice/apply", %{}) |> json_response(422) ==
               validation_error()
    end

    test "a transcript longer than 500 characters is a validation error and writes nothing" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Queso Voz Largo"), 400_000)
      transcript = "me comí la mitad del queso voz largo"

      preview =
        actor
        |> post_json("/api/inventory/voice/preview", %{"transcript" => transcript})
        |> json_response(200)

      very_long = String.duplicate(transcript <> " ", 300)

      assert actor
             |> post_json("/api/inventory/voice/preview", %{"transcript" => very_long})
             |> json_response(422) == validation_error()

      assert actor
             |> post_json("/api/inventory/voice/apply", %{
               "transcript" => very_long,
               "intent" => preview["data"]["intent"],
               "confirmed" => true
             })
             |> json_response(422) == validation_error()

      assert [%{operation: :add}] = ledger(lot.id)
    end

    test "a transcript that names nothing in stock is voice_parse_failed" do
      actor = actor()
      _ = seed_lot(actor, ingredient("Queso Voz Error"), 400_000)

      conn =
        post_json(actor, "/api/inventory/voice/preview", %{"transcript" => "me comí la pizza"})

      assert %{"error" => %{"code" => "voice_parse_failed", "message" => message}} =
               json_response(conn, 422)

      assert is_binary(message) and message != ""
    end

    test "applying a low-confidence intent unconfirmed is voice_confirmation_required" do
      actor = actor()
      cheese = ingredient("Queso Voz Confirm")
      lot = seed_lot(actor, cheese, 400_000)
      transcript = "se me acabó el queso voz confirm"

      preview =
        actor
        |> post_json("/api/inventory/voice/preview", %{"transcript" => transcript})
        |> json_response(200)

      assert preview["data"]["confirmationRequired"] == true
      assert preview["data"]["confidence"] < 0.8

      payload = %{"transcript" => transcript, "intent" => preview["data"]["intent"]}

      # A client-sent confidence is never read.
      conn =
        post_json(actor, "/api/inventory/voice/apply", Map.put(payload, "confidence", 1.0))

      assert %{"error" => %{"code" => "voice_confirmation_required"}} = json_response(conn, 422)
      assert [%{operation: :add}] = ledger(lot.id)

      confirmed =
        post_json(actor, "/api/inventory/voice/apply", Map.put(payload, "confirmed", true))

      assert json_response(confirmed, 200)["data"]["quantityDeltaMilli"] == -400_000
    end
  end

  describe "voice apply with an actionId" do
    test "a repeat with the same actionId subtracts once and returns the first response" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Queso Voz Repetido"), 400_000)
      payload = actor |> voice_apply_payload("Queso Voz Repetido") |> Map.put("actionId", "a-1")

      first = actor |> post_json("/api/inventory/voice/apply", payload) |> json_response(200)
      repeat = actor |> post_json("/api/inventory/voice/apply", payload) |> json_response(200)

      assert first["data"]["quantityDeltaMilli"] == -200_000
      assert repeat == first
      assert [%{quantity_after_milli: 200_000}] = voice_events(lot)
      assert Repo.reload!(lot).quantity_milli == 200_000
    end

    test "a different actionId applies again" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Queso Voz Otra Clave"), 400_000)
      payload = voice_apply_payload(actor, "Queso Voz Otra Clave")

      for action_id <- ["b-1", "b-2"] do
        assert actor
               |> post_json("/api/inventory/voice/apply", Map.put(payload, "actionId", action_id))
               |> json_response(200)
      end

      assert [_, _] = voice_events(lot)
      assert Repo.reload!(lot).quantity_milli == 0
    end

    test "without an actionId every request applies, as before" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Queso Voz Sin Clave"), 400_000)
      payload = voice_apply_payload(actor, "Queso Voz Sin Clave")

      for _ <- 1..2 do
        assert actor |> post_json("/api/inventory/voice/apply", payload) |> json_response(200)
      end

      assert [_, _] = voice_events(lot)
      assert Repo.reload!(lot).quantity_milli == 0
    end

    test "the same actionId in another Account applies there" do
      [actor_a, actor_b] = [actor(), actor()]
      cheese = ingredient("Queso Voz Cuenta")
      lot_a = seed_lot(actor_a, cheese, 400_000)
      lot_b = seed_lot(actor_b, cheese, 400_000)

      for actor <- [actor_a, actor_b] do
        payload = actor |> voice_apply_payload("Queso Voz Cuenta") |> Map.put("actionId", "c-1")
        assert actor |> post_json("/api/inventory/voice/apply", payload) |> json_response(200)
      end

      assert Repo.reload!(lot_a).quantity_milli == 200_000
      assert Repo.reload!(lot_b).quantity_milli == 200_000
    end

    test "a failed apply stores nothing, so a retry with the same actionId applies" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Queso Voz Reintento"), 400_000)

      payload =
        actor |> voice_apply_payload("Queso Voz Reintento") |> Map.put("actionId", "d-1")

      # An edited quantity, unconfirmed.
      edited =
        payload
        |> put_in(["intent", "quantityMilli"], 100_000)
        |> Map.put("confirmed", false)

      assert %{"error" => %{"code" => "voice_confirmation_required"}} =
               actor
               |> post_json("/api/inventory/voice/apply", edited)
               |> json_response(422)

      assert [] = voice_events(lot)

      assert actor
             |> post_json("/api/inventory/voice/apply", payload)
             |> json_response(200)
             |> get_in(["data", "quantityDeltaMilli"]) == -200_000
    end

    test "an actionId that is not a non-empty string of at most 128 bytes is a validation error" do
      actor = actor()
      lot = seed_lot(actor, ingredient("Queso Voz Clave Mala"), 400_000)
      payload = voice_apply_payload(actor, "Queso Voz Clave Mala")

      for action_id <- ["", 42, String.duplicate("x", 129)] do
        assert actor
               |> post_json("/api/inventory/voice/apply", Map.put(payload, "actionId", action_id))
               |> json_response(422) == validation_error()
      end

      assert [] = voice_events(lot)
    end
  end

  test "rescue errors use the error envelope too" do
    assert actor()
           |> post_json("/api/planning/rescue", %{"ingredientIds" => []})
           |> json_response(422) == validation_error()
  end

  test "rescue plan schedules meal for today" do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    {:ok, tomato} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Tomate Test Rescue",
        category: :verduras,
        calories_per_100: 18,
        protein_g_per_100: Decimal.new("0.9"),
        carbs_g_per_100: Decimal.new("3.9"),
        fat_g_per_100: Decimal.new("0.2")
      })

    {:ok, dough} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Tapa Tarta Test Rescue",
        category: :granos,
        calories_per_100: 290,
        protein_g_per_100: Decimal.new("6.0"),
        carbs_g_per_100: Decimal.new("45.0"),
        fat_g_per_100: Decimal.new("9.0")
      })

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Tarta de Tomate Rescue",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    {:ok, _ri1} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: tomato.id,
        quantity_milli: 300,
        unit: :g
      })

    {:ok, _ri2} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: dough.id,
        quantity_milli: 1,
        unit: :unit
      })

    rescue_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/planning/rescue", %{
        "ingredient_ids" => [tomato.id, dough.id]
      })

    rescue_body = json_response(rescue_conn, 200)
    assert rescue_body["data"]["status"] == "scheduled"
    assert rescue_body["data"]["recipe"]["id"] == recipe.id

    meals = Planning.list_scheduled_meals(account_id, Date.utc_today(), Date.utc_today())
    assert Enum.any?(meals, &(&1.recipe_id == recipe.id))
  end

  # A User with an Account of their own, their token and their ids.
  defp actor do
    %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)

    %{token: token, user_id: user.id, account_id: account.id}
  end

  defp post_json(actor, path, params) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> actor.token)
    |> post(path, params)
  end

  defp get_json(actor, path) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> actor.token)
    |> get(path)
  end

  defp ingredient(name) do
    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: name,
        category: :no_perecederos,
        calories_per_100: 130,
        protein_g_per_100: Decimal.new("2.7"),
        carbs_g_per_100: Decimal.new("28.0"),
        fat_g_per_100: Decimal.new("0.3")
      })

    ingredient
  end

  defp seed_lot(actor, ingredient, quantity_milli) do
    {:ok, seed} =
      Inventory.apply_delta_and_log(%{
        account_id: actor.account_id,
        ingredient_id: ingredient.id,
        unit: :g,
        source_kind: :planned,
        delta: quantity_milli,
        source_user_id: actor.user_id,
        trigger_type: :purchase,
        operation: :add
      })

    seed.item
  end

  defp ledger(item_id) do
    Repo.all(
      from(e in InventoryMutationEvent,
        where: e.inventory_item_id == ^item_id,
        order_by: [asc: e.inserted_at]
      )
    )
  end

  # Half of the 400 g lot, as the transcript says; confirmed so the
  # confidence never gets in the way.
  defp voice_apply_payload(actor, name) do
    transcript = "me comí la mitad del #{String.downcase(name)}"

    preview =
      actor
      |> post_json("/api/inventory/voice/preview", %{"transcript" => transcript})
      |> json_response(200)

    %{"transcript" => transcript, "intent" => preview["data"]["intent"], "confirmed" => true}
  end

  defp voice_events(lot), do: Enum.filter(ledger(lot.id), &(&1.trigger_type == :voice))

  defp validation_error do
    %{"error" => %{"code" => "validation_error", "message" => "The request is not valid."}}
  end
end
