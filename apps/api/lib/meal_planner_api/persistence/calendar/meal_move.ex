defmodule MealPlannerApi.Persistence.Calendar.MealMove do
  @moduledoc """
  Moves a Scheduled meal to another date and slot without recreating it.

  The meal keeps its id, so its Cooking sessions and prepared leftovers follow
  it untouched. A meal already at the destination takes the position the moved
  one leaves. What is stored by position or by date is moved with the meals:
  the Slot favorites of both positions and the planned Shopping items of every
  meal whose date changes.
  """

  import Ecto.Query

  require Logger

  alias MealPlannerApi.Persistence.Catalog.SlotFavorite
  alias MealPlannerApi.Persistence.Planning.{CookingSession, ScheduledMeal}
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo

  # `(account_id, date, slot)` is a plain unique index on `scheduled_meals`
  # and, with `user_id`, on `slot_favorites`. PostgreSQL checks it row by row,
  # so two rows cannot exchange keys in one statement: one side waits on this
  # date first. No row keeps it, it never leaves the transaction, and no
  # request can put a row on it: every date the API parses has a four-digit
  # year (`Date.from_iso8601/1` takes no other), so no stored meal or favorite
  # can sit on a date of year 10000. PostgreSQL stores such a date; the `~D`
  # sigil cannot write it.
  @parking_date Date.new!(10_000, 1, 1)

  # What a concurrent write can make a statement of the move fail with.
  @conflict_codes [:unique_violation, :serialization_failure, :deadlock_detected]

  # Constraints that only stored rows violate. Every insert of a planned
  # Shopping item takes a key share lock on its meal, which the move holds
  # `FOR UPDATE`, so no item joins the meal while it moves. A violation is two
  # open items of the meal that only differ in their planned date and take one
  # key on the new date: a retry fails the same way.
  @stored_state_constraints ["shopping_items_open_planned_key_index"]

  @type result :: %{moved: ScheduledMeal.t(), displaced: ScheduledMeal.t() | nil}
  @type reason ::
          :meal_not_found
          | :meal_cooked
          | :target_meal_cooked
          | :meal_already_confirmed
          | :target_meal_already_confirmed
          | :meal_cooking_in_progress
          | :target_meal_cooking_in_progress
          | :same_slot
          | :conflict
          | :move_not_possible

  @doc """
  Moves the meal `meal_id` of the Account to `(date, slot)`, in one transaction.

  Returns the moved meal and the meal it displaced, `nil` when the destination
  was empty, as they are stored after the move. `today` is the Account's today
  (`MealPlannerApi.AccountClock`): it decides which archived Shopping items are
  dropped so that the next Shopping list read derives them again.

  A cooked meal is refused on either side, and so is a meal answered "not
  cooked" (issue #395: an answered meal is final) and a meal on `today` with an
  `active` Cooking session (issue #207). A session off `today` does not count:
  the app cannot finish it, since starting refuses a meal off today, so it
  must not pin its meal (issue #337).
  `:conflict` is a concurrent write
  that took the destination, and a retry can succeed. `:move_not_possible`
  is stored rows that cannot follow the meal, and a retry fails the same way.
  Nothing is written in either case.
  """
  @spec move(Ecto.UUID.t(), term(), Date.t(), atom(), Date.t()) ::
          {:ok, result()} | {:error, reason()}
  def move(account_id, meal_id, %Date{} = date, slot, %Date{} = today) when is_atom(slot) do
    case Ecto.UUID.cast(meal_id) do
      {:ok, meal_id} -> move_in_transaction(account_id, meal_id, {date, slot}, today)
      :error -> {:error, :meal_not_found}
    end
  end

  defp move_in_transaction(account_id, meal_id, to, today) do
    Repo.transaction(fn -> move_locked(account_id, meal_id, to, today) end)
  rescue
    error in Postgrex.Error ->
      case error.postgres do
        %{code: code} = postgres when code in @conflict_codes ->
          # The violated constraint tells stored rows that can never be moved
          # from a concurrent write.
          reason = failure_reason(postgres[:constraint])

          Logger.warning(
            "calendar meal move #{failure_label(reason)} account_id=#{account_id} " <>
              "meal_id=#{meal_id} code=#{code} constraint=#{postgres[:constraint] || "none"}"
          )

          {:error, reason}

        _ ->
          reraise error, __STACKTRACE__
      end
  end

  defp failure_reason(constraint) when constraint in @stored_state_constraints,
    do: :move_not_possible

  defp failure_reason(_constraint), do: :conflict

  defp failure_label(:move_not_possible), do: "not possible"
  defp failure_label(:conflict), do: "conflict"

  defp move_locked(account_id, meal_id, to, today) do
    {source, displaced} = lock_meals(account_id, meal_id, to)

    case refusal(source, displaced, to) || cooking_refusal(source, displaced, today) do
      nil -> exchange(source, displaced, to, today)
      reason -> Repo.rollback(reason)
    end
  end

  # Locks the meal and whatever sits at the destination in id order, so two
  # opposite moves wait for each other instead of deadlocking. The meals are
  # locked before their Shopping items, as the lock order in the moduledoc of
  # `MealPlannerApi.Cart` says.
  defp lock_meals(account_id, meal_id, {date, slot}) do
    meals =
      from(m in ScheduledMeal,
        where:
          m.account_id == ^account_id and
            (m.id == ^meal_id or (m.date == ^date and m.slot == ^slot)),
        order_by: m.id,
        lock: "FOR UPDATE"
      )
      |> Repo.all()

    {Enum.find(meals, &(&1.id == meal_id)), Enum.find(meals, &(&1.id != meal_id))}
  end

  defp refusal(nil, _displaced, _to), do: :meal_not_found
  defp refusal(%{date: date, slot: slot}, _displaced, {date, slot}), do: :same_slot
  defp refusal(%{is_cooked: true}, _displaced, _to), do: :meal_cooked
  defp refusal(_source, %{is_cooked: true}, _to), do: :target_meal_cooked
  defp refusal(%{not_cooked_at: %DateTime{}}, _displaced, _to), do: :meal_already_confirmed
  defp refusal(_source, %{not_cooked_at: %DateTime{}}, _to), do: :target_meal_already_confirmed
  defp refusal(_source, _displaced, _to), do: nil

  # Read after the meals are locked: starting a Cooking session inserts a row
  # that references its meal, and that insert waits on the lock this move
  # holds, so no session of either meal starts until the move is over. Only a
  # meal on `today` is held: off today the app cannot finish its session.
  defp cooking_refusal(source, displaced, today) do
    on_today = for meal <- [source, displaced], meal && meal.date == today, do: meal.id

    cooking =
      from(s in CookingSession,
        where: s.scheduled_meal_id in ^on_today and s.status == :active,
        select: s.scheduled_meal_id
      )
      |> Repo.all()

    cond do
      source.id in cooking -> :meal_cooking_in_progress
      displaced && displaced.id in cooking -> :target_meal_cooking_in_progress
      true -> nil
    end
  end

  defp exchange(source, displaced, {date, slot} = to, today) do
    now = DateTime.utc_now()
    from = {source.date, source.slot}

    # Slot favorites are read by position, so the ones of both positions are
    # exchanged with the meals, for every User of the Account.
    favorites_from = favorite_position(from)
    favorites_to = favorite_position(to)
    source_favorites = favorite_ids(source.account_id, favorites_from)
    displaced_favorites = favorite_ids(source.account_id, favorites_to)

    swap(ScheduledMeal, [source.id], ids(displaced), from, to, now)
    swap(SlotFavorite, source_favorites, displaced_favorites, favorites_from, favorites_to, now)

    move_shopping_items(source, date, today, now)
    if displaced, do: move_shopping_items(displaced, source.date, today, now)

    %{
      moved: %{source | date: date, slot: slot, updated_at: now},
      displaced: displaced && %{displaced | date: source.date, slot: source.slot, updated_at: now}
    }
  end

  # Nothing sits at the destination, so there is no key to free first.
  defp swap(schema, source_ids, [], _from, to, now), do: place(schema, source_ids, to, now)

  defp swap(schema, source_ids, displaced_ids, {from_date, from_slot}, to, now) do
    place(schema, source_ids, {@parking_date, from_slot}, now)
    place(schema, displaced_ids, {from_date, from_slot}, now)
    place(schema, source_ids, to, now)
  end

  defp place(_schema, [], _position, _now), do: :ok

  # Only `date`, `slot` and `updated_at` are written: the BEFORE UPDATE
  # triggers on `scheduled_meals` refuse a change to the frozen recipe columns.
  defp place(schema, ids, {date, slot}, now) do
    from(row in schema, where: row.id in ^ids)
    |> Repo.update_all(set: [date: date, slot: slot, updated_at: now])

    :ok
  end

  defp favorite_ids(account_id, {date, slot}) do
    from(f in SlotFavorite,
      where: f.account_id == ^account_id and f.date == ^date and f.slot == ^slot,
      select: f.id
    )
    |> Repo.all()
  end

  # `planned_date` is the meal's date, so the planned items follow it in every
  # status: a bought or removed item still answers for its meal. A slot change
  # inside the same day leaves them alone.
  defp move_shopping_items(%ScheduledMeal{date: date}, date, _today, _now), do: :ok

  defp move_shopping_items(meal, date, today, now) do
    planned =
      from(i in ShoppingItem,
        where:
          i.account_id == ^meal.account_id and i.scheduled_meal_id == ^meal.id and
            i.source == :planned_meal
      )

    # An archived item is one a past day left unbought. Open, removed and
    # archived items answer for their meal's planned key when the Shopping
    # list is derived (bought ones do not), so once the meal is due again the
    # archived item is dropped and the next read derives an open one. It goes
    # first: only the rows that stay take the new date.
    if Date.compare(date, today) != :lt do
      Repo.delete_all(where(planned, [i], i.status == :archived))
    end

    Repo.update_all(planned, set: [planned_date: date, updated_at: now])
    :ok
  end

  defp ids(nil), do: []
  defp ids(%ScheduledMeal{id: id}), do: [id]

  # `slot_favorites.slot` is a string column, not the enum of `scheduled_meals`.
  defp favorite_position({date, slot}), do: {date, Atom.to_string(slot)}
end
