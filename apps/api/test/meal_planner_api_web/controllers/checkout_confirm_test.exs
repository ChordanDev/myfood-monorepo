defmodule MealPlannerApiWeb.CheckoutConfirmTest do
  @moduledoc """
  `POST /api/checkout/confirm` for a physical purchase (issue #43): the bought
  quantity of each list line, the lots it leaves in Inventory, the replay of
  a repeated confirm and the errors of the route.

  The fixture Cart holds one ingredient line of 1500 g: 1000 g for today's
  dinner and 500 g for tomorrow's.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.CartFixtures
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Shopping.CheckoutSession
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

  describe "bought quantities" do
    test "a confirm without lines buys every line at its suggested quantity", f do
      cart = reserve!(f)

      assert %{
               "data" => %{
                 "checkoutSessionId" => session_id,
                 "status" => "completed",
                 "checkoutType" => "physical",
                 "movedToInventoryCount" => 2,
                 "checkedOutItemsCount" => 2,
                 "actualTotalCents" => 0
               }
             } = f |> confirm(cart) |> json_response(200)

      assert session_id == cart.session_id

      assert [
               %{quantity_milli: 500, source_kind: :planned, acquired_price_cents: nil},
               %{quantity_milli: 1000, source_kind: :planned, acquired_price_cents: nil}
             ] = Enum.sort_by(stock(f), & &1.quantity_milli)

      assert Enum.all?(stock(f), &(&1.ingredient_id == f.ingredient.id and &1.acquired_at))

      assert [_, _] = events(f)

      assert Enum.all?(
               events(f),
               &(&1.trigger_type == :purchase and &1.operation == :add and
                   &1.source_checkout_session_id == cart.session_id)
             )

      assert Enum.sort(Enum.map(events(f), & &1.inventory_item_id)) ==
               Enum.sort(Enum.map(stock(f), & &1.id))

      assert Enum.all?(lines(f), &(&1.status == :checked_out))
    end

    test "a partial line covers the nearest allocation and leaves the rest needed", f do
      cart = reserve!(f)

      body =
        f
        |> confirm(cart, [%{"itemId" => f.line_id, "quantityMilli" => 300}])
        |> json_response(200)

      assert body["data"]["movedToInventoryCount"] == 1
      assert [%{quantity_milli: 300, source_kind: :planned}] = stock(f)
      assert [%{trigger_type: :purchase, quantity_delta_milli: 300}] = events(f)

      assert %{status: :checked_out, quantity_milli: 300} = reload(f.today_item)

      # The uncovered part of today's dinner is a new Shortage for that meal.
      assert [remainder] =
               Enum.filter(lines(f), &(&1.status == :pending and &1.id != f.next_item.id))

      assert remainder.scheduled_meal_id == f.meal.id
      assert remainder.planned_date == f.today_item.planned_date
      assert remainder.quantity_milli == 700
      assert remainder.checkout_session_id == nil

      # Tomorrow's dinner got nothing: it leaves the Cart as it was.
      assert %{status: :pending, quantity_milli: 500, checkout_session_id: nil} =
               reload(f.next_item)
    end

    test "a line reaching the second allocation splits its price across the lots", f do
      cart = reserve!(f)

      body =
        f
        |> confirm(cart, [%{"itemId" => f.line_id, "quantityMilli" => 1200, "totalCents" => 600}])
        |> json_response(200)

      assert body["data"]["actualTotalCents"] == 600
      assert body["data"]["movedToInventoryCount"] == 2

      assert [
               %{quantity_milli: 200, acquired_price_cents: 100},
               %{quantity_milli: 1000, acquired_price_cents: 500}
             ] = Enum.sort_by(stock(f), & &1.quantity_milli)

      assert %{status: :checked_out, quantity_milli: 1000} = reload(f.today_item)
      assert %{status: :checked_out, quantity_milli: 200} = reload(f.next_item)

      assert [%{quantity_milli: 300, scheduled_meal_id: meal_id}] =
               Enum.filter(lines(f), &(&1.status == :pending))

      assert meal_id == f.next_meal.id
      assert Repo.get!(CheckoutSession, cart.session_id).total_cents == 600
    end

    test "a quantity above the line stocks exactly what was bought", f do
      cart = reserve!(f)

      f
      |> confirm(cart, [%{"itemId" => f.line_id, "quantityMilli" => 1800}])
      |> json_response(200)

      assert [800, 1000] = stock(f) |> Enum.map(& &1.quantity_milli) |> Enum.sort()
      assert Enum.all?(lines(f), &(&1.status == :checked_out))
    end

    test "quantity zero releases the line and stocks nothing", f do
      cart = reserve!(f)

      body =
        f
        |> confirm(cart, [%{"itemId" => f.line_id, "quantityMilli" => 0}])
        |> json_response(200)

      assert body["data"]["movedToInventoryCount"] == 0
      assert stock(f) == []
      assert events(f) == []
      assert Enum.all?(lines(f), &(&1.status == :pending and is_nil(&1.checkout_session_id)))
    end
  end

  describe "manual items" do
    test "a manual item with an Ingredient enters Inventory as an extra lot", f do
      manual =
        manual_item!(f, %{
          name: "Extra rice",
          ingredient_id: f.ingredient.id,
          quantity_milli: 2000,
          unit: :g
        })

      {:ok, cart} = MealPlannerApi.Cart.reserve(f.actor, [manual.id | Enum.map(f.items, & &1.id)])

      body =
        f
        |> confirm(cart, [%{"itemId" => manual.id, "quantityMilli" => 750, "totalCents" => 90}])
        |> json_response(200)

      assert body["data"]["movedToInventoryCount"] == 3

      assert [extra] = Enum.filter(stock(f), &(&1.source_kind == :extra))
      assert %{quantity_milli: 750, acquired_price_cents: 90} = extra
      assert extra.ingredient_id == f.ingredient.id

      assert [%{trigger_type: :purchase, operation: :add, quantity_delta_milli: 750}] =
               Enum.filter(events(f), &(&1.inventory_item_id == extra.id))

      # The planned line was not listed: it is bought as suggested, as planned lots.
      assert [500, 1000] =
               stock(f)
               |> Enum.filter(&(&1.source_kind == :planned))
               |> Enum.map(& &1.quantity_milli)
               |> Enum.sort()

      assert %{status: :checked_out, quantity_milli: 750} = reload(manual)
    end

    test "a manual item without an Ingredient is bought, stocks nothing and leaves the list",
         f do
      manual = manual_item!(f, %{name: "Dish soap", quantity_milli: 1000, unit: :unit})
      {:ok, cart} = MealPlannerApi.Cart.reserve(f.actor, [manual.id])

      assert %{"data" => %{"status" => "completed", "movedToInventoryCount" => 0}} =
               f |> confirm(cart) |> json_response(200)

      assert stock(f) == []
      assert events(f) == []
      assert %{status: :checked_out} = reload(manual)

      list = f |> request(:get, "/api/shopping-list", %{}) |> json_response(200)
      assert list["data"]["manual"] == []
    end
  end

  describe "a repeated confirm" do
    test "answers 200 with the original result and creates no more lots", f do
      cart = reserve!(f)
      lines = [%{"itemId" => f.line_id, "quantityMilli" => 300, "totalCents" => 250}]

      first = f |> confirm(cart, lines) |> json_response(200)
      snapshot = {stock(f), events(f), lines(f), Repo.get!(CheckoutSession, cart.session_id)}

      assert f |> confirm(cart, lines) |> json_response(200) == first

      # A retry that carries other quantities still replays the stored result.
      assert f |> confirm(cart) |> json_response(200) == first

      assert {stock(f), events(f), lines(f), Repo.get!(CheckoutSession, cart.session_id)} ==
               snapshot
    end
  end

  describe "a rejected confirm" do
    test "a bad line leaves no lots and the Cart intact", f do
      cart = reserve!(f)
      snapshot = {lines(f), Repo.get!(CheckoutSession, cart.session_id)}
      good = %{"itemId" => f.line_id, "quantityMilli" => 300, "totalCents" => 250}

      for lines <- [
            [good, %{"itemId" => Ecto.UUID.generate(), "quantityMilli" => 100}],
            [good, good],
            [%{good | "quantityMilli" => -1}],
            [%{good | "quantityMilli" => 1.5}],
            [%{good | "quantityMilli" => "300"}],
            [Map.delete(good, "quantityMilli")],
            [%{good | "totalCents" => "250"}],
            [%{good | "totalCents" => -1}],
            [%{"itemId" => f.today_item.id, "quantityMilli" => 300}],
            ["not a line"],
            "not a list"
          ] do
        assert %{"error" => %{"code" => "validation_error", "message" => _}} =
                 f |> confirm(cart, lines) |> json_response(422)

        assert stock(f) == []
        assert events(f) == []
        assert {lines(f), Repo.get!(CheckoutSession, cart.session_id)} == snapshot
      end

      assert %{"data" => _} = f |> confirm(cart, [good]) |> json_response(200)
    end

    test "an invalid or missing checkout type is checkout_invalid_type", f do
      cart = reserve!(f)

      for params <- [%{"checkoutType" => "wholesale"}, %{}] do
        assert %{"error" => %{"code" => "checkout_invalid_type", "message" => _}} =
                 f
                 |> request(
                   :post,
                   "/api/checkout/confirm",
                   Map.put(params, "sessionId", cart.session_id)
                 )
                 |> json_response(422)
      end

      assert stock(f) == []
      assert Enum.all?(lines(f), &(&1.status == :in_cart))
    end

    test "an unknown session, or one of another Account, is checkout_session_not_found", f do
      cart = reserve!(f)
      foreign = fixture()
      foreign = Map.put(foreign, :token, token(foreign.owner, foreign.account))

      for {actor, session_id} <- [
            {f, Ecto.UUID.generate()},
            {f, "not-a-uuid"},
            {foreign, cart.session_id}
          ] do
        assert %{"error" => %{"code" => "checkout_session_not_found", "message" => _}} =
                 actor
                 |> request(:post, "/api/checkout/confirm", %{
                   "sessionId" => session_id,
                   "checkoutType" => "physical"
                 })
                 |> json_response(404)
      end

      assert %{"error" => %{"code" => "validation_error"}} =
               f
               |> request(:post, "/api/checkout/confirm", %{"checkoutType" => "physical"})
               |> json_response(422)

      assert stock(f) == []
      assert Enum.all?(lines(f), &(&1.status == :in_cart))
    end

    test "a Cart whose lease expired is cart_expired", f do
      cart = reserve!(f)
      expire!(cart)

      assert %{"error" => %{"code" => "cart_expired", "message" => _}} =
               f |> confirm(cart) |> json_response(409)

      assert stock(f) == []
      assert Enum.all?(lines(f), &(&1.status == :pending))
    end

    test "a Cart held by another member is cart_locked", f do
      cart = reserve!(f)
      other = %{f | token: token(f.member, f.account)}

      assert %{"error" => %{"code" => "cart_locked", "message" => _}} =
               other |> confirm(cart) |> json_response(409)

      assert stock(f) == []
      assert Enum.all?(lines(f), &(&1.status == :in_cart))
    end
  end

  defp confirm(f, cart, lines \\ nil) do
    params = %{"sessionId" => cart.session_id, "checkoutType" => "physical"}
    params = if lines, do: Map.put(params, "lines", lines), else: params
    request(f, :post, "/api/checkout/confirm", params)
  end

  defp reload(item), do: Repo.get!(item.__struct__, item.id)

  defp token(user, account) do
    membership = Repo.get_by!(AccountMembership, user_id: user.id, account_id: account.id)
    issue_access_v2_token(user, Repo.preload(membership, :account))
  end

  defp request(f, method, path, params) do
    conn = build_conn() |> put_req_header("authorization", "Bearer " <> f.token)
    dispatch(conn, @endpoint, method, path, params)
  end
end
