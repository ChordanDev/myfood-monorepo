defmodule MealPlannerApi.Services.ShoppingService do
  @moduledoc """
  Shopping list orchestration.

  Builds, manages, and resolves shopping lists with supermarket assignments
  and price estimates.
  """

  import Ecto.Query, warn: false
  require Logger
  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Cart
  alias MealPlannerApi.Data.RecipeRepo
  alias MealPlannerApi.Data.ShoppingRepo
  alias MealPlannerApi.Persistence.Calendar, as: CalendarPersistence
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.InventoryService
  alias MealPlannerApi.Services.ShoppingRebuilder

  # -------------------------------------------------------------------------
  # Shopping list
  # -------------------------------------------------------------------------

  @list_groupings %{"ingredient" => :ingredient, "meal" => :meal}

  @doc """
  The Shopping list of the caller's Account (issue #39).

  ## Parameters

    * `user` — the caller, scoped to the Account being read.
    * `params` — snake_case request params. Two are read, both optional:
      `"until_date"` (`YYYY-MM-DD`) keeps the lines of Scheduled meals on
      or before that day, and `"group_by"` (`"ingredient"`, the default,
      or `"meal"`) picks one line per ingredient or one per meal.
    * `now` — the instant of the read. "Today" is the Account's today at
      that instant (`MealPlannerApi.AccountClock.today/2`), never a date
      sent by the client.

  ## Returns

  `{:ok, payload}` with:

    * `planned` — the lines `ShoppingRebuilder.group_lines/2` builds from
      the Shopping items planned from today on, with `status` `"needed"`,
      `"in_cart"`, `"removed"` or `"purchased"` and `source`
      `"planned_meal"`. Each allocation carries the `status` of its own
      Shopping item. A purchased item stays listed until its Scheduled meal
      is cooked or falls outside the range of the read; it is never to buy
      again, so only the allocations that read `"needed"` can go into a
      Cart, and the quantity of a line that was bought in part is its
      remainder.
    * `manual` — the Shopping items the User added by hand that are still
      on the list, oldest first, one line each in the shape of a `planned`
      line (`source` `"manual"`, no allocations). They are never merged with
      each other or with a planned line, and no date limit applies to them.
    * `cart` — `%{session_id, lease_expires_at, items_count}` for the
      caller's own active Cart, otherwise `nil`. `items_count` is how many
      Shopping items that Cart holds, also the ones `until_date` leaves out
      of `planned`. A line held in another member's Cart still reads
      `"in_cart"`.
    * `totals` — `needed`, `in_cart` and `removed` count the planned
      lines by status; `estimated_cents` adds the estimated price of the
      needed items. Purchased lines and quantities are in none of them:
      the totals are what is still to buy.
    * `planned_dates` — the sorted dates with an uncooked Scheduled meal
      from today on, whatever `until_date` is.

  `{:error, {:validation_error, :until_date}}` for an `until_date` that
  is malformed or before the Account's today, and
  `{:error, {:validation_error, :group_by}}` for an unknown `group_by`.
  The list is not built in either case: no Cart is expired and no item
  is archived or created.
  """
  @spec get_shopping_list(map(), map(), DateTime.t()) :: {:ok, map()} | {:error, term()}
  def get_shopping_list(user, params \\ %{}, now \\ DateTime.utc_now()) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         today = AccountClock.today(identity.account_id, now),
         {:ok, until_date} <- parse_until_date(Map.get(params, "until_date"), today),
         {:ok, group_by} <- parse_group_by(Map.get(params, "group_by")) do
      {:ok, build_shopping_list(identity, today, until_date, group_by, now)}
    end
  end

  defp build_shopping_list(identity, today, until_date, group_by, now) do
    account_id = identity.account_id
    {:ok, _} = Cart.expire_account(account_id, now)

    # Auto-archive past items (runs on every read that passes validation)
    prune_past_items(account_id, today)

    upcoming_meals = upcoming_uncooked_meals(account_id, today)

    # Build items from scheduled meals (if not already created)
    _ =
      ensure_shopping_items_from_schedule(
        account_id,
        ShoppingRebuilder.limit_to_date(upcoming_meals, until_date)
      )

    # What is still on the list, and what was bought for a meal that is yet
    # to be cooked.
    items =
      (Shopping.list_open_items_with_context(account_id, today, until_date) ++
         Shopping.list_purchased_items_with_context(account_id, today, until_date))
      |> Enum.sort_by(&list_position/1)

    rows = Enum.map(items, &planned_row/1)
    planned = ShoppingRebuilder.group_lines(rows, group_by)
    statuses = Map.new(rows, &{&1.item_id, &1.status})

    %{
      planned: Enum.map(planned, &serialize_line(&1, statuses)),
      manual: account_id |> Shopping.list_open_manual_items() |> Enum.map(&manual_line/1),
      cart: serialize_cart(Cart.active_for(account_id, identity.user_id, now)),
      totals: %{
        needed: Enum.count(planned, &(&1.status == :needed)),
        in_cart: Enum.count(planned, &(&1.status == :in_cart)),
        removed: Enum.count(planned, &(&1.status == :removed)),
        estimated_cents:
          items
          |> Enum.filter(&(&1.status == :pending))
          |> Enum.reduce(0, &((&1.estimated_price_cents || 0) + &2))
      },
      planned_dates: upcoming_meals |> Enum.map(& &1.date) |> Enum.uniq() |> Enum.sort(Date)
    }
  end

  defp parse_until_date(nil, _today), do: {:ok, nil}

  defp parse_until_date(value, today) when is_binary(value) do
    with {:ok, date} <- Date.from_iso8601(value),
         true <- Date.compare(date, today) != :lt do
      {:ok, date}
    else
      _malformed_or_past -> {:error, {:validation_error, :until_date}}
    end
  end

  defp parse_until_date(_value, _today), do: {:error, {:validation_error, :until_date}}

  defp parse_group_by(nil), do: {:ok, :ingredient}

  defp parse_group_by(value) do
    case Map.fetch(@list_groupings, value) do
      {:ok, group_by} -> {:ok, group_by}
      :error -> {:error, {:validation_error, :group_by}}
    end
  end

  # Rows reach the rebuilder by date, then by slot in the order of the day,
  # then by item id so two reads list them the same way.
  defp list_position(item) do
    {Date.to_erl(item.planned_date), ShoppingRebuilder.slot_rank(item.scheduled_meal.slot),
     item.id}
  end

  # The row `ShoppingRebuilder.group_lines/2` takes for one Shopping item.
  defp planned_row(item) do
    %{
      item_id: item.id,
      ingredient_id: item.ingredient_id,
      name: item.ingredient.name,
      category: item.ingredient.category,
      unit: item.unit,
      quantity_milli: item.quantity_milli,
      status: list_status(item.status),
      source: :planned_meal,
      supermarket_id: item.assigned_supermarket_id,
      scheduled_meal_id: item.scheduled_meal_id,
      date: item.planned_date,
      slot: item.scheduled_meal.slot
    }
  end

  defp list_status(:pending), do: :needed
  defp list_status(:in_cart), do: :in_cart
  defp list_status(:removed), do: :removed
  # Bought: stocked already, or on its way with an online purchase.
  defp list_status(:checked_out), do: :purchased
  defp list_status(:pending_delivery), do: :purchased

  # The line of a manual item: the shape of a planned line, for no meal. The
  # Ingredient is optional; without one the category is `otros`.
  defp manual_line(item) do
    %{
      id: item.id,
      ingredient_id: item.ingredient_id,
      name: item.name,
      category: Atom.to_string(if(item.ingredient, do: item.ingredient.category, else: :otros)),
      quantity_milli: item.quantity_milli,
      unit: Atom.to_string(item.unit),
      status: Atom.to_string(list_status(item.status)),
      source: Atom.to_string(item.source),
      supermarket_id: item.assigned_supermarket_id,
      allocations: []
    }
  end

  # Enum values leave as strings, like the rest of this service. Dates stay
  # `Date` structs, which the JSON encoder writes as ISO 8601. Each allocation
  # leaves with the status of its own Shopping item, from `statuses`: a line
  # can mix what was bought with what is still to buy.
  defp serialize_line(line, statuses) do
    %{
      line
      | category: Atom.to_string(line.category),
        unit: Atom.to_string(line.unit),
        status: Atom.to_string(line.status),
        source: Atom.to_string(line.source),
        allocations:
          Enum.map(line.allocations, fn allocation ->
            %{allocation | slot: Atom.to_string(allocation.slot)}
            |> Map.put(:status, Atom.to_string(Map.fetch!(statuses, allocation.item_id)))
          end)
    }
  end

  defp serialize_cart(nil), do: nil

  defp serialize_cart(%Shopping.CheckoutSession{} = cart) do
    %{
      session_id: cart.id,
      lease_expires_at: cart.lease_expires_at,
      items_count: Cart.items_count(cart)
    }
  end

  # Prune/archive past-dated items (planned_date before the Account's today)
  # Runs on every get_shopping_list call that passes validation, as one
  # statement. Nothing in it depends on a single row, so a failure is a
  # database failure and is left to fail the read.
  defp prune_past_items(account_id, today) do
    from(i in MealPlannerApi.Persistence.Shopping.ShoppingItem,
      where: i.account_id == ^account_id,
      where: i.planned_date < ^today,
      where: i.status == :pending
    )
    |> Repo.update_all(set: [status: :archived, updated_at: DateTime.utc_now()])
  end

  # Every uncooked Scheduled meal of the Account from `today` on, in the
  # order the shortages are computed: by date, then by id.
  defp upcoming_uncooked_meals(account_id, today) do
    from(m in MealPlannerApi.Persistence.Planning.ScheduledMeal,
      where: m.account_id == ^account_id,
      where: m.date >= ^today,
      where: m.is_cooked == false,
      order_by: [asc: m.date, asc: m.id]
    )
    |> Repo.all()
  end

  # Ensure shopping items exist for the given scheduled meals.
  #
  # Runs on every Shopping list read that passes validation, from any number
  # of requests at once: the Shortage lines that have no Shopping item yet
  # are stored in one statement that skips the planned keys another request
  # stored first.
  #
  # A failure here must not fail the read: it is logged and the read answers
  # with the Shopping items already stored.
  defp ensure_shopping_items_from_schedule(account_id, scheduled_meals) do
    scheduled_meals = Repo.preload(scheduled_meals, recipe: :recipe_ingredients)

    pool =
      InventoryService.list_for_account(account_id)
      |> Enum.reduce(%{}, fn item, pool ->
        Map.update(
          pool,
          {item.ingredient_id, item.unit},
          item.quantity_milli,
          &(&1 + item.quantity_milli)
        )
      end)

    lines = ShoppingRebuilder.compute_net_shortages(scheduled_meals, pool)

    # A Shopping item in any status answers for its planned key: what was
    # bought or archived is not derived again.
    existing = Shopping.planned_item_keys(account_id, Enum.map(scheduled_meals, & &1.id))

    missing =
      Enum.reject(lines, fn line ->
        MapSet.member?(
          existing,
          {line.scheduled_meal_id, line.planned_date, line.ingredient_id, line.unit}
        )
      end)

    Shopping.insert_planned_items(account_id, missing)
  rescue
    exception ->
      Logger.error(
        "shopping item derivation failed account_id=#{account_id} " <>
          "exception=#{inspect(exception.__struct__)} message=#{Exception.message(exception)}"
      )

      :ok
  end

  # -------------------------------------------------------------------------
  # Manual items (issue #40)
  # -------------------------------------------------------------------------

  @manual_units %{"g" => :g, "ml" => :ml, "unit" => :unit}
  @default_manual_quantity_milli 1_000

  @doc """
  Adds a Shopping item by hand to the caller's Account.

  ## Parameters

    * `params` — snake_case request params: `"name"` (required, a string
      that is not blank once trimmed, at most 200 characters),
      `"ingredient_id"` (optional, an Ingredient of the catalogue),
      `"quantity_milli"` (optional integer above zero, `1000` when omitted)
      and `"unit"` (optional, `"g"`, `"ml"` or `"unit"`, `"unit"` when
      omitted). So the default is 1 unit.

  ## Returns

  `{:ok, line}` with the line of the new item, the shape of a `manual`
  entry of `get_shopping_list/3`, or `{:error, :validation_error}`.
  """
  @spec create_manual_item(map(), map()) :: {:ok, map()} | {:error, term()}
  def create_manual_item(user, params) when is_map(params) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, attrs} <- manual_attrs(params),
         {:ok, item} <-
           Shopping.create_manual_item(Map.put(attrs, :account_id, identity.account_id)) do
      {:ok, item |> Repo.preload(:ingredient) |> manual_line()}
    else
      {:error, %Ecto.Changeset{}} -> {:error, :validation_error}
      {:error, reason} -> {:error, reason}
    end
  end

  defp manual_attrs(params) do
    with {:ok, name} <- manual_name(Map.get(params, "name")),
         {:ok, ingredient_id} <- manual_ingredient_id(Map.get(params, "ingredient_id")),
         {:ok, quantity_milli} <- manual_quantity(Map.get(params, "quantity_milli")),
         {:ok, unit} <- manual_unit(Map.get(params, "unit")) do
      {:ok,
       %{name: name, ingredient_id: ingredient_id, quantity_milli: quantity_milli, unit: unit}}
    end
  end

  defp manual_name(name) when is_binary(name), do: {:ok, name}
  defp manual_name(_name), do: {:error, :validation_error}

  defp manual_ingredient_id(nil), do: {:ok, nil}

  defp manual_ingredient_id(id) do
    with {:ok, uuid} <- Ecto.UUID.cast(id),
         %{} <- Repo.get(MealPlannerApi.Persistence.Catalog.Ingredient, uuid) do
      {:ok, uuid}
    else
      _unknown_or_malformed -> {:error, :validation_error}
    end
  end

  defp manual_quantity(nil), do: {:ok, @default_manual_quantity_milli}
  defp manual_quantity(quantity) when is_integer(quantity) and quantity > 0, do: {:ok, quantity}
  defp manual_quantity(_quantity), do: {:error, :validation_error}

  defp manual_unit(nil), do: {:ok, :unit}

  defp manual_unit(unit) do
    case Map.fetch(@manual_units, unit) do
      {:ok, unit} -> {:ok, unit}
      :error -> {:error, :validation_error}
    end
  end

  @doc """
  Deletes a manual Shopping item of the caller's Account that is still on
  the list (`pending` or `in_cart`).

  `{:ok, %{id: id}}`, `{:error, :shopping_item_not_manual}` for a planned
  item (which is removed with `set_item_status/3`, never deleted) and
  `{:error, :shopping_item_not_found}` for an id that is unknown, of another
  Account, malformed, or of an item already bought or archived.
  """
  @spec delete_manual_item(map(), term()) :: {:ok, map()} | {:error, term()}
  def delete_manual_item(user, item_id) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         %Shopping.ShoppingItem{} = item <-
           Shopping.get_item_for_account(identity.account_id, item_id) || :not_found,
         :ok <- deletable(item),
         {:ok, _deleted} <- Repo.delete(item) do
      {:ok, %{id: item.id}}
    else
      :not_found -> {:error, :shopping_item_not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  defp deletable(%{source: :planned_meal}), do: {:error, :shopping_item_not_manual}
  defp deletable(%{status: status}) when status in [:pending, :in_cart], do: :ok
  defp deletable(_closed), do: {:error, :shopping_item_not_found}

  # -------------------------------------------------------------------------
  # Removed and restored planned items (issue #40)
  # -------------------------------------------------------------------------

  @item_statuses %{"removed" => :removed, "needed" => :pending}

  @doc """
  Removes planned Shopping items from the list, or restores them.

  A removed item is one the User will not buy: its line stops counting
  toward the quantity to buy, the estimate and the Cart, and the list
  still returns it with status `removed` so it can be restored. A rebuild
  of the plan keeps it removed while the meal still needs the Ingredient.

  ## Parameters

    * `params` — snake_case request params: `"status"` (`"removed"` or
      `"needed"`) and the items, `"item_ids"` (a list of ids without
      repeats) or a single `"item_id"`.

  ## Returns

  `{:ok, %{status, item_ids, updated_rows}}`. Setting the status an item
  already has changes nothing and succeeds. All items are checked before
  any is changed; one failure changes none.

    * `{:error, :validation_error}` — a missing or unknown `status`, or
      no items, a repeated item or an id that is not a string.
    * `{:error, :shopping_item_not_found}` — an id that is unknown, of
      another Account, malformed, or of an item already bought or closed.
    * `{:error, :shopping_item_not_planned}` — a manual item. It is
      deleted, not removed.
    * `{:error, :shopping_item_in_cart}` — removing an item that is in a
      Cart. Take it out of the Cart first.
  """
  @spec set_item_status(map(), map()) :: {:ok, map()} | {:error, term()}
  def set_item_status(user, params) when is_map(params) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, status} <- item_status(Map.get(params, "status")),
         {:ok, item_ids} <- item_ids(params) do
      Repo.transaction(fn -> change_item_status(identity.account_id, item_ids, status) end)
    end
  end

  defp item_status(value) do
    case is_binary(value) && Map.fetch(@item_statuses, value) do
      {:ok, status} -> {:ok, status}
      _unknown -> {:error, :validation_error}
    end
  end

  defp item_ids(%{"item_ids" => ids}) when is_list(ids) and ids != [] do
    if Enum.all?(ids, &is_binary/1) and length(Enum.uniq(ids)) == length(ids),
      do: {:ok, ids},
      else: {:error, :validation_error}
  end

  defp item_ids(%{"item_id" => id}) when is_binary(id), do: {:ok, [id]}
  defp item_ids(_params), do: {:error, :validation_error}

  # Locks the items the way the Cart does, so a reservation cannot slip in
  # between the check and the write. The transaction rolls back on the first
  # failure, so a request changes every item or none.
  defp change_item_status(account_id, item_ids, status) do
    with {:ok, uuids} <- cast_item_ids(item_ids),
         items = Shopping.lock_items_for_account(account_id, uuids),
         true <- length(items) == length(uuids) || {:error, :shopping_item_not_found},
         :ok <- check_status_change(items, status) do
      to_change = Enum.reject(items, &(&1.status == status))
      Shopping.set_items_status(Enum.map(to_change, & &1.id), status)

      %{
        status: Atom.to_string(list_status(status)),
        item_ids: Enum.map(items, & &1.id),
        updated_rows: length(to_change)
      }
    else
      {:error, reason} -> Repo.rollback(reason)
    end
  end

  defp cast_item_ids(item_ids) do
    casts = Enum.map(item_ids, &Ecto.UUID.cast/1)

    if Enum.all?(casts, &match?({:ok, _}, &1)),
      do: {:ok, Enum.map(casts, fn {:ok, uuid} -> uuid end)},
      else: {:error, :shopping_item_not_found}
  end

  defp check_status_change(items, status) do
    Enum.find_value(items, :ok, fn item ->
      cond do
        item.source == :manual -> {:error, :shopping_item_not_planned}
        item.status == :in_cart and status == :removed -> {:error, :shopping_item_in_cart}
        item.status in [:pending, :removed, :in_cart] -> nil
        true -> {:error, :shopping_item_not_found}
      end
    end)
  end

  # -------------------------------------------------------------------------
  # Re-planning (issue #40)
  # -------------------------------------------------------------------------

  @doc """
  Replaces the Scheduled meals of `[from_date, to_date]`
  (`Persistence.Calendar.replace_scheduled_meals_for_range/3`) and carries
  the Shopping list across the replacement.

  The meals come back with new ids, which deletes their planned Shopping
  items. What the User decided about them survives:

    * manual items are for no meal, so the replacement never touches them;
    * a planned item the User removed is removed again once the new meals
      have their items, as long as a meal on the same date and slot still
      needs the same Ingredient and unit. The quantity is the Shortage of
      the new plan. A removal no meal needs any more is dropped.

  The removed items are read before the replacement and restored after the
  items of the new meals are derived, the way a Shopping list read derives
  them (so the Shortage subtracts the Inventory from every upcoming meal,
  not only these). With nothing removed this is the plain replacement and
  the items are derived by the next read.

  Returns what the replacement returns.
  """
  @spec replace_scheduled_meals_for_range(
          Ecto.UUID.t(),
          {Date.t(), Date.t()},
          [map()],
          DateTime.t()
        ) :: {:ok, %{replaced: non_neg_integer()}} | {:error, atom()}
  def replace_scheduled_meals_for_range(
        account_id,
        {from_date, to_date} = range,
        meals,
        now \\ DateTime.utc_now()
      ) do
    removed =
      if valid_range?(from_date, to_date),
        do: Shopping.removed_item_keys(account_id, from_date, to_date),
        else: MapSet.new()

    with {:ok, _result} = replaced <-
           CalendarPersistence.replace_scheduled_meals_for_range(account_id, range, meals) do
      carry_removed_items(account_id, removed, range, now)
      replaced
    end
  end

  defp valid_range?(%Date{} = from_date, %Date{} = to_date),
    do: Date.compare(from_date, to_date) != :gt

  defp valid_range?(_from_date, _to_date), do: false

  defp carry_removed_items(account_id, removed, {from_date, to_date}, now) do
    if MapSet.size(removed) > 0 do
      today = AccountClock.today(account_id, now)

      _ =
        ensure_shopping_items_from_schedule(
          account_id,
          upcoming_uncooked_meals(account_id, today)
        )

      Shopping.restore_removed_items(account_id, removed, from_date, to_date)
    end

    :ok
  end

  @spec build_shopping_list_from_schedule(map(), map()) :: {:ok, map()} | {:error, term()}
  def build_shopping_list_from_schedule(user, params \\ %{}) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        account_id = identity.account_id
        from_date = parse_date(Map.get(params, "from_date"), Date.utc_today())
        _end_date = parse_date(Map.get(params, "to_date"), Date.add(from_date, 6))
        recipe_ids = Map.get(params, "recipe_ids", [])

        {:ok, session} =
          ShoppingRepo.create_checkout_session(%{
            account_id: account_id,
            status: :draft,
            started_at: DateTime.utc_now()
          })

        persisted = build_items_from_recipes(account_id, recipe_ids, session.id)

        {:ok,
         %{
           checkout_session_id: session.id,
           items_generated: length(persisted),
           items: Enum.map(persisted, &serialize_shopping_item/1)
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec mark_in_cart(map(), [Ecto.UUID.t()]) :: {:ok, map()} | {:error, term()}
  def mark_in_cart(user, item_ids) do
    MealPlannerApi.Cart.reserve(user, item_ids)
  end

  @spec mark_ingredient_in_cart(map(), binary(), Date.t(), Date.t()) ::
          {:ok, map()} | {:error, term()}
  def mark_ingredient_in_cart(user, ingredient_id, from_date, end_date) do
    MealPlannerApi.Cart.reserve_ingredient(user, ingredient_id, from_date, end_date)
  end

  @spec assign_supermarket(map(), Ecto.UUID.t(), Ecto.UUID.t()) :: {:ok, map()} | {:error, term()}
  def assign_supermarket(user, item_id, supermarket_id) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        case Shopping.list_items_by_ids(identity.account_id, [item_id]) do
          [item] ->
            update_item_supermarket(item, supermarket_id)

          [] ->
            {:error, :item_not_found}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp update_item_supermarket(item, supermarket_id) do
    case Shopping.update_shopping_item(item, %{assigned_supermarket_id: supermarket_id}) do
      {:ok, final_item} -> {:ok, serialize_shopping_item(final_item)}
      {:error, reason} -> {:error, reason}
    end
  end

  @spec assign_ingredient_supermarket(map(), binary(), Ecto.UUID.t(), Date.t(), Date.t()) ::
          {:ok, map()} | {:error, term()}
  def assign_ingredient_supermarket(user, ingredient_id, supermarket_id, from_date, end_date) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        # Update items for this ingredient within the date range
        items_to_update =
          from(i in MealPlannerApi.Persistence.Shopping.ShoppingItem,
            where: i.account_id == ^identity.account_id,
            where: i.ingredient_id == ^ingredient_id,
            where: i.planned_date >= ^from_date,
            where: i.planned_date <= ^end_date
          )
          |> Repo.all()

        # Update each item and collect the updated ones
        updated_items =
          Enum.map(items_to_update, &try_assign_supermarket(&1, supermarket_id))
          |> Enum.reject(&is_nil/1)

        serialized =
          if updated_items == [] do
            %{}
          else
            first = hd(updated_items)

            %{
              id: first.id,
              ingredient_id: first.ingredient_id,
              assigned_supermarket_id: supermarket_id
            }
          end

        updated_count = length(updated_items)
        {:ok, Map.merge(serialized, %{updated_rows: updated_count})}

      {:error, reason} ->
        {:error, reason}
    end
  rescue
    _ -> {:ok, %{assigned_supermarket_id: supermarket_id, updated_rows: 0}}
  end

  defp try_assign_supermarket(item, supermarket_id) do
    case Shopping.update_shopping_item(item, %{assigned_supermarket_id: supermarket_id}) do
      {:ok, updated_item} -> updated_item
      {:error, _} -> nil
    end
  end

  # -------------------------------------------------------------------------
  # Checkout sessions
  # -------------------------------------------------------------------------

  @spec start_checkout_session(map()) :: {:ok, map()} | {:error, term()}
  def start_checkout_session(user) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        {:ok, session} =
          ShoppingRepo.create_checkout_session(%{
            account_id: identity.account_id,
            status: :draft,
            started_at: DateTime.utc_now()
          })

        {:ok, %{session_id: session.id, status: Atom.to_string(session.status)}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec confirm_checkout(map(), Ecto.UUID.t(), map()) :: {:ok, map()} | {:error, term()}
  def confirm_checkout(user, session_id, payload) do
    MealPlannerApi.Cart.purchase(user, session_id, payload)
  end

  # Date-range based checkout: create session from items in range
  @spec create_checkout_from_range(map(), Date.t(), Date.t(), String.t()) ::
          {:error, :reservation_required}
  def create_checkout_from_range(_user, _start_date, _end_date, _checkout_type),
    do: {:error, :reservation_required}

  @spec confirm_delivery(map(), Ecto.UUID.t()) :: {:ok, map()} | {:error, term()}
  def confirm_delivery(user, checkout_session_id) do
    MealPlannerApi.Cart.delivery(user, checkout_session_id)
  end

  # -------------------------------------------------------------------------
  # Supermarkets
  # -------------------------------------------------------------------------

  @spec list_supermarkets(map()) :: {:ok, [map()]} | {:error, term()}
  def list_supermarkets(user) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, _identity} ->
        supermarkets = ShoppingRepo.list_supermarkets()
        {:ok, Enum.map(supermarkets, &serialize_supermarket/1)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # -------------------------------------------------------------------------
  # Helpers
  # -------------------------------------------------------------------------

  defp build_items_from_recipes(_account_id, [], _session_id), do: []

  defp build_items_from_recipes(_account_id, recipe_ids, session_id) when is_list(recipe_ids) do
    recipes =
      recipe_ids
      |> Enum.map(&RecipeRepo.get_recipe!/1)
      |> Enum.reject(&is_nil/1)
      |> Enum.map(&Repo.preload(&1, :recipe_ingredients))

    Enum.flat_map(recipes, fn recipe ->
      Enum.map(recipe.recipe_ingredients || [], fn ri ->
        ShoppingRepo.create_shopping_item(%{
          checkout_session_id: session_id,
          ingredient_id: ri.ingredient_id,
          quantity_milli: ri.quantity_milli,
          unit: ri.unit,
          is_checked: false,
          is_in_cart: false
        })
      end)
    end)
    |> Enum.filter(fn
      {:ok, _} -> true
      _ -> false
    end)
    |> Enum.map(fn {:ok, item} -> item end)
  end

  defp parse_date(nil, default), do: default

  defp parse_date(d, _default) when is_binary(d) do
    case Date.from_iso8601(d) do
      {:ok, date} -> date
      {:error, _} -> nil
    end
  end

  defp parse_date(d, _default), do: d

  defp serialize_shopping_item(i) do
    # Handle Ecto.Association.NotLoaded case
    ingredient_map = loaded_association(i.ingredient)
    supermarket_map = loaded_association(i.assigned_supermarket)

    %{
      id: i.id,
      ingredient_id: i.ingredient_id,
      ingredient_name: ingredient_map && ingredient_map.name,
      category: ingredient_category(ingredient_map),
      quantity_milli: i.quantity_milli,
      unit: Atom.to_string(i.unit),
      status: Atom.to_string(i.status),
      checkout_session_id: i.checkout_session_id,
      reservation_token: i.reservation_token,
      reserved_by_user_id: reservation_field(i, :reserved_by_user_id),
      lease_expires_at: reservation_field(i, :lease_expires_at),
      estimated_price_cents: i.estimated_price_cents,
      supermarket_id: i.assigned_supermarket_id,
      supermarket_name: supermarket_map && supermarket_map.name,
      price_options: price_options(i)
    }
  end

  defp loaded_association(association) do
    cond do
      is_nil(association) ->
        nil

      Map.has_key?(association, :__struct__) and
          String.contains?(inspect(association.__struct__), "NotLoaded") ->
        nil

      true ->
        association
    end
  end

  defp ingredient_category(ingredient_map) do
    case ingredient_map do
      %{category: cat} when cat != nil -> Atom.to_string(cat)
      _ -> nil
    end
  end

  # Look up price options from supermarket catalog
  defp price_options(i) do
    if i.ingredient_id do
      ShoppingRepo.list_prices_for_ingredient(i.ingredient_id)
      |> Enum.map(fn p ->
        %{supermarket_id: p.supermarket_id, price_cents: p.price_cents_ars}
      end)
    else
      []
    end
  end

  defp reservation_field(
         %{status: :in_cart, checkout_session: %Shopping.CheckoutSession{} = cart},
         field
       ) do
    Map.get(cart, field)
  end

  defp reservation_field(_, _), do: nil

  defp serialize_supermarket(m) do
    %{
      id: m.id,
      name: m.name,
      address: m.address,
      is_preferred: m.is_preferred
    }
  end
end
