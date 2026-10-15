defmodule MealPlannerApiWeb.ShoppingManualItemsTest do
  @moduledoc """
  The Shopping items a User adds by hand and the planned ones a User removes
  or restores (issue #40): `POST /api/shopping-items/manual`,
  `DELETE /api/shopping-items/:itemId` and `POST /api/shopping-items/set-status`.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query
  import ExUnit.CaptureLog

  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.{CookingService, ShoppingService}

  import MealPlannerApi.FactoryHelpers

  setup do
    suffix = Ecto.UUID.generate()
    account = Fixtures.insert_account("Manual items #{suffix}")
    owner = Fixtures.insert_user_with_membership(account, "manual-owner-#{suffix}@example.com")

    other_account = Fixtures.insert_account("Other manual items #{suffix}")

    other_owner =
      Fixtures.insert_user_with_membership(other_account, "manual-other-#{suffix}@example.com")

    ingredient = Fixtures.insert_ingredient("Manual ingredient #{suffix}")

    recipe =
      Fixtures.insert_recipe("Manual recipe #{suffix}",
        account_id: account.id,
        created_by_user_id: owner.id
      )

    Fixtures.attach_recipe_ingredient(recipe, ingredient, 400, :g)

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account.id,
        date: Date.utc_today(),
        slot: :lunch,
        recipe_id: recipe.id,
        is_cooked: false
      })

    %{
      account: account,
      actor: %{id: owner.id, account_id: account.id},
      other_account: other_account,
      ingredient: ingredient,
      meal: meal,
      token: membership_token(owner, account),
      other_token: membership_token(other_owner, other_account)
    }
  end

  describe "POST /api/shopping-items/manual" do
    test "adds a manual item with 1 unit by default and lists it apart from the planned lines",
         c do
      data = create_manual(c.token, %{"name" => "  Dish soap  "}, 201)

      assert sorted_keys(data) ==
               ~w(allocations category id ingredientId name quantityMilli source status supermarketId unit)

      assert %{
               "name" => "Dish soap",
               "ingredientId" => nil,
               "quantityMilli" => 1000,
               "unit" => "unit",
               "status" => "needed",
               "source" => "manual",
               "supermarketId" => nil,
               "allocations" => []
             } = data

      assert is_binary(data["id"])

      list = shopping_list(c.token)
      assert [listed] = list["manual"]
      assert listed == data
      assert Enum.all?(list["planned"], &(&1["source"] == "planned_meal"))
      assert list["totals"]["needed"] == 1
    end

    test "keeps the quantity, unit and optional ingredient it is given", c do
      data =
        create_manual(
          c.token,
          %{
            "name" => "Extra tomatoes",
            "ingredientId" => c.ingredient.id,
            "quantityMilli" => 250,
            "unit" => "g"
          },
          201
        )

      assert data["ingredientId"] == c.ingredient.id
      assert data["quantityMilli"] == 250
      assert data["unit"] == "g"
      assert data["category"] == "otros"
    end

    test "never merges a manual item with the planned line of the same ingredient", c do
      create_manual(
        c.token,
        %{"name" => "Same ingredient", "ingredientId" => c.ingredient.id, "unit" => "g"},
        201
      )

      create_manual(
        c.token,
        %{"name" => "Same ingredient", "ingredientId" => c.ingredient.id, "unit" => "g"},
        201
      )

      list = shopping_list(c.token)

      assert [%{"quantityMilli" => 400, "source" => "planned_meal"}] = list["planned"]
      assert length(list["manual"]) == 2
    end

    test "rejects a request that is not valid with validation_error", c do
      for params <- [
            %{},
            %{"name" => "   "},
            %{"name" => 12},
            %{"name" => String.duplicate("a", 201)},
            # 101 graphemes, 202 codepoints: the limit counts codepoints.
            %{"name" => String.duplicate("👍🏽", 101)},
            %{"name" => "So" <> <<0>> <> "ap"},
            %{"name" => "Soap", "quantityMilli" => 0},
            %{"name" => "Soap", "quantityMilli" => 2_147_483_648},
            %{"name" => "Soap", "quantityMilli" => "3"},
            %{"name" => "Soap", "quantityMilli" => 1.5},
            %{"name" => "Soap", "unit" => "kg"},
            %{"name" => "Soap", "ingredientId" => "not-a-uuid"},
            %{"name" => "Soap", "ingredientId" => Ecto.UUID.generate()}
          ] do
        assert rejected(post_manual(c.token, params), 422) == "validation_error",
               "expected #{inspect(params)} to be rejected"
      end

      assert shopping_list(c.token)["manual"] == []
    end

    test "accepts a name of 200 codepoints and the largest stored quantity", c do
      name = String.duplicate("é", 200)

      data =
        create_manual(c.token, %{"name" => name, "quantityMilli" => 2_147_483_647}, 201)

      assert data["name"] == name
      assert data["quantityMilli"] == 2_147_483_647
    end

    test "requires a signed-in User" do
      conn = post(build_conn(), "/api/shopping-items/manual", %{"name" => "Soap"})

      assert %{"error" => %{"code" => "unauthenticated"}} = json_response(conn, 401)
    end
  end

  describe "DELETE /api/shopping-items/:itemId" do
    test "deletes a manual item of the Account", c do
      %{"id" => id} = create_manual(c.token, %{"name" => "Dish soap"}, 201)

      assert %{"data" => %{"id" => ^id}} = delete_item(c.token, id) |> json_response(200)

      assert Repo.get(ShoppingItem, id) == nil
      assert shopping_list(c.token)["manual"] == []
    end

    test "refuses a planned item with shopping_item_not_manual and keeps it", c do
      item = planned_item!(c)

      assert rejected(delete_item(c.token, item.id), 422) == "shopping_item_not_manual"
      assert Repo.get(ShoppingItem, item.id)
    end

    test "answers shopping_item_not_found for unknown, foreign and malformed ids", c do
      %{"id" => foreign_id} = create_manual(c.other_token, %{"name" => "Theirs"}, 201)

      for id <- [Ecto.UUID.generate(), foreign_id, "not-a-uuid"] do
        assert rejected(delete_item(c.token, id), 404) == "shopping_item_not_found"
      end

      assert Repo.get(ShoppingItem, foreign_id)
    end

    test "deletes a manual item that is in a Cart", c do
      %{"id" => id} = create_manual(c.token, %{"name" => "Dish soap"}, 201)
      mark_cart!(c.token, [id])

      assert %{"data" => %{"id" => ^id}} = delete_item(c.token, id) |> json_response(200)
      assert Repo.get(ShoppingItem, id) == nil
    end

    test "answers shopping_item_not_found to a second delete of the same item", c do
      %{"id" => id} = create_manual(c.token, %{"name" => "Dish soap"}, 201)

      assert %{"data" => %{"id" => ^id}} = delete_item(c.token, id) |> json_response(200)
      assert rejected(delete_item(c.token, id), 404) == "shopping_item_not_found"
    end

    test "does not delete a manual item that was already bought", c do
      %{"id" => id} = create_manual(c.token, %{"name" => "Bought soap"}, 201)
      Repo.get!(ShoppingItem, id) |> Ecto.Changeset.change(status: :checked_out) |> Repo.update!()

      assert rejected(delete_item(c.token, id), 404) == "shopping_item_not_found"
      assert Repo.get(ShoppingItem, id)
    end
  end

  describe "the list read with every status" do
    test "lists a removed planned item as removed and counts it", c do
      item = planned_item!(c, %{status: :removed})

      list = shopping_list(c.token)

      assert [%{"status" => "removed", "allocations" => [%{"itemId" => item_id}]}] =
               list["planned"]

      assert item_id == item.id

      assert list["totals"] == %{
               "needed" => 0,
               "inCart" => 0,
               "removed" => 1,
               "estimatedCents" => 0
             }
    end

    test "a manual item can enter the Cart without crashing the Cart or the read", c do
      %{"id" => id} = create_manual(c.token, %{"name" => "Dish soap"}, 201)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> c.token)
        |> post("/api/shopping-items/mark-cart", %{"item_ids" => [id]})

      assert %{"data" => %{"items" => [%{"itemId" => ^id}]}} = json_response(conn, 200)
      assert [%{"id" => ^id, "status" => "in_cart"}] = shopping_list(c.token)["manual"]
    end
  end

  describe "a manual item in a Cart at checkout" do
    test "closes a manual item without an Ingredient as bought and stocks nothing", c do
      %{"id" => id} = create_manual(c.token, %{"name" => "Dish soap"}, 201)

      mark =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> c.token)
        |> post("/api/shopping-items/mark-cart", %{"item_ids" => [id]})
        |> json_response(200)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> c.token)
        |> post("/api/checkout/confirm", %{
          "checkout_type" => "physical",
          "session_id" => mark["data"]["sessionId"],
          "lines" => [%{"item_id" => id, "quantity_milli" => 1000, "total_cents" => 100}]
        })

      assert %{
               "data" => %{
                 "status" => "completed",
                 "movedToInventoryCount" => 0,
                 "checkedOutItemsCount" => 1
               }
             } = json_response(conn, 200)

      assert %{status: :checked_out} = Repo.get!(ShoppingItem, id)
      assert shopping_list(c.token)["manual"] == []
    end
  end

  describe "POST /api/shopping-items/set-status" do
    setup c do
      later = Date.add(Date.utc_today(), 2)

      {:ok, second_meal} =
        Planning.schedule_meal(%{
          account_id: c.account.id,
          date: later,
          slot: :dinner,
          recipe_id: c.meal.recipe_id,
          is_cooked: false
        })

      first = planned_item!(c)

      second =
        planned_item!(c, %{
          scheduled_meal_id: second_meal.id,
          planned_date: second_meal.date,
          estimated_price_cents: 300
        })

      %{first: first, second: second}
    end

    test "removes a planned item and restores it", c do
      assert %{"status" => "removed", "updatedRows" => 1, "itemIds" => [id]} =
               set_status(c.token, %{"itemIds" => [c.first.id], "status" => "removed"}, 200)

      assert id == c.first.id
      assert %{status: :removed} = Repo.get!(ShoppingItem, c.first.id)

      # One of the two allocations is removed: the line keeps the other one.
      assert [%{"status" => "needed", "quantityMilli" => 400, "allocations" => [_, _]}] =
               shopping_list(c.token)["planned"]

      set_status(c.token, %{"itemIds" => [c.second.id], "status" => "removed"}, 200)

      list = shopping_list(c.token)
      assert [%{"status" => "removed", "quantityMilli" => 800}] = list["planned"]

      assert list["totals"] == %{
               "needed" => 0,
               "inCart" => 0,
               "removed" => 1,
               "estimatedCents" => 0
             }

      set_status(c.token, %{"itemIds" => [c.first.id, c.second.id], "status" => "needed"}, 200)

      list = shopping_list(c.token)
      assert [%{"status" => "needed", "quantityMilli" => 800}] = list["planned"]

      assert list["totals"] == %{
               "needed" => 1,
               "inCart" => 0,
               "removed" => 0,
               "estimatedCents" => 300
             }

      assert %{status: :pending} = Repo.get!(ShoppingItem, c.first.id)
    end

    test "excludes a removed item from the estimate and from the Cart", c do
      set_status(c.token, %{"itemIds" => [c.second.id], "status" => "removed"}, 200)

      assert shopping_list(c.token)["totals"]["estimatedCents"] == 0

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> c.token)
        |> post("/api/shopping-items/mark-cart", %{"item_ids" => [c.second.id]})

      assert conn.status >= 400
      assert %{status: :removed} = Repo.get!(ShoppingItem, c.second.id)
    end

    test "accepts a single itemId and is idempotent", c do
      for updated <- [1, 0] do
        assert %{"updatedRows" => ^updated} =
                 set_status(c.token, %{"itemId" => c.first.id, "status" => "removed"}, 200)
      end

      assert %{status: :removed} = Repo.get!(ShoppingItem, c.first.id)
    end

    test "rejects an invalid request with validation_error and changes nothing", c do
      for params <- [
            %{"itemIds" => [c.first.id]},
            %{"itemIds" => [c.first.id], "status" => "in_cart"},
            %{"itemIds" => [c.first.id], "status" => "pending"},
            %{"itemIds" => [c.first.id], "status" => 1},
            %{"status" => "removed"},
            %{"itemIds" => [], "status" => "removed"},
            %{"itemIds" => "abc", "status" => "removed"},
            %{"itemIds" => [c.first.id, c.first.id], "status" => "removed"}
          ] do
        assert rejected(post_set_status(c.token, params), 422) == "validation_error",
               "expected #{inspect(params)} to be rejected"
      end

      assert %{status: :pending} = Repo.get!(ShoppingItem, c.first.id)
    end

    test "answers shopping_item_not_found for unknown, foreign and malformed ids, all or nothing",
         c do
      %{"id" => foreign_id} = create_manual(c.other_token, %{"name" => "Theirs"}, 201)

      for id <- [Ecto.UUID.generate(), foreign_id, "not-a-uuid"] do
        params = %{"itemIds" => [c.first.id, id], "status" => "removed"}
        assert rejected(post_set_status(c.token, params), 404) == "shopping_item_not_found"
      end

      assert %{status: :pending} = Repo.get!(ShoppingItem, c.first.id)
    end

    test "refuses a manual item with shopping_item_not_planned", c do
      %{"id" => manual_id} = create_manual(c.token, %{"name" => "Dish soap"}, 201)

      params = %{"itemIds" => [c.first.id, manual_id], "status" => "removed"}
      assert rejected(post_set_status(c.token, params), 422) == "shopping_item_not_planned"

      assert %{status: :pending} = Repo.get!(ShoppingItem, c.first.id)
      assert %{status: :pending} = Repo.get!(ShoppingItem, manual_id)
    end

    test "refuses to remove an item that is in a Cart with shopping_item_in_cart", c do
      build_conn()
      |> put_req_header("authorization", "Bearer " <> c.token)
      |> post("/api/shopping-items/mark-cart", %{"item_ids" => [c.first.id]})
      |> json_response(200)

      params = %{"itemIds" => [c.first.id], "status" => "removed"}
      assert rejected(post_set_status(c.token, params), 409) == "shopping_item_in_cart"
      assert %{status: :in_cart} = Repo.get!(ShoppingItem, c.first.id)
    end

    test "refuses to remove a whole line when one of its items is in a Cart", c do
      mark_cart!(c.token, [c.first.id])

      [%{"allocations" => allocations}] = shopping_list(c.token)["planned"]
      ids = Enum.map(allocations, & &1["itemId"])
      assert Enum.sort(ids) == Enum.sort([c.first.id, c.second.id])

      params = %{"itemIds" => ids, "status" => "removed"}
      assert rejected(post_set_status(c.token, params), 409) == "shopping_item_in_cart"

      assert %{status: :in_cart} = Repo.get!(ShoppingItem, c.first.id)
      assert %{status: :pending} = Repo.get!(ShoppingItem, c.second.id)
    end

    test "does not touch an item that was already bought", c do
      Repo.get!(ShoppingItem, c.first.id)
      |> Ecto.Changeset.change(status: :checked_out)
      |> Repo.update!()

      params = %{"itemIds" => [c.first.id], "status" => "removed"}
      assert rejected(post_set_status(c.token, params), 404) == "shopping_item_not_found"
    end
  end

  describe "a range replace of the calendar (issue #40)" do
    setup c do
      owner_id =
        Repo.one!(
          from(m in AccountMembership, where: m.account_id == ^c.account.id, select: m.user_id)
        )

      other_ingredient = Fixtures.insert_ingredient("Other ingredient #{Ecto.UUID.generate()}")

      other_recipe =
        Fixtures.insert_recipe("Other recipe #{Ecto.UUID.generate()}",
          account_id: c.account.id,
          created_by_user_id: owner_id
        )

      Fixtures.attach_recipe_ingredient(other_recipe, other_ingredient, 100, :g)

      # The same Ingredient as the planned meal of the setup, in another recipe.
      same_recipe =
        Fixtures.insert_recipe("Same ingredient recipe #{Ecto.UUID.generate()}",
          account_id: c.account.id,
          created_by_user_id: owner_id
        )

      Fixtures.attach_recipe_ingredient(same_recipe, c.ingredient, 250, :g)

      %{
        today: c.meal.date,
        tomorrow: Date.add(c.meal.date, 1),
        recipe_id: c.meal.recipe_id,
        other_recipe: other_recipe,
        same_recipe: same_recipe,
        other_ingredient: other_ingredient
      }
    end

    test "keeps a manual item and a removed item while the meal still needs the Ingredient", c do
      %{"id" => manual_id} = create_manual(c.token, %{"name" => "Dish soap"}, 201)
      [%{"allocations" => [%{"itemId" => item_id}]}] = shopping_list(c.token)["planned"]
      set_status(c.token, %{"itemIds" => [item_id], "status" => "removed"}, 200)

      # The same slot, a recipe that needs the same Ingredient in another amount.
      replace_range!(c, [%{date: c.today, slot: :lunch, recipe_id: c.same_recipe.id}])

      list = shopping_list(c.token)

      assert [%{"status" => "removed", "quantityMilli" => 250, "ingredientId" => ingredient_id}] =
               list["planned"]

      assert ingredient_id == c.ingredient.id

      assert list["totals"] == %{
               "needed" => 0,
               "inCart" => 0,
               "removed" => 1,
               "estimatedCents" => 0
             }

      assert [%{"id" => ^manual_id, "name" => "Dish soap"}] = list["manual"]
      assert Repo.get(ShoppingItem, manual_id)
    end

    test "restores the removed item to needed after the replace", c do
      [%{"allocations" => [%{"itemId" => item_id}]}] = shopping_list(c.token)["planned"]
      set_status(c.token, %{"itemIds" => [item_id], "status" => "removed"}, 200)

      replace_range!(c, [%{date: c.today, slot: :lunch, recipe_id: c.recipe_id}])

      assert [%{"status" => "removed", "allocations" => [%{"itemId" => new_item_id}]}] =
               shopping_list(c.token)["planned"]

      refute new_item_id == item_id
      set_status(c.token, %{"itemIds" => [new_item_id], "status" => "needed"}, 200)
      assert [%{"status" => "needed", "quantityMilli" => 400}] = shopping_list(c.token)["planned"]
    end

    test "drops a removed item the meals no longer need, and does not bring it back", c do
      [%{"allocations" => [%{"itemId" => item_id}]}] = shopping_list(c.token)["planned"]
      set_status(c.token, %{"itemIds" => [item_id], "status" => "removed"}, 200)

      replace_range!(c, [%{date: c.today, slot: :lunch, recipe_id: c.other_recipe.id}])

      assert [%{"ingredientId" => other_id, "status" => "needed"}] =
               shopping_list(c.token)["planned"]

      assert other_id == c.other_ingredient.id
      assert Repo.get(ShoppingItem, item_id) == nil

      # A later plan that needs the Ingredient again lists it as needed.
      replace_range!(c, [%{date: c.today, slot: :lunch, recipe_id: c.recipe_id}])

      assert [%{"ingredientId" => ingredient_id, "status" => "needed"}] =
               shopping_list(c.token)["planned"]

      assert ingredient_id == c.ingredient.id
    end

    test "answers the replacement and logs when carrying the removals fails", c do
      [%{"allocations" => [%{"itemId" => item_id}]}] = shopping_list(c.token)["planned"]
      set_status(c.token, %{"itemIds" => [item_id], "status" => "removed"}, 200)

      # An instant that is not a DateTime makes the post-commit derivation raise.
      log =
        capture_log(fn ->
          assert {:ok, %{replaced: _}} =
                   ShoppingService.replace_scheduled_meals_for_range(
                     c.account.id,
                     {c.today, Date.add(c.today, 2)},
                     [%{date: c.today, slot: :lunch, recipe_id: c.recipe_id}],
                     :not_an_instant
                   )
        end)

      assert log =~ "carrying removed shopping items failed account_id=#{c.account.id}"
      assert [%{"status" => "needed"}] = shopping_list(c.token)["planned"]
    end

    test "logs the removals a replace drops", c do
      [%{"allocations" => [%{"itemId" => item_id}]}] = shopping_list(c.token)["planned"]
      set_status(c.token, %{"itemIds" => [item_id], "status" => "removed"}, 200)

      log =
        capture_log(fn ->
          replace_range!(c, [%{date: c.today, slot: :lunch, recipe_id: c.other_recipe.id}])
        end)

      assert log =~ "removed shopping items dropped by a range replace"
      assert log =~ "carried=1 restored=0"
    end

    test "removes only the slot the User removed, not the same Ingredient at another slot", c do
      [%{"allocations" => [%{"itemId" => item_id}]}] = shopping_list(c.token)["planned"]
      set_status(c.token, %{"itemIds" => [item_id], "status" => "removed"}, 200)

      replace_range!(c, [
        %{date: c.today, slot: :lunch, recipe_id: c.recipe_id},
        %{date: c.today, slot: :dinner, recipe_id: c.recipe_id}
      ])

      lines = shopping_list(c.token, %{"groupBy" => "meal"})["planned"]
      statuses = Map.new(lines, &{hd(&1["allocations"])["slot"], &1["status"]})

      assert statuses == %{"lunch" => "removed", "dinner" => "needed"}
    end
  end

  describe "a removed item whose meal changes" do
    setup c do
      [%{"allocations" => [%{"itemId" => item_id}]}] = shopping_list(c.token)["planned"]
      set_status(c.token, %{"itemIds" => [item_id], "status" => "removed"}, 200)
      %{removed_id: item_id}
    end

    test "is dropped by a recipe swap of its meal", c do
      owner_id = c.actor.id
      ingredient = Fixtures.insert_ingredient("Swap ingredient #{Ecto.UUID.generate()}")

      recipe =
        Fixtures.insert_recipe("Swap recipe #{Ecto.UUID.generate()}",
          account_id: c.account.id,
          created_by_user_id: owner_id
        )

      Fixtures.attach_recipe_ingredient(recipe, ingredient, 100, :g)

      assert {:ok, _meal} =
               Calendar.upsert_scheduled_meal(c.account.id, %{
                 date: c.meal.date,
                 slot: :lunch,
                 recipe_id: recipe.id
               })

      assert Repo.get(ShoppingItem, c.removed_id) == nil

      assert [%{"ingredientId" => ingredient_id, "status" => "needed"}] =
               shopping_list(c.token)["planned"]

      assert ingredient_id == ingredient.id

      params = %{"itemIds" => [c.removed_id], "status" => "needed"}
      assert rejected(post_set_status(c.token, params), 404) == "shopping_item_not_found"
    end

    test "is dropped when its meal is cooked", c do
      MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(c.account, :eligible)
      {:ok, session} = CookingService.start_session(c.actor, c.meal.id)
      assert {:ok, _result} = CookingService.finish_session(c.actor, session.session_id)

      assert Repo.get(ShoppingItem, c.removed_id) == nil
      assert shopping_list(c.token)["planned"] == []

      params = %{"itemIds" => [c.removed_id], "status" => "needed"}
      assert rejected(post_set_status(c.token, params), 404) == "shopping_item_not_found"
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp mark_cart!(token, item_ids) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> post("/api/shopping-items/mark-cart", %{"item_ids" => item_ids})
    |> json_response(200)
  end

  defp planned_item!(c, overrides \\ %{}) do
    {:ok, item} =
      Shopping.create_shopping_item(
        Map.merge(
          %{
            account_id: c.account.id,
            scheduled_meal_id: c.meal.id,
            planned_date: c.meal.date,
            ingredient_id: c.ingredient.id,
            quantity_milli: 400,
            unit: :g,
            status: :pending
          },
          overrides
        )
      )

    item
  end

  defp membership_token(user, account) do
    membership =
      AccountMembership
      |> Repo.get_by!(user_id: user.id, account_id: account.id)
      |> Repo.preload(:account)

    issue_access_v2_token(user, membership)
  end

  defp post_manual(token, params) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> post("/api/shopping-items/manual", params)
  end

  defp create_manual(token, params, status) do
    token
    |> post_manual(params)
    |> json_response(status)
    |> assert_camel_case_keys()
    |> Map.fetch!("data")
  end

  defp post_set_status(token, params) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> post("/api/shopping-items/set-status", params)
  end

  defp set_status(token, params, status) do
    token
    |> post_set_status(params)
    |> json_response(status)
    |> assert_camel_case_keys()
    |> Map.fetch!("data")
  end

  defp delete_item(token, id) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> delete("/api/shopping-items/#{id}")
  end

  defp replace_range!(c, meals) do
    account_id = c.account.id
    range = {c.today, Date.add(c.today, 2)}

    assert {:ok, %{replaced: _}} =
             ShoppingService.replace_scheduled_meals_for_range(
               account_id,
               range,
               meals
             )
  end

  defp shopping_list(token, params \\ %{}) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> get("/api/shopping-list", params)
    |> json_response(200)
    |> assert_camel_case_keys()
    |> Map.fetch!("data")
  end

  # The code of a rejected call, after checking that the body is the envelope.
  defp rejected(conn, status) do
    body = json_response(conn, status)

    assert %{"error" => %{"code" => code, "message" => message} = error} = body
    assert sorted_keys(body) == ["error"]
    assert sorted_keys(error) == ["code", "message"]
    assert is_binary(message) and message != ""

    code
  end

  defp sorted_keys(map), do: map |> Map.keys() |> Enum.sort()
end
