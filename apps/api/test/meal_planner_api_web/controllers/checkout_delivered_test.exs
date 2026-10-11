defmodule MealPlannerApiWeb.CheckoutDeliveredTest do
  @moduledoc """
  An online purchase (issue #43): `POST /api/checkout/confirm` with
  `checkoutType: "online"` leaves the session pending delivery and stocks
  nothing, and `POST /api/checkout/sessions/:id/delivered` creates the lots
  and completes it.

  The fixture Cart holds one ingredient line of 1500 g: 1000 g for today's
  dinner and 500 g for tomorrow's.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.CartFixtures
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Cart
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

  describe "an online confirm" do
    test "stocks nothing and leaves the session and its items pending delivery", f do
      cart = reserve!(f)

      assert %{
               "data" => %{
                 "checkoutSessionId" => session_id,
                 "status" => "pending_delivery",
                 "checkoutType" => "online",
                 "movedToInventoryCount" => 0,
                 "checkedOutItemsCount" => 0,
                 "actualTotalCents" => 600
               }
             } =
               f
               |> confirm(cart, [
                 %{"itemId" => f.line_id, "quantityMilli" => 1200, "totalCents" => 600}
               ])
               |> json_response(200)

      assert session_id == cart.session_id
      assert stock(f) == []
      assert events(f) == []

      assert %{status: :pending_delivery, checkout_type: :online, total_cents: 600} =
               Repo.get!(CheckoutSession, cart.session_id)

      assert %{status: :pending_delivery, quantity_milli: 1000, checkout_session_id: ^session_id} =
               reload(f.today_item)

      assert %{status: :pending_delivery, quantity_milli: 200} = reload(f.next_item)

      # The uncovered part of tomorrow's dinner is needed again, as in a
      # physical purchase.
      assert [%{quantity_milli: 300, scheduled_meal_id: meal_id, checkout_session_id: nil}] =
               Enum.filter(lines(f), &(&1.status == :pending))

      assert meal_id == f.next_meal.id
    end

    test "a quantity of zero releases the line", f do
      cart = reserve!(f)

      assert %{"data" => %{"status" => "pending_delivery", "movedToInventoryCount" => 0}} =
               f
               |> confirm(cart, [%{"itemId" => f.line_id, "quantityMilli" => 0}])
               |> json_response(200)

      assert Enum.all?(lines(f), &(&1.status == :pending and is_nil(&1.checkout_session_id)))
    end

    test "repeated while pending delivery replays the result and changes nothing", f do
      cart = reserve!(f)
      first = f |> confirm(cart) |> json_response(200)
      snapshot = {stock(f), events(f), lines(f), Repo.get!(CheckoutSession, cart.session_id)}

      assert f |> confirm(cart) |> json_response(200) == first

      assert f
             |> confirm(cart, [%{"itemId" => f.line_id, "quantityMilli" => 300}])
             |> json_response(200) == first

      assert {stock(f), events(f), lines(f), Repo.get!(CheckoutSession, cart.session_id)} ==
               snapshot
    end

    test "is never abandoned by lease expiry", f do
      cart = reserve!(f)
      f |> confirm(cart) |> json_response(200)
      expire!(cart)

      assert {:ok, 0} = Cart.expire_account(f.account.id)
      assert :ok = Cart.expire_due()
      # A Cart command and a list read both expire due leases first.
      assert {:ok, next} =
               Cart.reserve(f.actor, [
                 manual_item!(f, %{name: "Soap", quantity_milli: 1000, unit: :unit}).id
               ])

      refute next.session_id == cart.session_id
      f |> request(:get, "/api/shopping-list", %{}) |> json_response(200)

      assert %{status: :pending_delivery, invalidated_at: nil} =
               Repo.get!(CheckoutSession, cart.session_id)

      assert %{status: :pending_delivery} = reload(f.today_item)
      assert %{status: :pending_delivery} = reload(f.next_item)

      assert %{"data" => %{"status" => "completed", "movedToInventoryCount" => 2}} =
               f |> delivered(cart.session_id) |> json_response(200)
    end
  end

  describe "delivered" do
    test "creates the planned and extra lots, with their purchase events, and completes", f do
      extra =
        manual_item!(f, %{
          name: "Extra rice",
          ingredient_id: f.ingredient.id,
          quantity_milli: 2000,
          unit: :g
        })

      soap = manual_item!(f, %{name: "Dish soap", quantity_milli: 1000, unit: :unit})
      {:ok, cart} = Cart.reserve(f.actor, [extra.id, soap.id | Enum.map(f.items, & &1.id)])

      f
      |> confirm(cart, [
        %{"itemId" => f.line_id, "quantityMilli" => 1200, "totalCents" => 600},
        %{"itemId" => extra.id, "quantityMilli" => 750, "totalCents" => 90}
      ])
      |> json_response(200)

      before_delivery = DateTime.utc_now()

      assert %{
               "data" => %{
                 "checkoutSessionId" => session_id,
                 "status" => "completed",
                 "checkoutType" => "online",
                 "movedToInventoryCount" => 3,
                 "checkedOutItemsCount" => 3,
                 "actualTotalCents" => 690
               }
             } = f |> delivered(cart.session_id) |> json_response(200)

      assert session_id == cart.session_id

      assert [
               %{quantity_milli: 200, source_kind: :planned, acquired_price_cents: 100},
               %{quantity_milli: 750, source_kind: :extra, acquired_price_cents: 90},
               %{quantity_milli: 1000, source_kind: :planned, acquired_price_cents: 500}
             ] = Enum.sort_by(stock(f), & &1.quantity_milli)

      # The acquisition date is the delivery, not the confirm.
      assert Enum.all?(
               stock(f),
               &(&1.ingredient_id == f.ingredient.id and
                   DateTime.compare(&1.acquired_at, before_delivery) != :lt)
             )

      assert [_, _, _] = events(f)

      assert Enum.all?(
               events(f),
               &(&1.trigger_type == :purchase and &1.operation == :add and
                   &1.source_checkout_session_id == cart.session_id and
                   &1.source_user_id == f.owner.id)
             )

      assert Enum.sort(Enum.map(events(f), & &1.inventory_item_id)) ==
               Enum.sort(Enum.map(stock(f), & &1.id))

      assert %{status: :completed, checkout_type: :online} =
               Repo.get!(CheckoutSession, cart.session_id)

      for item <- [f.today_item, f.next_item, extra, soap] do
        assert %{status: :checked_out} = reload(item)
      end

      # Delivery changes nothing about what is still to buy: the remainders
      # of the planned line and of the manual item.
      assert [300, 1250] =
               lines(f)
               |> Enum.filter(&(&1.status == :pending))
               |> Enum.map(& &1.quantity_milli)
               |> Enum.sort()
    end

    test "repeated answers the same body and creates nothing more", f do
      cart = reserve!(f)
      f |> confirm(cart) |> json_response(200)

      first = f |> delivered(cart.session_id) |> json_response(200)
      assert first["data"]["movedToInventoryCount"] == 2
      snapshot = {stock(f), events(f), lines(f), Repo.get!(CheckoutSession, cart.session_id)}

      assert f |> delivered(cart.session_id) |> json_response(200) == first
      # A confirm retried after the delivery replays the final result too.
      assert f |> confirm(cart) |> json_response(200) == first

      assert {stock(f), events(f), lines(f), Repo.get!(CheckoutSession, cart.session_id)} ==
               snapshot
    end

    test "can be acknowledged by another member of the Account", f do
      cart = reserve!(f)
      f |> confirm(cart) |> json_response(200)
      member = %{f | token: token(f.member, f.account)}

      assert %{"data" => %{"status" => "completed", "movedToInventoryCount" => 2}} =
               member |> delivered(cart.session_id) |> json_response(200)

      assert Enum.all?(events(f), &(&1.source_user_id == f.member.id))
    end

    test "stocks what was bought even if its Scheduled meal is gone", f do
      cart = reserve!(f)
      f |> confirm(cart) |> json_response(200)
      # Deleting the meal deletes its Shopping items with it.
      Repo.delete!(f.next_meal)
      assert Repo.get(f.next_item.__struct__, f.next_item.id) == nil

      assert %{"data" => %{"movedToInventoryCount" => 2}} =
               f |> delivered(cart.session_id) |> json_response(200)

      assert [500, 1000] = stock(f) |> Enum.map(& &1.quantity_milli) |> Enum.sort()
    end

    test "replays the result of a completed physical session", f do
      cart = reserve!(f)
      first = f |> confirm(cart, nil, "physical") |> json_response(200)
      snapshot = {stock(f), events(f), lines(f)}

      assert f |> delivered(cart.session_id) |> json_response(200) == first
      assert {stock(f), events(f), lines(f)} == snapshot
    end

    test "an unknown session, one of another Account or one that is still a Cart is not found",
         f do
      cart = reserve!(f)
      foreign = fixture()
      foreign = Map.put(foreign, :token, token(foreign.owner, foreign.account))

      pending = reserve!(foreign)
      foreign |> confirm(pending) |> json_response(200)

      for {actor, session_id} <- [
            {f, Ecto.UUID.generate()},
            {f, "not-a-uuid"},
            # A draft Cart.
            {f, cart.session_id},
            # A session pending delivery in another Account.
            {f, pending.session_id}
          ] do
        assert %{"error" => %{"code" => "checkout_session_not_found", "message" => _}} =
                 actor |> delivered(session_id) |> json_response(404)
      end

      {:ok, _} = Cart.cancel(f.actor, cart.session_id)

      assert %{"error" => %{"code" => "checkout_session_not_found"}} =
               f |> delivered(cart.session_id) |> json_response(404)

      assert stock(f) == []
      assert stock(foreign) == []
    end
  end

  defp confirm(f, cart, lines \\ nil, type \\ "online") do
    params = %{"sessionId" => cart.session_id, "checkoutType" => type}
    params = if lines, do: Map.put(params, "lines", lines), else: params
    request(f, :post, "/api/checkout/confirm", params)
  end

  defp delivered(f, session_id),
    do: request(f, :post, "/api/checkout/sessions/#{session_id}/delivered", %{})

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
