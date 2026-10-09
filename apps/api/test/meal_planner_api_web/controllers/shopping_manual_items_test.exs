defmodule MealPlannerApiWeb.ShoppingManualItemsTest do
  @moduledoc """
  The Shopping items a User adds by hand and the planned ones a User removes
  or restores (issue #40): `POST /api/shopping-items/manual`,
  `DELETE /api/shopping-items/:itemId` and `POST /api/shopping-items/set-status`.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo

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
            %{"name" => "Soap", "quantityMilli" => 0},
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

      assert %{"data" => %{"status" => "in_cart"}} = json_response(conn, 200)
      assert [%{"id" => ^id, "status" => "in_cart"}] = shopping_list(c.token)["manual"]
    end
  end

  describe "a manual item in a Cart at checkout" do
    test "closes a manual item without an Ingredient as bought; stock is issue #48", c do
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
          "items" => Enum.map(mark["data"]["reservations"], &Map.put(&1, "total_cents", 100))
        })

      assert %{"data" => %{"status" => "completed", "movedToInventoryCount" => 0}} =
               json_response(conn, 200)

      assert %{status: :checked_out} = Repo.get!(ShoppingItem, id)
      assert shopping_list(c.token)["manual"] == []
    end
  end

  # ---- helpers ---------------------------------------------------------------

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

  defp delete_item(token, id) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> delete("/api/shopping-items/#{id}")
  end

  defp shopping_list(token) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> get("/api/shopping-list")
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
