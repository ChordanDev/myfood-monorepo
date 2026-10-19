defmodule MealPlannerApiWeb.ShoppingPurchasedTest do
  @moduledoc """
  Purchased planned items on `GET /api/shopping-list` (issue #43): they stay
  on the list as `purchased` until their Scheduled meal is cooked or leaves
  the range of the read, they are never bought twice, and purchased manual
  items leave the list.

  The fixture holds one ingredient line of 1500 g: 1000 g for today's dinner
  and 500 g for tomorrow's.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query
  import MealPlannerApi.CartFixtures
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Cart
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Repo

  setup do
    f = fixture()
    [today_item, next_item] = f.items

    {:ok,
     Map.merge(f, %{
       token: token(f.owner, f.account),
       line_id: "#{f.ingredient.id}:g",
       today_item: today_item,
       next_item: next_item
     })}
  end

  describe "a purchased planned item" do
    test "is listed as purchased and no longer counts as to buy", f do
      buy!(f)

      assert %{
               "planned" => [line],
               "manual" => [],
               "cart" => nil,
               "totals" => %{"needed" => 0, "inCart" => 0, "removed" => 0, "estimatedCents" => 0}
             } = list(f)

      assert %{"id" => id, "status" => "purchased", "quantityMilli" => 1500} = line
      assert id == f.line_id

      assert [
               %{"itemId" => today_id, "status" => "purchased", "quantityMilli" => 1000},
               %{"itemId" => next_id, "status" => "purchased", "quantityMilli" => 500}
             ] = line["allocations"]

      assert {today_id, next_id} == {f.today_item.id, f.next_item.id}

      assert [
               %{"id" => ^today_id, "status" => "purchased", "quantityMilli" => 1000},
               %{"id" => ^next_id, "status" => "purchased", "quantityMilli" => 500}
             ] = list(f, %{"groupBy" => "meal"})["planned"]
    end

    test "of an online purchase reads purchased while its delivery is pending", f do
      buy!(f, nil, "online")

      assert [%{"status" => "purchased", "quantityMilli" => 1500, "allocations" => [_, _]}] =
               list(f)["planned"]
    end

    test "leaves the list once its Scheduled meal is cooked", f do
      buy!(f)
      cook!(f.meal)

      assert [%{"status" => "purchased", "quantityMilli" => 500, "allocations" => [allocation]}] =
               list(f)["planned"]

      assert allocation["itemId"] == f.next_item.id

      cook!(f.next_meal)
      assert list(f)["planned"] == []
    end

    test "is not listed when its Scheduled meal is outside the range of the read", f do
      buy!(f)
      today = Date.to_iso8601(Date.utc_today())

      assert [%{"status" => "purchased", "quantityMilli" => 1000, "allocations" => [allocation]}] =
               list(f, %{"untilDate" => today})["planned"]

      assert allocation["itemId"] == f.today_item.id
    end

    test "is not derived again as a Shortage by a later read", f do
      buy!(f)

      # The stock the purchase brought is used up, so both meals are short
      # again. Each already has its Shopping item: nothing is added.
      Repo.delete_all(
        from(i in MealPlannerApi.Persistence.Inventory.InventoryItem,
          where: i.account_id == ^f.account.id
        )
      )

      before = lines(f)

      assert [%{"status" => "purchased", "quantityMilli" => 1500}] = list(f)["planned"]
      assert [%{"status" => "purchased"}] = list(f)["planned"]
      assert lines(f) == before
    end
  end

  describe "a partial purchase" do
    setup f do
      # 1200 g of 1500 g: today's dinner in full, 200 g of tomorrow's 500 g.
      buy!(f, [%{"itemId" => f.line_id, "quantityMilli" => 1200}])
      :ok
    end

    test "lists the purchased part and keeps the remainder to buy", f do
      assert %{
               "planned" => [line],
               "totals" => %{"needed" => 1, "inCart" => 0, "removed" => 0}
             } = list(f)

      # The line is still to buy, for what is left of it.
      assert %{"status" => "needed", "quantityMilli" => 300} = line

      assert [
               %{"itemId" => today_id, "status" => "purchased", "quantityMilli" => 1000},
               _,
               _
             ] = line["allocations"]

      assert today_id == f.today_item.id

      assert [
               %{"status" => "needed", "quantityMilli" => 300},
               %{"status" => "purchased", "quantityMilli" => 200}
             ] = line["allocations"] |> tl() |> Enum.sort_by(& &1["status"])

      assert Enum.all?(tl(line["allocations"]), &(&1["scheduledMealId"] == f.next_meal.id))

      assert [{"needed", 300}, {"purchased", 200}, {"purchased", 1000}] =
               list(f, %{"groupBy" => "meal"})["planned"]
               |> Enum.map(&{&1["status"], &1["quantityMilli"]})
               |> Enum.sort()
    end

    test "only the remainder can go into a Cart", f do
      [line] = list(f)["planned"]
      [needed] = Enum.filter(line["allocations"], &(&1["status"] == "needed"))

      purchased_ids =
        for %{"status" => "purchased", "itemId" => id} <- line["allocations"], do: id

      for item_id <- purchased_ids do
        assert f
               |> request(:post, "/api/shopping-items/mark-cart", %{"itemIds" => [item_id]})
               |> json_response(422) == %{"error" => "already_reserved"}

        assert %{"error" => %{"code" => "shopping_item_not_found"}} =
                 f
                 |> request(:post, "/api/shopping-items/set-status", %{
                   "itemIds" => [item_id],
                   "status" => "removed"
                 })
                 |> json_response(404)
      end

      # Marking the whole Ingredient reserves what is still to buy, nothing else.
      assert %{"data" => %{"items" => [%{"itemId" => reserved_id, "quantityMilli" => 300}]}} =
               f
               |> request(:post, "/api/shopping-items/mark-cart", %{
                 "ingredientId" => f.ingredient.id,
                 "startDate" => Date.to_iso8601(Date.utc_today()),
                 "endDate" => Date.to_iso8601(Date.add(Date.utc_today(), 1))
               })
               |> json_response(200)

      assert reserved_id == needed["itemId"]

      # The line is in the Cart for its remainder; the purchased part stays.
      assert [%{"status" => "in_cart", "quantityMilli" => 300, "allocations" => allocations}] =
               list(f)["planned"]

      assert ["in_cart", "purchased", "purchased"] =
               allocations |> Enum.map(& &1["status"]) |> Enum.sort()
    end
  end

  test "a line whose other allocations were removed reads purchased", f do
    assert %{"data" => _} =
             f
             |> request(:post, "/api/shopping-items/set-status", %{
               "itemIds" => [f.next_item.id],
               "status" => "removed"
             })
             |> json_response(200)

    {:ok, cart} = Cart.reserve(f.actor, [f.today_item.id])
    {:ok, _} = Cart.purchase(f.actor, cart.session_id, payload(cart, nil))

    assert %{
             "planned" => [%{"status" => "purchased", "quantityMilli" => 1000} = line],
             "totals" => %{"needed" => 0, "removed" => 0}
           } = list(f)

    assert ["purchased", "removed"] = Enum.map(line["allocations"], & &1["status"])
  end

  test "purchased manual items are not listed, with or without an Ingredient", f do
    # Another Ingredient than the planned line's: its stock covers no meal.
    rice = MealPlannerApi.Generation.ServerTestFixtures.insert_ingredient("Rice #{f.account.id}")

    extra =
      manual_item!(f, %{
        name: "Extra rice",
        ingredient_id: rice.id,
        quantity_milli: 2000,
        unit: :g
      })

    soap = manual_item!(f, %{name: "Dish soap", quantity_milli: 1000, unit: :unit})
    {:ok, cart} = Cart.reserve(f.actor, [extra.id, soap.id])
    {:ok, _} = Cart.purchase(f.actor, cart.session_id, payload(cart, nil))

    for params <- [%{}, %{"groupBy" => "meal"}] do
      assert %{"manual" => [], "planned" => planned} = list(f, params)

      # Only the fixture's own planned line is there, still to buy.
      assert Enum.all?(planned, &(&1["status"] == "needed" and &1["source"] == "planned_meal"))

      listed = planned |> Enum.flat_map(& &1["allocations"]) |> Enum.map(& &1["itemId"])
      assert Enum.sort(listed) == Enum.sort([f.today_item.id, f.next_item.id])
    end
  end

  # Confirms the fixture Cart: every line as suggested, or `lines`.
  defp buy!(f, lines \\ nil, type \\ "physical") do
    cart = reserve!(f)
    params = %{"sessionId" => cart.session_id, "checkoutType" => type}
    params = if lines, do: Map.put(params, "lines", lines), else: params
    f |> request(:post, "/api/checkout/confirm", params) |> json_response(200)
  end

  defp cook!(meal),
    do: meal |> ScheduledMeal.changeset(%{is_cooked: true}) |> Repo.update!()

  defp list(f, params \\ %{}),
    do: f |> request(:get, "/api/shopping-list", params) |> json_response(200) |> Map.get("data")

  defp token(user, account) do
    membership = Repo.get_by!(AccountMembership, user_id: user.id, account_id: account.id)
    issue_access_v2_token(user, Repo.preload(membership, :account))
  end

  defp request(f, method, path, params) do
    conn = build_conn() |> put_req_header("authorization", "Bearer " <> f.token)
    dispatch(conn, @endpoint, method, path, params)
  end
end
