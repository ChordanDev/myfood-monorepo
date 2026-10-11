defmodule MealPlannerApiWeb.CartLifecycleTest do
  use MealPlannerApiWeb.ConnCase, async: false
  import Phoenix.ConnTest, except: [connect: 2, connect: 3]
  import Phoenix.ChannelTest
  import MealPlannerApi.CartFixtures
  import MealPlannerApi.FactoryHelpers
  alias MealPlannerApi.{Cart, Repo}
  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership}
  alias MealPlannerApiWeb.{ShoppingChannel, UserSocket}
  alias Phoenix.Channel.Server

  setup do
    f = fixture()
    old = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
    Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)
    on_exit(fn -> Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, old) end)
    {:ok, Map.put(f, :token, token(f.owner, f.account))}
  end

  test "authenticated HTTP lifecycle publishes account-scoped reservation, release, expiry, purchase and inventory changes",
       f do
    {:ok, socket} = connect(UserSocket, %{"token" => token(f.member, f.account)})
    {:ok, _, _socket} = subscribe_and_join(socket, ShoppingChannel, "shopping:#{f.account.id}")
    foreign = fixture()
    {:ok, other_socket} = connect(UserSocket, %{"token" => token(foreign.owner, foreign.account)})

    assert {:error, %{reason: "forbidden"}} =
             subscribe_and_join(other_socket, ShoppingChannel, "shopping:#{f.account.id}")

    cart =
      request(f, :post, "/api/shopping-items/mark-cart", %{
        "item_ids" => Enum.map(f.items, & &1.id)
      })
      |> json_response(200)
      |> Map.fetch!("data")

    assert_push "cart_reserved", %{owner_user_id: owner_id}
    assert owner_id == f.owner.id
    assert %{"sessionId" => id, "leaseExpiresAt" => _, "items" => [_, _]} = cart

    assert %{"data" => _} =
             request(f, :post, "/api/cart/#{id}/activity", %{}) |> json_response(200)

    assert_push "cart_renewed", _
    [line | _] = cart["items"]

    assert %{"data" => _} =
             request(f, :post, "/api/shopping-items/mark-cart", %{
               "in_cart" => false,
               "session_id" => id,
               "items" => [line]
             })
             |> json_response(200)

    assert_push "cart_released", _
    assert %{"data" => _} = request(f, :delete, "/api/cart/#{id}", %{}) |> json_response(200)
    assert_push "cart_released", _

    current = reserve!(f)
    assert_push "cart_reserved", _
    expire!(current)
    assert {:ok, 1} = Cart.expire_account(f.account.id)
    assert_push "cart_expired", _
    current = reserve!(f)
    assert_push "cart_reserved", _

    assert %{"data" => %{"actualTotalCents" => 250}} =
             confirmed =
             request(f, :post, "/api/checkout/confirm", payload(current)) |> json_response(200)

    assert_push "purchase_confirmed", _
    assert_push "inventory_changed", _

    # A repeated confirm replays the result and announces nothing.
    assert request(f, :post, "/api/checkout/confirm", payload(current)) |> json_response(200) ==
             confirmed

    refute_push "purchase_confirmed", _
    refute_push "inventory_changed", _

    lot = hd(stock(f))

    assert %{"data" => _} =
             request(f, :post, "/api/inventory/items/#{lot.id}/quantity", %{
               "quantity_milli" => 450
             })
             |> json_response(200)

    assert_push "inventory_changed", _
    assert length(events(f)) == 2
    # A foreign topic must not reach the subscribed member.
    Cart.notify(foreign.account.id, "cart_reserved", %{session_id: "foreign"})
    refute_push "cart_reserved", _
  end

  test "expired Account cannot reserve, buy, renew, cancel, or adjust and cannot receive realtime events",
       f do
    cart = reserve!(f)
    {:ok, socket} = connect(UserSocket, %{"token" => f.token})
    {:ok, _, joined} = subscribe_and_join(socket, ShoppingChannel, "shopping:#{f.account.id}")
    snapshot = {lines(f), stock(f), events(f)}
    expire_account!(f.account)

    for {method, path, data} <- [
          {:post, "/api/shopping-items/mark-cart", %{"item_ids" => Enum.map(f.items, & &1.id)}},
          {:post, "/api/checkout/confirm", payload(cart)},
          {:post, "/api/cart/#{cart.session_id}/activity", %{}},
          {:delete, "/api/cart/#{cart.session_id}", %{}},
          {:post, "/api/inventory/items/add-extra",
           %{"ingredient_id" => f.ingredient.id, "quantity_milli" => 100, "unit" => "g"}},
          {:post, "/api/inventory/items/#{Ecto.UUID.generate()}/quantity",
           %{"quantity_milli" => 10}}
        ] do
      assert %{"error" => %{"code" => "trial_expired"}} =
               request(f, method, path, data) |> json_response(403)
    end

    assert {lines(f), stock(f), events(f)} == snapshot

    assert {:error, :subscription_required} =
             Cart.purchase(f.actor, cart.session_id, payload(cart))

    assert {:error, %{reason: "forbidden"}} =
             subscribe_and_join(socket, ShoppingChannel, "shopping:#{f.account.id}")

    # Exercise recipient-side authorization even if a producer bypasses its eligibility check.
    Server.broadcast!(MealPlannerApi.PubSub, joined.topic, "inventory_changed", %{
      refresh: true
    })

    _ = :sys.get_state(joined.channel_pid)
    refute_push "inventory_changed", _
  end

  test "same-account member reads ownership; foreign Account cannot mutate cart or inventory",
       f do
    cart = reserve!(f)
    other = %{f | token: token(f.member, f.account)}
    view = request(other, :get, "/api/shopping-list", %{}) |> json_response(200)

    # The member sees the owner's reservation on the lines, but the Cart
    # itself is only reported to the member who holds it.
    assert [%{"status" => "in_cart", "allocations" => [_, _]}] = view["data"]["planned"]
    assert view["data"]["cart"] == nil

    own_view = request(f, :get, "/api/shopping-list", %{}) |> json_response(200)
    assert own_view["data"]["cart"]["sessionId"] == cart.session_id

    assert %{"error" => %{"code" => "cart_locked"}} =
             request(other, :post, "/api/checkout/confirm", payload(cart)) |> json_response(409)

    assert %{"data" => _} =
             request(f, :post, "/api/checkout/confirm", payload(cart)) |> json_response(200)

    foreign = fixture()
    foreign = Map.put(foreign, :token, token(foreign.owner, foreign.account))
    lot = hd(stock(f))
    snapshot = {stock(f), events(f)}

    assert %{"error" => %{"code" => "inventory_item_not_found"}} =
             request(foreign, :post, "/api/inventory/items/#{lot.id}/quantity", %{
               "quantity_milli" => 999
             })
             |> json_response(404)

    assert {stock(f), events(f)} == snapshot

    assert %{"error" => %{"code" => "checkout_session_not_found"}} =
             request(foreign, :post, "/api/checkout/confirm", payload(cart)) |> json_response(404)
  end

  test "suspended member receives no subsequent events", f do
    member_token = token(f.member, f.account)
    {:ok, socket} = connect(UserSocket, %{"token" => member_token})
    {:ok, _, joined} = subscribe_and_join(socket, ShoppingChannel, "shopping:#{f.account.id}")
    membership = Repo.get_by!(AccountMembership, user_id: f.member.id, account_id: f.account.id)
    membership |> AccountMembership.changeset(%{status: :suspended}) |> Repo.update!()
    Cart.notify(f.account.id, "cart_reserved", %{session_id: "hidden"})
    _ = :sys.get_state(joined.channel_pid)
    refute_push "cart_reserved", _
  end

  test "another Membership marking items held in a live Cart gets cart_locked in the envelope",
       f do
    cart = reserve!(f)
    other = %{f | token: token(f.member, f.account)}

    assert %{"error" => %{"code" => "cart_locked", "message" => message}} =
             request(other, :post, "/api/shopping-items/mark-cart", %{
               "item_ids" => [hd(f.items).id]
             })
             |> json_response(409)

    assert is_binary(message)
    assert Enum.all?(lines(f), &(&1.checkout_session_id == cart.session_id))
  end

  test "marking by ingredient answers the same envelope and cart_locked as marking by item ids",
       f do
    range = %{
      "ingredient_id" => f.ingredient.id,
      "in_cart" => true,
      "start_date" => Date.to_iso8601(Date.utc_today()),
      "end_date" => Date.to_iso8601(Date.add(Date.utc_today(), 1))
    }

    other = %{f | token: token(f.member, f.account)}

    assert %{"data" => %{"sessionId" => id, "leaseExpiresAt" => _, "items" => [_, _]} = data} =
             request(f, :post, "/api/shopping-items/mark-cart", range) |> json_response(200)

    refute Map.has_key?(data, "reservations")

    assert %{"error" => %{"code" => "cart_locked"}} =
             request(other, :post, "/api/shopping-items/mark-cart", range)
             |> json_response(409)

    assert Enum.all?(lines(f), &(&1.checkout_session_id == id))
  end

  test "renew and cancel answer errors in the envelope and keep their success shapes", f do
    cart = reserve!(f)
    other = %{f | token: token(f.member, f.account)}
    missing = Ecto.UUID.generate()

    assert %{"data" => %{"sessionId" => id, "leaseExpiresAt" => _}} =
             request(f, :post, "/api/cart/#{cart.session_id}/activity", %{})
             |> json_response(200)

    assert id == cart.session_id

    for {method, path} <- [
          {:post, "/api/cart/#{cart.session_id}/activity"},
          {:delete, "/api/cart/#{cart.session_id}"},
          {:post, "/api/cart/#{missing}/activity"},
          {:delete, "/api/cart/#{missing}"}
        ] do
      assert %{"error" => %{"code" => "cart_not_found"}} =
               request(other, method, path, %{}) |> json_response(404)
    end

    expire!(cart)

    for {method, path} <- [
          {:post, "/api/cart/#{cart.session_id}/activity"},
          {:delete, "/api/cart/#{cart.session_id}"}
        ] do
      assert %{"error" => %{"code" => "stale_cart"}} =
               request(f, method, path, %{}) |> json_response(409)
    end
  end

  test "cancel reports the Cart as abandoned", f do
    cart = reserve!(f)

    assert %{"data" => %{"sessionId" => id, "status" => "abandoned"}} =
             request(f, :delete, "/api/cart/#{cart.session_id}", %{}) |> json_response(200)

    assert id == cart.session_id
    assert Enum.all?(lines(f), &(&1.status == :pending))
  end

  test "an expired lease reads back as cart null on the Shopping list", f do
    cart = reserve!(f)

    assert request(f, :get, "/api/shopping-list", %{})
           |> json_response(200)
           |> get_in(["data", "cart", "sessionId"]) ==
             cart.session_id

    expire!(cart)
    assert {:ok, 1} = Cart.expire_account(f.account.id)

    view = request(f, :get, "/api/shopping-list", %{}) |> json_response(200)
    assert view["data"]["cart"] == nil
    assert Enum.all?(view["data"]["planned"], &(&1["status"] != "in_cart"))
  end

  defp token(user, account) do
    membership = Repo.get_by!(AccountMembership, user_id: user.id, account_id: account.id)
    issue_access_v2_token(user, Repo.preload(membership, :account))
  end

  defp request(f, method, path, params) do
    conn = build_conn() |> put_req_header("authorization", "Bearer " <> f.token)
    dispatch(conn, @endpoint, method, path, params)
  end

  defp expire_account!(account) do
    past = DateTime.add(DateTime.utc_now(), -86_400)
    account |> Account.changeset(%{trial_started_at: past, trial_ends_at: past}) |> Repo.update!()
  end
end
