defmodule MealPlannerApi.Cart do
  @moduledoc "Account-scoped cart leases and the single atomic purchase authority."
  import Ecto.Query
  alias MealPlannerApi.Persistence.{Identity, Inventory, Shopping}
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Persistence.Shopping.{CheckoutSession, ShoppingItem}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.{PlanningRequestValidator, ShoppingRebuilder}
  alias Phoenix.Channel.Server

  @lease_seconds 3600

  # The result of a confirmed purchase, as `CheckoutSession.purchase_result`
  # stores it and a repeated confirm replays it.
  @result_keys ~w(checkout_session_id status checkout_type moved_to_inventory_count
                  checked_out_items_count actual_total_cents)a

  def reserve(user, item_ids) when is_list(item_ids) and item_ids != [] do
    with {:ok, ids} <- identity(user) do
      transact(ids, "cart_reserved", fn now -> reserve_items!(ids, item_ids, now) end)
    end
  end

  def reserve(_, _), do: {:error, :invalid_payload}

  defp reserve_items!(ids, item_ids, now) do
    require!(Enum.all?(item_ids, &valid_id?/1), :invalid_payload)
    cart = active_cart(ids, now)
    items = lock_items(ids.account_id, item_ids)
    require!(length(items) == length(Enum.uniq(item_ids)), :item_not_found)

    Enum.each(items, fn item ->
      # An item in another Membership's live Cart is locked; any other
      # state (purchased, removed) is not available to reserve at all.
      require!(
        not (item.status == :in_cart and item.checkout_session_id != cart.id),
        :cart_locked
      )

      require!(item.status in [:pending, :in_cart], :already_reserved)
    end)

    reserved =
      Enum.map(items, fn item ->
        update!(item, %{
          status: :in_cart,
          checkout_session_id: cart.id,
          reservation_token: item.reservation_token || Ecto.UUID.generate()
        })
      end)

    cart = renew!(cart, now)

    %{
      session_id: cart.id,
      status: "in_cart",
      updated_rows: length(items),
      owner_user_id: ids.user_id,
      lease_expires_at: cart.lease_expires_at,
      reservations: Enum.map(reserved, &reservation/1)
    }
  end

  def reserve_ingredient(user, ingredient_id, from_date, to_date) do
    with {:ok, ids} <- identity(user) do
      item_ids =
        Repo.all(
          from(i in ShoppingItem,
            where:
              i.account_id == ^ids.account_id and i.ingredient_id == ^ingredient_id and
                i.planned_date >= ^from_date and i.planned_date <= ^to_date and
                i.status in [:pending, :in_cart],
            select: i.id
          )
        )

      reserve(user, item_ids)
    end
  end

  def remove(user, session_id, reservations) when is_list(reservations) and reservations != [] do
    with {:ok, ids} <- identity(user) do
      transact(ids, "cart_released", fn now ->
        remove_lines!(ids, session_id, reservations, now)
      end)
    end
  end

  def remove(_, _, _), do: {:error, :invalid_payload}

  defp remove_lines!(ids, session_id, reservations, now) do
    cart = owned_cart!(ids, session_id, now)
    items = validate_lines!(ids, cart, reservations)
    Enum.each(items, fn {item, _line} -> release!(item) end)
    renew!(cart, now)
    %{session_id: cart.id, updated_rows: length(items), status: "pending"}
  end

  def renew(user, session_id) do
    with {:ok, ids} <- identity(user) do
      transact(ids, "cart_renewed", fn now ->
        cart = owned_cart!(ids, session_id, now) |> renew!(now)
        %{session_id: cart.id, lease_expires_at: cart.lease_expires_at}
      end)
    end
  end

  def cancel(user, session_id) do
    with {:ok, ids} <- identity(user) do
      transact(ids, "cart_released", fn now ->
        cart = owned_cart!(ids, session_id, now)
        count = release_cart!(cart, now)
        %{session_id: cart.id, updated_rows: count, status: "abandoned"}
      end)
    end
  end

  @doc """
  Confirms a Cart as purchased (issue #43).

  `payload` carries `"checkout_type"` and, optionally, `"lines"`: the bought
  `"quantity_milli"` and `"total_cents"` of a list line, named by
  `"item_id"`. That is the id the Shopping list gives the line:
  `"<ingredient_id>:<unit>"` for the planned items of an Ingredient, the
  item's own id for a manual one. A line that is not listed is bought at its
  suggested quantity, the one reserved in the Cart.

  Confirming a session that is already completed changes nothing and
  returns the result of the first confirm.

  Errors: `:validation_error` (no session id, malformed lines, an empty
  Cart), `:checkout_session_not_found`, `:cart_locked` (the Cart of another
  member), `:cart_expired` and `:checkout_invalid_type`.
  """
  # Both online and physical purchase confirmations add the actual purchase now.
  # Delivery acknowledgement is not another inventory mutation (#29).
  def purchase(user, session_id, payload) when is_map(payload) do
    with {:ok, ids} <- identity(user),
         {:ok, {outcome, result}} <-
           transact(ids, nil, fn now -> confirm_purchase!(ids, session_id, payload, now) end) do
      # A replayed confirm changed nothing, so it is not announced again.
      if outcome == :confirmed, do: notify_purchase(ids.account_id, result)
      {:ok, result}
    end
  end

  def purchase(_, _, _), do: {:error, :validation_error}

  defp confirm_purchase!(ids, session_id, payload, now) do
    cart = checkout_session!(ids, session_id)

    if cart.status == :completed do
      {:replayed, stored_result(cart)}
    else
      require_live!(cart, now)
      type = payload["checkout_type"]
      require!(type in ["physical", "online"], :checkout_invalid_type)
      lines = cart |> cart_lines() |> bought_lines!(payload["lines"])
      require!(lines != [], :validation_error)
      moved = lines |> Enum.map(&purchase_line!(ids, cart, &1, now)) |> Enum.sum()
      total = lines |> Enum.map(&(&1.total_cents || 0)) |> Enum.sum()

      result = %{
        checkout_session_id: cart.id,
        status: "completed",
        checkout_type: type,
        moved_to_inventory_count: moved,
        checked_out_items_count: moved,
        actual_total_cents: total
      }

      update!(cart, %{
        status: :completed,
        checkout_type: type,
        total_cents: total,
        confirmed_by_user_id: ids.user_id,
        confirmed_at: now,
        purchase_result: result
      })

      {:confirmed, result}
    end
  end

  # The session a confirm names. One of another Account, or one another
  # member already closed, does not exist for this User; a live Cart of
  # another member is locked.
  defp checkout_session!(ids, session_id) do
    require!(is_binary(session_id), :validation_error)
    require!(valid_id?(session_id), :checkout_session_not_found)

    cart =
      Repo.one(
        from(c in CheckoutSession,
          where: c.account_id == ^ids.account_id and c.id == ^session_id,
          lock: "FOR UPDATE"
        )
      )

    require!(not is_nil(cart), :checkout_session_not_found)

    cond do
      cart.reserved_by_user_id == ids.user_id -> cart
      cart.status == :draft and cart.reserved_by_user_id -> Repo.rollback(:cart_locked)
      true -> Repo.rollback(:checkout_session_not_found)
    end
  end

  # A session that is neither completed nor a live Cart was abandoned: its
  # lease ran out, or the User cancelled it.
  defp require_live!(cart, now) do
    require!(
      cart.status == :draft and not is_nil(cart.lease_expires_at) and
        DateTime.compare(cart.lease_expires_at, now) == :gt,
      :cart_expired
    )
  end

  # `purchase_result` comes back from JSON with string keys; a replay answers
  # the same map the first confirm did.
  defp stored_result(%CheckoutSession{purchase_result: stored}) do
    stored = stored || %{}
    Map.new(@result_keys, &{&1, Map.get(stored, Atom.to_string(&1))})
  end

  # The Cart as the lines of the Shopping list: the planned items of an
  # Ingredient and unit share a line, its allocations nearest first (date,
  # then slot); a manual item is a line of its own. Lines are ordered by
  # Ingredient and unit, which is Inventory's canonical lock order.
  defp cart_lines(cart) do
    items = cart_items(cart)
    slots = meal_slots(items)

    items
    |> Enum.group_by(&line_id/1)
    |> Enum.map(fn {id, rows} ->
      rows = Enum.sort_by(rows, &allocation_position(&1, slots))
      %{id: id, items: rows, quantity_milli: rows |> Enum.map(& &1.quantity_milli) |> Enum.sum()}
    end)
    |> Enum.sort_by(fn %{id: id, items: [first | _]} -> {first.ingredient_id, first.unit, id} end)
  end

  defp line_id(%ShoppingItem{source: :manual} = item), do: item.id
  defp line_id(item), do: "#{item.ingredient_id}:#{item.unit}"

  defp meal_slots(items) do
    meal_ids = items |> Enum.map(& &1.scheduled_meal_id) |> Enum.reject(&is_nil/1)

    from(m in ScheduledMeal, where: m.id in ^meal_ids, select: {m.id, m.slot})
    |> Repo.all()
    |> Map.new()
  end

  # The order `ShoppingRebuilder.group_lines/2` lists allocations in.
  defp allocation_position(%ShoppingItem{planned_date: %Date{} = date} = item, slots) do
    slot = Map.get(slots, item.scheduled_meal_id)
    {Date.to_erl(date), ShoppingRebuilder.slot_rank(slot), item.id}
  end

  defp allocation_position(item, _slots), do: {nil, 0, item.id}

  # Gives every Cart line the quantity and the price it was bought at: the
  # ones `requested` carries, or the suggested quantity and no price.
  defp bought_lines!(lines, nil), do: Enum.map(lines, &bought_line(&1, nil))

  defp bought_lines!(lines, requested) do
    require!(is_list(requested) and Enum.all?(requested, &is_map/1), :validation_error)
    Enum.each(requested, &validate_bought_line!/1)
    by_id = Map.new(requested, &{&1["item_id"], &1})
    known = MapSet.new(lines, & &1.id)

    require!(
      map_size(by_id) == length(requested) and Enum.all?(Map.keys(by_id), &(&1 in known)),
      :validation_error
    )

    Enum.map(lines, &bought_line(&1, Map.get(by_id, &1.id)))
  end

  defp bought_line(line, nil), do: Map.put(line, :total_cents, nil)

  defp bought_line(line, requested) do
    %{line | quantity_milli: requested["quantity_milli"]}
    |> Map.put(:total_cents, requested["total_cents"])
  end

  defp validate_bought_line!(line) do
    quantity = line["quantity_milli"]
    total = line["total_cents"]
    require!(is_integer(quantity) and quantity >= 0, :validation_error)
    require!(is_nil(total) or (is_integer(total) and total >= 0), :validation_error)
    # Nothing bought costs nothing.
    require!(quantity > 0 or total in [nil, 0], :validation_error)
  end

  # Settles the items of one line and returns how many lots it created.
  defp purchase_line!(ids, cart, line, now) do
    line.items
    |> cover(line.quantity_milli)
    |> with_prices(line.total_cents)
    |> Enum.map(&purchase_item!(ids, cart, &1, now))
    |> Enum.sum()
  end

  # Spreads the bought quantity of a line over its allocations, nearest
  # first, as `{item, bought}`: an allocation is covered in full before the
  # next one gets anything. A quantity above the line goes to the last
  # allocation, so Inventory gains exactly what was bought.
  defp cover(items, quantity) do
    {covered, surplus} =
      Enum.map_reduce(items, quantity, fn item, left ->
        bought = min(item.quantity_milli, left)
        {{item, bought}, left - bought}
      end)

    {{last, bought}, rest} = List.pop_at(covered, -1)
    rest ++ [{last, bought + surplus}]
  end

  # A line's `total_cents` is shared by its lots in proportion to their
  # quantity; the last lot takes the cents rounding left over, so the lots
  # add up to the total. A line without a total leaves its lots unpriced.
  defp with_prices(covered, nil),
    do: Enum.map(covered, fn {item, bought} -> {item, bought, nil} end)

  defp with_prices(covered, total_cents) do
    quantity = covered |> Enum.map(&elem(&1, 1)) |> Enum.sum()

    {priced, _left} =
      Enum.map_reduce(covered, {total_cents, quantity}, fn
        {item, 0}, left ->
          {{item, 0, nil}, left}

        {item, bought}, {cents, quantity} ->
          share = div(cents * bought, quantity)
          {{item, bought, share}, {cents - share, quantity - bought}}
      end)

    priced
  end

  # An allocation that got nothing leaves the Cart and stays needed.
  defp purchase_item!(_ids, _cart, {item, 0, _price_cents}, _now) do
    release!(item)
    0
  end

  defp purchase_item!(ids, cart, {item, bought, price_cents}, now) do
    lots = add_purchased_stock!(ids, cart, item, bought, price_cents, now)
    price = if price_cents, do: %{estimated_price_cents: price_cents}, else: %{}

    # Close the purchased item before storing its remainder: both share the
    # planned key, and only one open Shopping item is allowed per key. The
    # remainder is computed from `item`, which still holds the reserved
    # quantity.
    update!(item, Map.merge(%{status: :checked_out, quantity_milli: bought}, price))

    if bought < item.quantity_milli do
      item
      |> Map.from_struct()
      |> Map.take([
        :account_id,
        :scheduled_meal_id,
        :planned_date,
        :ingredient_id,
        :unit,
        :assigned_supermarket_id,
        :source,
        :name
      ])
      |> Map.merge(%{quantity_milli: item.quantity_milli - bought, status: :pending})
      |> then(&ShoppingItem.changeset(%ShoppingItem{}, &1))
      |> insert!()
    end

    lots
  end

  # A manual item with no Ingredient has no stock to add to: it is closed
  # as bought and creates no lot.
  defp add_purchased_stock!(_ids, _cart, %{ingredient_id: nil}, _bought, _price_cents, _now),
    do: 0

  # One lot per purchased item, with its `purchase` mutation event: `planned`
  # for the item of a Scheduled meal, `extra` for a manual one.
  defp add_purchased_stock!(ids, cart, item, bought, price_cents, now) do
    case Inventory.apply_delta_and_log(%{
           account_id: ids.account_id,
           ingredient_id: item.ingredient_id,
           unit: item.unit,
           source_kind: if(item.source == :manual, do: :extra, else: :planned),
           delta: bought,
           source_user_id: ids.user_id,
           trigger_type: :purchase,
           operation: :add,
           acquired_at: now,
           acquired_price_cents: price_cents,
           source_checkout_session_id: cart.id,
           metadata: %{shopping_item_id: item.id}
         }) do
      {:ok, _} -> 1
      {:error, reason} -> Repo.rollback(reason)
    end
  end

  def delivery(user, session_id) do
    with {:ok, ids} <- identity(user) do
      case Shopping.get_checkout_session_for_account(ids.account_id, session_id) do
        %CheckoutSession{status: :completed, purchase_result: result} when is_map(result) ->
          {:ok, Map.put(result, "moved_to_inventory_count", 0)}

        _ ->
          {:error, :invalid_checkout_status}
      end
    end
  end

  @doc """
  The active Cart a User holds in an Account, or `nil`.

  A Cart is active while its session is a draft reserved by that User and
  its lease has not run out at `now`. This is a plain read: it takes no
  lock and does not renew the lease.
  """
  @spec active_for(Ecto.UUID.t(), Ecto.UUID.t(), DateTime.t()) :: Ecto.Schema.t() | nil
  def active_for(account_id, user_id, now \\ DateTime.utc_now()) do
    Repo.one(
      from(c in CheckoutSession,
        where:
          c.account_id == ^account_id and c.reserved_by_user_id == ^user_id and
            c.status == :draft and c.lease_expires_at > ^now
      )
    )
  end

  def expire_account(account_id, now \\ DateTime.utc_now()) do
    result =
      Repo.transaction(fn ->
        lock_account!(account_id)
        expire_locked(account_id, now)
      end)

    case result do
      {:ok, sessions} ->
        Enum.each(sessions, &notify(account_id, "cart_expired", %{session_id: &1}))
        {:ok, length(sessions)}

      error ->
        error
    end
  end

  def expire_due do
    now = DateTime.utc_now()

    Repo.all(
      from(c in CheckoutSession,
        where:
          c.status == :draft and not is_nil(c.reserved_by_user_id) and c.lease_expires_at <= ^now,
        distinct: true,
        select: c.account_id
      )
    )
    |> Enum.each(&expire_account(&1, now))
  end

  def notify(account_id, event, payload) do
    if not MealPlannerApiWeb.ChannelCapability.enforcement_enabled?() or
         MealPlannerApi.AccountAccess.eligible?(account_id) do
      Server.broadcast!(
        MealPlannerApi.PubSub,
        "shopping:#{account_id}",
        event,
        payload
      )
    end

    :ok
  end

  defp identity(user) do
    with {:ok, ids} <- Identity.ensure_persistent_identity(user),
         :ok <- PlanningRequestValidator.validate_actor(ids.account_id, ids.user_id) do
      if MealPlannerApiWeb.ChannelCapability.enforcement_enabled?() and
           not MealPlannerApi.AccountAccess.eligible?(ids.account_id),
         do: {:error, :subscription_required},
         else: {:ok, ids}
    end
  end

  defp transact(ids, event, fun) do
    # Expiry commits independently: a rejected stale command must not resurrect a lease.
    with {:ok, _} <- expire_account(ids.account_id) do
      result =
        Repo.transaction(fn ->
          lock_account!(ids.account_id)
          recheck_identity!(ids)
          fun.(DateTime.utc_now())
        end)

      notify_committed(ids.account_id, event, result)

      result
    end
  rescue
    Ecto.Query.CastError -> {:error, :invalid_payload}
  end

  # `purchase/3` passes no event: it announces its own outcome.
  defp notify_committed(_account_id, nil, _result), do: :ok

  defp notify_committed(account_id, event, {:ok, response}),
    do: notify(account_id, event, response)

  defp notify_committed(_account_id, _event, _result), do: :ok

  defp notify_purchase(account_id, result) do
    notify(account_id, "purchase_confirmed", result)

    if result.moved_to_inventory_count > 0,
      do: notify(account_id, "inventory_changed", %{refresh: true})
  end

  # Runs inside the transaction, under the account lock.
  defp recheck_identity!(ids) do
    case identity(%{id: ids.user_id, account_id: ids.account_id}) do
      {:ok, _} -> :ok
      {:error, reason} -> Repo.rollback(reason)
    end
  end

  defp lock_account!(account_id) do
    Repo.query!("SELECT pg_advisory_xact_lock(hashtext($1))", ["cart:#{account_id}"])
  end

  defp active_cart(ids, now) do
    cart =
      Repo.one(
        from(c in CheckoutSession,
          where:
            c.account_id == ^ids.account_id and
              c.reserved_by_user_id == ^ids.user_id and c.status == :draft,
          lock: "FOR UPDATE"
        )
      ) ||
        insert!(
          CheckoutSession.changeset(%CheckoutSession{}, %{
            account_id: ids.account_id,
            reserved_by_user_id: ids.user_id,
            status: :draft,
            checkout_type: :physical,
            lease_expires_at: DateTime.add(now, @lease_seconds, :second)
          })
        )

    require_active!(cart, now)
    cart
  end

  defp get_owned!(ids, session_id) do
    require!(valid_id?(session_id), :invalid_payload)

    cart =
      Repo.one(
        from(c in CheckoutSession,
          where:
            c.account_id == ^ids.account_id and
              c.id == ^session_id and c.reserved_by_user_id == ^ids.user_id,
          lock: "FOR UPDATE"
        )
      )

    require!(not is_nil(cart), :cart_not_found)
    cart
  end

  defp owned_cart!(ids, session_id, now) do
    cart = get_owned!(ids, session_id)
    require_active!(cart, now)
    cart
  end

  defp require_active!(cart, now) do
    require!(
      cart.status == :draft and not is_nil(cart.lease_expires_at) and
        DateTime.compare(cart.lease_expires_at, now) == :gt,
      :stale_cart
    )
  end

  defp renew!(cart, now),
    do: update!(cart, %{lease_expires_at: DateTime.add(now, @lease_seconds, :second)})

  defp expire_locked(account_id, now) do
    Repo.all(
      from(c in CheckoutSession,
        where:
          c.account_id == ^account_id and c.status == :draft and
            not is_nil(c.reserved_by_user_id) and c.lease_expires_at <= ^now,
        lock: "FOR UPDATE"
      )
    )
    |> Enum.map(fn cart ->
      release_cart!(cart, now)
      cart.id
    end)
  end

  defp release_cart!(cart, now) do
    items = cart_items(cart)
    Enum.each(items, &release!/1)
    update!(cart, %{status: :abandoned, invalidated_at: now})
    length(items)
  end

  defp release!(item),
    do: update!(item, %{status: :pending, checkout_session_id: nil, reservation_token: nil})

  defp cart_items(cart) do
    Repo.all(
      from(i in ShoppingItem,
        where:
          i.account_id == ^cart.account_id and
            i.checkout_session_id == ^cart.id and i.status == :in_cart,
        order_by: i.id,
        lock: "FOR UPDATE"
      )
    )
  end

  defp lock_items(account_id, item_ids) do
    Repo.all(
      from(i in ShoppingItem,
        where: i.account_id == ^account_id and i.id in ^item_ids,
        order_by: i.id,
        lock: "FOR UPDATE"
      )
    )
  end

  defp validate_lines!(ids, cart, lines) do
    require!(Enum.all?(lines, &is_map/1), :invalid_payload)
    item_ids = Enum.map(lines, & &1["item_id"])
    require!(Enum.all?(item_ids, &valid_id?/1), :invalid_payload)
    require!(length(item_ids) == length(Enum.uniq(item_ids)), :duplicate_item)
    items = lock_items(ids.account_id, item_ids)
    require!(length(items) == length(lines), :item_not_found)

    Enum.map(items, fn item ->
      line = Enum.find(lines, &(&1["item_id"] == item.id))

      require!(
        item.status == :in_cart and item.checkout_session_id == cart.id and
          not is_nil(item.reservation_token) and
          item.reservation_token == line["reservation_token"],
        :stale_reservation
      )

      {item, line}
    end)
  end

  defp reservation(item),
    do: %{
      item_id: item.id,
      reservation_token: item.reservation_token,
      quantity_milli: item.quantity_milli
    }

  defp require!(true, _), do: :ok
  defp require!(_, reason), do: Repo.rollback(reason)

  defp valid_id?(id), do: match?({:ok, _}, Ecto.UUID.cast(id))

  defp update!(%CheckoutSession{} = item, attrs),
    do: item |> CheckoutSession.changeset(attrs) |> persist!(:update)

  defp update!(%ShoppingItem{} = item, attrs),
    do: item |> ShoppingItem.changeset(attrs) |> persist!(:update)

  defp insert!(changeset), do: persist!(changeset, :insert)

  defp persist!(changeset, operation) do
    case apply(Repo, operation, [changeset]) do
      {:ok, row} -> row
      {:error, reason} -> Repo.rollback(reason)
    end
  end
end
