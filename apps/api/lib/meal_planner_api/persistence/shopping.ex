defmodule MealPlannerApi.Persistence.Shopping do
  @moduledoc "Persistence helpers for supermarkets, shopping items and checkout sessions."

  import Ecto.Query, warn: false

  require Logger

  alias MealPlannerApi.Repo

  alias MealPlannerApi.Persistence.Planning.ScheduledMeal

  alias MealPlannerApi.Persistence.Shopping.{
    CheckoutSession,
    ShoppingItem,
    ShoppingRemoval,
    Supermarket,
    SupermarketCatalog
  }

  # A Shopping item derived from a Scheduled meal: its planned key, without
  # the Account, and the columns the derivation writes.
  @planned_key_fields [:scheduled_meal_id, :planned_date, :ingredient_id, :unit]
  @planned_line_fields @planned_key_fields ++ [:quantity_milli]
  @planned_item_fields [:account_id, :status | @planned_line_fields]

  # The largest value the `int4` `quantity_milli` column holds.
  @max_quantity_milli 2_147_483_647

  def create_supermarket(attrs),
    do: %Supermarket{} |> Supermarket.changeset(attrs) |> Repo.insert()

  def upsert_supermarket_by_name(attrs) do
    %Supermarket{}
    |> Supermarket.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace_all_except, [:id, :inserted_at]},
      conflict_target: [:name]
    )
  end

  def upsert_supermarket_catalog(attrs) do
    %SupermarketCatalog{}
    |> SupermarketCatalog.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace, [:price_cents_ars, :unit, :last_scraped_at, :updated_at]},
      conflict_target: [:supermarket_id, :ingredient_id, :price_date]
    )
  end

  def create_checkout_session(attrs),
    do: %CheckoutSession{} |> CheckoutSession.changeset(attrs) |> Repo.insert()

  def update_checkout_session(session, attrs),
    do: session |> CheckoutSession.changeset(attrs) |> Repo.update()

  def get_checkout_session_for_account(account_id, checkout_session_id) do
    from(s in CheckoutSession,
      where: s.account_id == ^account_id and s.id == ^checkout_session_id,
      limit: 1
    )
    |> Repo.one()
  end

  def list_pending_delivery_sessions(account_id) do
    from(s in CheckoutSession,
      where: s.account_id == ^account_id and s.status == :pending_delivery,
      order_by: [desc: s.inserted_at]
    )
    |> Repo.all()
  end

  def create_shopping_item(attrs),
    do: %ShoppingItem{} |> ShoppingItem.changeset(attrs) |> Repo.insert()

  def update_shopping_item(item, attrs),
    do: item |> ShoppingItem.changeset(attrs) |> Repo.update()

  @doc """
  Stores an item added by hand (`ShoppingItem.manual_changeset/2`).

  Manual items have no planned key, so they are never merged with another
  item and never conflict with one.
  """
  @spec create_manual_item(map()) :: {:ok, ShoppingItem.t()} | {:error, Ecto.Changeset.t()}
  def create_manual_item(attrs),
    do: %ShoppingItem{} |> ShoppingItem.manual_changeset(attrs) |> Repo.insert()

  @doc """
  Deletes the Account's manual Shopping item with this id while it is still on the list
  (`:pending` or `:in_cart`), in one conditional statement. `{:ok, id}` when it was deleted,
  `:error` when no such item is on the list (unknown, of another Account, not a UUID, planned,
  or already closed).
  """
  @spec delete_open_manual_item(Ecto.UUID.t(), term()) :: {:ok, Ecto.UUID.t()} | :error
  def delete_open_manual_item(account_id, item_id) do
    with {:ok, uuid} <- Ecto.UUID.cast(item_id),
         {1, _} <-
           from(i in ShoppingItem,
             where:
               i.account_id == ^account_id and i.id == ^uuid and i.source == :manual and
                 i.status in [:pending, :in_cart]
           )
           |> Repo.delete_all() do
      {:ok, uuid}
    else
      _not_deleted -> :error
    end
  end

  @doc """
  The Account's Shopping item with this id, with its Ingredient loaded, or
  `nil` when the id is unknown, of another Account or not a UUID.
  """
  @spec get_item_for_account(Ecto.UUID.t(), term()) :: ShoppingItem.t() | nil
  def get_item_for_account(account_id, item_id) do
    case Ecto.UUID.cast(item_id) do
      {:ok, uuid} ->
        from(i in ShoppingItem,
          where: i.account_id == ^account_id and i.id == ^uuid,
          preload: [:ingredient]
        )
        |> Repo.one()

      :error ->
        nil
    end
  end

  @doc """
  Locks `FOR KEY SHARE`, in id order, the Scheduled meals of the Account's Shopping items
  among `item_ids`. Take it before the items: storing a Shopping removal checks its meal's
  foreign key, and taken after the items that lock waits for a move or a finish that holds
  the meal and waits for the items (the lock order in the moduledoc of `MealPlannerApi.Cart`).
  An item never changes its meal, so the items locked next have no other one.
  """
  @spec lock_meals_of_items(Ecto.UUID.t(), [Ecto.UUID.t()]) :: :ok
  def lock_meals_of_items(account_id, item_ids) when is_list(item_ids) do
    meal_ids =
      from(i in ShoppingItem,
        where: i.account_id == ^account_id and i.id in ^item_ids,
        select: i.scheduled_meal_id
      )

    from(m in ScheduledMeal,
      where: m.account_id == ^account_id and m.id in subquery(meal_ids),
      order_by: m.id,
      lock: "FOR KEY SHARE",
      select: m.id
    )
    |> Repo.all()

    :ok
  end

  @doc """
  Locks and returns the Account's Shopping items with these ids, in id
  order, the way the Cart locks them. Ids of other Accounts or that do not
  exist are simply not returned. Call it inside a transaction.
  """
  @spec lock_items_for_account(Ecto.UUID.t(), [Ecto.UUID.t()]) :: [ShoppingItem.t()]
  def lock_items_for_account(account_id, item_ids) when is_list(item_ids) do
    from(i in ShoppingItem,
      where: i.account_id == ^account_id and i.id in ^item_ids,
      order_by: i.id,
      lock: "FOR UPDATE"
    )
    |> Repo.all()
  end

  @doc """
  Sets the status of Shopping items by id, one statement, and stamps the
  write. Returns the number of rows changed.
  """
  @spec set_items_status([Ecto.UUID.t()], atom()) :: non_neg_integer()
  def set_items_status([], _status), do: 0

  def set_items_status(item_ids, status) when is_list(item_ids) do
    {count, _} =
      from(i in ShoppingItem, where: i.id in ^item_ids)
      |> Repo.update_all(set: [status: status, updated_at: DateTime.utc_now()])

    count
  end

  @doc """
  The manual Shopping items of an Account that are still on the list
  (`:pending` or `:in_cart`), oldest first, with their Ingredient loaded.
  They are for no date, so no date limit applies to them.
  """
  @spec list_open_manual_items(Ecto.UUID.t()) :: [ShoppingItem.t()]
  def list_open_manual_items(account_id) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.source == :manual and
          i.status in [:pending, :in_cart],
      order_by: [asc: i.inserted_at, asc: i.id],
      preload: [:ingredient]
    )
    |> Repo.all()
  end

  @typedoc "Scheduled meal, planned date, Ingredient and unit of a Shopping item."
  @type planned_key :: {Ecto.UUID.t(), Date.t(), Ecto.UUID.t(), atom()}

  @doc """
  Returns the planned keys the Account already has a Shopping item for, among
  the given Scheduled meals.

  Every status counts but the bought ones (`:checked_out`, `:pending_delivery`):
  an open, removed or archived item answers for its Scheduled meal, so it is not
  derived again. A bought item does not, so what its meal still lacks after the
  purchase can be derived (issue #277); the read's Shortage already counts what
  was bought (`ShoppingRebuilder.compute_net_shortages/3`).
  """
  @spec planned_item_keys(Ecto.UUID.t(), [Ecto.UUID.t()]) :: MapSet.t(planned_key())
  def planned_item_keys(_account_id, []), do: MapSet.new()

  def planned_item_keys(account_id, scheduled_meal_ids) when is_list(scheduled_meal_ids) do
    from(i in ShoppingItem,
      where: i.account_id == ^account_id and i.scheduled_meal_id in ^scheduled_meal_ids,
      where: i.status not in [:checked_out, :pending_delivery],
      distinct: true,
      select: {i.scheduled_meal_id, i.planned_date, i.ingredient_id, i.unit}
    )
    |> Repo.all()
    |> MapSet.new()
  end

  @doc """
  Stores the Shopping items derived from Scheduled meals as `:pending`, each
  planned key at most once.

  `lines` are Shortage lines as `ShoppingRebuilder.compute_net_shortages/2`
  emits them: `scheduled_meal_id`, `planned_date`, `ingredient_id`, `unit` and
  `quantity_milli`. They are written in one statement that skips every line
  whose planned key already has an open Shopping item, so calling this again
  with the same lines, or from two requests at the same time, stores nothing
  twice. Of two lines that share a planned key the first one is kept.

  A failure never drops the other lines, and it is always logged:

    * a line `ShoppingItem.changeset/2` rejects is skipped;
    * if the statement fails, the lines are stored one by one and the ones
      the database rejects are skipped.

  An error the changeset does not know about is raised to the caller.
  """
  @spec insert_planned_items(Ecto.UUID.t(), [map()]) :: :ok
  def insert_planned_items(_account_id, []), do: :ok

  def insert_planned_items(account_id, lines) when is_list(lines) do
    {valid, rejected} =
      lines
      |> Enum.map(&planned_item_changeset(account_id, &1))
      |> Enum.split_with(& &1.valid?)

    Enum.each(rejected, &log_planned_item(account_id, &1, "shopping planned item skipped"))

    valid
    |> Enum.uniq_by(&planned_item_key/1)
    |> insert_planned_changesets(account_id)
  end

  defp insert_planned_changesets([], _account_id), do: :ok

  defp insert_planned_changesets(changesets, account_id) do
    # `insert_all/3` generates the binary id of each row but not its
    # timestamps.
    now = DateTime.utc_now()

    # Sorted, so two requests that store the same lines at the same time take
    # the index entries in the same order and cannot deadlock each other.
    rows =
      changesets
      |> Enum.map(fn changeset ->
        changeset
        |> Ecto.Changeset.apply_changes()
        |> Map.take(@planned_item_fields)
        |> Map.merge(%{inserted_at: now, updated_at: now})
      end)
      |> Enum.sort_by(
        &{&1.scheduled_meal_id, Date.to_erl(&1.planned_date), &1.ingredient_id, &1.unit}
      )

    # The Shopping list read calls this inside a transaction. A statement that
    # fails there aborts the transaction, and the lines stored one by one
    # below would all fail with it, so each statement runs in a savepoint.
    # Outside a transaction the option changes nothing.
    try do
      Repo.insert_all(ShoppingItem, rows, on_conflict: :nothing, mode: :savepoint)
      :ok
    rescue
      exception ->
        Logger.error(
          "shopping planned items batch insert failed account_id=#{account_id} " <>
            "lines=#{length(rows)} exception=#{inspect(exception.__struct__)} " <>
            "message=#{Exception.message(exception)}"
        )

        Enum.each(changesets, &insert_planned_changeset(account_id, &1))
    end
  end

  defp insert_planned_changeset(account_id, changeset) do
    case Repo.insert(changeset, on_conflict: :nothing, mode: :savepoint) do
      {:ok, _item} ->
        :ok

      {:error, rejected} ->
        log_planned_item(account_id, rejected, "shopping planned item insert failed")
    end
  end

  defp planned_item_changeset(account_id, line) do
    attrs =
      line
      |> Map.take(@planned_line_fields)
      |> Map.merge(%{account_id: account_id, status: :pending})

    ShoppingItem.changeset(%ShoppingItem{}, attrs)
  end

  defp planned_item_key(changeset),
    do: Enum.map(@planned_key_fields, &Ecto.Changeset.get_field(changeset, &1))

  defp log_planned_item(account_id, changeset, message) do
    key =
      Enum.map_join(@planned_key_fields, " ", fn field ->
        "#{field}=#{Ecto.Changeset.get_field(changeset, field)}"
      end)

    Logger.error("#{message} account_id=#{account_id} #{key} errors=#{inspect(changeset.errors)}")
  end

  @typedoc "A `:pending` planned Shopping item, as a read checks it against its Shortage."
  @type pending_planned_item :: %{
          id: Ecto.UUID.t(),
          key: planned_key(),
          quantity_milli: pos_integer()
        }

  @doc """
  The `:pending` planned Shopping items of the given Scheduled meals, except the ones whose
  meal and Ingredient have a Shopping removal: a read never corrects those (issue #277).
  """
  @spec pending_planned_items(Ecto.UUID.t(), [Ecto.UUID.t()]) :: [pending_planned_item()]
  def pending_planned_items(_account_id, []), do: []

  def pending_planned_items(account_id, scheduled_meal_ids) do
    account_id |> pending_planned_query(scheduled_meal_ids) |> Repo.all()
  end

  @doc """
  `pending_planned_items/2` after a `FOR UPDATE` lock on every `:pending` planned item of
  the meals, taken in id order: the ones of a removed meal and Ingredient too, which
  `mark_removed_items/2` updates next. A Cart reservation that commits first takes the
  item out of the result, and the plan confirm wipe locks the items it deletes in the same
  order (`Data.ShoppingRepo.delete_pending_for_window/3`), so the two cannot deadlock. Take
  the meals' locks first, as the lock order in the moduledoc of `MealPlannerApi.Cart` says.
  """
  @spec lock_pending_planned_items(Ecto.UUID.t(), [Ecto.UUID.t()]) :: [pending_planned_item()]
  def lock_pending_planned_items(_account_id, []), do: []

  def lock_pending_planned_items(account_id, scheduled_meal_ids) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.scheduled_meal_id in ^scheduled_meal_ids and
          i.source == :planned_meal and i.status == :pending,
      order_by: i.id,
      lock: "FOR UPDATE",
      select: i.id
    )
    |> Repo.all()

    pending_planned_items(account_id, scheduled_meal_ids)
  end

  defp pending_planned_query(account_id, scheduled_meal_ids) do
    removals =
      from(r in ShoppingRemoval,
        where:
          r.scheduled_meal_id == parent_as(:item).scheduled_meal_id and
            r.ingredient_id == parent_as(:item).ingredient_id,
        select: 1
      )

    from(i in ShoppingItem,
      as: :item,
      where:
        i.account_id == ^account_id and i.scheduled_meal_id in ^scheduled_meal_ids and
          i.source == :planned_meal and i.status == :pending,
      where: not exists(removals),
      order_by: i.id,
      select: %{
        id: i.id,
        key: {i.scheduled_meal_id, i.planned_date, i.ingredient_id, i.unit},
        quantity_milli: i.quantity_milli
      }
    )
  end

  @doc """
  What the bought planned Shopping items of the given Scheduled meals hold, per meal,
  Ingredient and unit: `stocked` for the ones that reached Inventory (`:checked_out`) and
  `in_transit` for an online purchase on its way (`:pending_delivery`). A Shopping list read
  lets them cover their own meal first (`ShoppingRebuilder.compute_net_shortages/3`).
  """
  @spec bought_quantities(Ecto.UUID.t(), [Ecto.UUID.t()]) :: %{
          {Ecto.UUID.t(), Ecto.UUID.t(), atom()} => %{
            stocked: non_neg_integer(),
            in_transit: non_neg_integer()
          }
        }
  def bought_quantities(_account_id, []), do: %{}

  def bought_quantities(account_id, scheduled_meal_ids) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.scheduled_meal_id in ^scheduled_meal_ids and
          i.source == :planned_meal and i.status in [:checked_out, :pending_delivery],
      group_by: [i.scheduled_meal_id, i.ingredient_id, i.unit, i.status],
      select: {i.scheduled_meal_id, i.ingredient_id, i.unit, i.status, sum(i.quantity_milli)}
    )
    |> Repo.all()
    |> Enum.reduce(%{}, fn {meal_id, ingredient_id, unit, status, quantity}, bought ->
      field = if status == :checked_out, do: :stocked, else: :in_transit

      Map.update(
        bought,
        {meal_id, ingredient_id, unit},
        Map.put(%{stocked: 0, in_transit: 0}, field, quantity),
        &Map.put(&1, field, quantity)
      )
    end)
  end

  @doc """
  Sets the `quantity_milli` of each `:pending` planned Shopping item of `quantities`, a list
  of `{item_id, quantity_milli}`, and returns how many it changed. An item that is no longer
  `:pending` is left alone.
  """
  @spec update_pending_quantities(Ecto.UUID.t(), [{Ecto.UUID.t(), pos_integer()}]) ::
          non_neg_integer()
  def update_pending_quantities(account_id, quantities) when is_list(quantities) do
    now = DateTime.utc_now()

    # A quantity the `int4` column cannot hold would abort the read's whole
    # transaction, on every read: it is skipped and logged, as
    # `insert_planned_items/2` skips a line the changeset rejects.
    {quantities, too_large} =
      Enum.split_with(quantities, fn {_item_id, quantity} -> quantity <= @max_quantity_milli end)

    Enum.each(too_large, fn {item_id, quantity_milli} ->
      Logger.error(
        "shopping pending quantity skipped account_id=#{account_id} item_id=#{item_id} " <>
          "quantity_milli=#{quantity_milli}"
      )
    end)

    Enum.reduce(quantities, 0, fn {item_id, quantity_milli}, updated ->
      {count, _} =
        from(i in ShoppingItem,
          where:
            i.account_id == ^account_id and i.id == ^item_id and i.source == :planned_meal and
              i.status == :pending
        )
        |> Repo.update_all(set: [quantity_milli: quantity_milli, updated_at: now])

      updated + count
    end)
  end

  @doc """
  Deletes the `:pending` planned Shopping items of `item_ids` and returns how many it
  deleted. An item that is no longer `:pending` is left alone.
  """
  @spec delete_pending_planned_items(Ecto.UUID.t(), [Ecto.UUID.t()]) :: non_neg_integer()
  def delete_pending_planned_items(_account_id, []), do: 0

  def delete_pending_planned_items(account_id, item_ids) when is_list(item_ids) do
    {deleted, _} =
      from(i in ShoppingItem,
        where:
          i.account_id == ^account_id and i.id in ^item_ids and i.source == :planned_meal and
            i.status == :pending
      )
      |> Repo.delete_all()

    deleted
  end

  def list_pending_items(account_id, from_date, to_date) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.status in [:pending, :in_cart] and
          i.planned_date >= ^from_date and i.planned_date <= ^to_date,
      order_by: [asc: i.planned_date]
    )
    |> Repo.all()
  end

  def list_pending_items_with_context(account_id, from_date, to_date) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.status == :pending and
          i.planned_date >= ^from_date and i.planned_date <= ^to_date,
      order_by: [asc: i.planned_date],
      preload: [:assigned_supermarket, :ingredient]
    )
    |> Repo.all()
  end

  @doc """
  The planned Shopping items of an Account that are still on the list
  (`:pending`, `:in_cart` or `:removed`) and planned from `from_date` on,
  with their Ingredient and Scheduled meal loaded. Manual items are for no
  meal, so the join leaves them out.

  `until_date` is the last planned day to include; `nil` leaves the range
  open.
  """
  @spec list_open_items_with_context(Ecto.UUID.t(), Date.t(), Date.t() | nil) :: [
          ShoppingItem.t()
        ]
  def list_open_items_with_context(account_id, from_date, until_date \\ nil) do
    from([i, _ingredient, _meal] in planned_items_with_context(account_id, from_date, until_date),
      where: i.status in [:pending, :in_cart, :removed]
    )
    |> Repo.all()
  end

  @doc """
  The planned Shopping items of an Account that were bought (`:checked_out`,
  or `:pending_delivery` while an online purchase is on its way) for a
  Scheduled meal that is not cooked yet, in the same range and with the same
  associations as `list_open_items_with_context/3`.

  A purchased item answers for its meal until the meal is cooked or leaves
  the range. Purchased manual items are for no meal and are never returned.
  """
  @spec list_purchased_items_with_context(Ecto.UUID.t(), Date.t(), Date.t() | nil) :: [
          ShoppingItem.t()
        ]
  def list_purchased_items_with_context(account_id, from_date, until_date \\ nil) do
    from([i, _ingredient, meal] in planned_items_with_context(account_id, from_date, until_date),
      where: i.status in [:checked_out, :pending_delivery] and meal.is_cooked == false
    )
    |> Repo.all()
  end

  defp planned_items_with_context(account_id, from_date, until_date) do
    # Joined, so an item is only listed together with both of them.
    query =
      from(i in ShoppingItem,
        join: ingredient in assoc(i, :ingredient),
        join: meal in assoc(i, :scheduled_meal),
        where: i.account_id == ^account_id and i.planned_date >= ^from_date,
        # A stable order for any caller. The Shopping list read re-sorts by
        # the slot's place in the day, which SQL cannot express on a string.
        order_by: [asc: i.planned_date, asc: i.id],
        preload: [ingredient: ingredient, scheduled_meal: meal]
      )

    if until_date do
      from(i in query, where: i.planned_date <= ^until_date)
    else
      query
    end
  end

  @spec list_items_for_account(pos_integer(), keyword()) :: [ShoppingItem.t()]
  def list_items_for_account(account_id, opts \\ []) do
    query =
      from(i in ShoppingItem,
        where: i.account_id == ^account_id,
        order_by: [asc: i.planned_date]
      )

    query =
      if Keyword.get(opts, :include_archived, false) do
        query
      else
        from(i in query, where: i.status != :archived)
      end

    Repo.all(query)
  end

  @spec list_items_by_session(pos_integer(), pos_integer()) :: [ShoppingItem.t()]
  def list_items_by_session(account_id, checkout_session_id) do
    from(i in ShoppingItem,
      where: i.account_id == ^account_id,
      where: i.checkout_session_id == ^checkout_session_id
    )
    |> Repo.all()
  end

  def list_items_by_ids(account_id, ids) when is_list(ids) do
    from(i in ShoppingItem,
      where: i.account_id == ^account_id and i.id in ^ids,
      preload: [:ingredient]
    )
    |> Repo.all()
  end

  def find_item_by_account_meal_ingredient(account_id, scheduled_meal_id, ingredient_id, unit) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.scheduled_meal_id == ^scheduled_meal_id and
          i.ingredient_id == ^ingredient_id and i.unit == ^unit,
      limit: 1
    )
    |> Repo.one()
  end

  def archive_outdated_unpurchased(account_id, date) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.status in [:pending, :in_cart] and
          i.planned_date < ^date
    )
    |> Repo.update_all(set: [status: :archived, updated_at: DateTime.utc_now()])
  end

  @doc """
  Deletes the planned Shopping items of one Scheduled meal that are still on the list
  (`:pending`, `:in_cart` and `:removed`), so the next list read derives them again from the
  meal as it is now, and returns how many it deleted. Closed items are kept. The meal's
  Shopping removals go too: they were made for the recipe the meal had, which is the one
  thing a caller of this changes.
  """
  @spec delete_open_items_for_meal(Ecto.UUID.t(), Ecto.UUID.t()) :: non_neg_integer()
  def delete_open_items_for_meal(account_id, scheduled_meal_id) do
    {deleted, _} =
      from(i in ShoppingItem,
        where:
          i.account_id == ^account_id and i.scheduled_meal_id == ^scheduled_meal_id and
            i.source == :planned_meal and i.status in [:pending, :in_cart, :removed]
      )
      |> Repo.delete_all()

    from(r in ShoppingRemoval,
      where: r.account_id == ^account_id and r.scheduled_meal_id == ^scheduled_meal_id
    )
    |> Repo.delete_all()

    deleted
  end

  # -------------------------------------------------------------------------
  # Shopping removals (issue #334)
  # -------------------------------------------------------------------------

  @typedoc "A Scheduled meal and an Ingredient: what a Shopping removal is for."
  @type removal_pair :: {Ecto.UUID.t(), Ecto.UUID.t()}

  @typedoc """
  What a Shopping removal is remembered by while its Scheduled meals are replaced: the date
  and slot of the meal and the Ingredient. The meal id is not part of it, because a
  replacement gives the meals new ids.
  """
  @type removal_key :: {Date.t(), atom(), Ecto.UUID.t()}

  @doc """
  Stores a Shopping removal for each Scheduled meal and Ingredient of `pairs`. A pair that
  has one already, or whose meal is not the Account's, stores nothing, so writing the same
  pairs again, or from two requests at once, keeps one row per pair.

  It does not change any Shopping item: `mark_removed_items/2` does.
  """
  @spec put_removals(Ecto.UUID.t(), [removal_pair()]) :: :ok
  def put_removals(_account_id, []), do: :ok

  def put_removals(account_id, pairs) when is_list(pairs) do
    meal_ids = pairs |> Enum.map(&elem(&1, 0)) |> Enum.uniq()

    own_meals =
      from(m in ScheduledMeal,
        where: m.account_id == ^account_id and m.id in ^meal_ids,
        select: m.id
      )
      |> Repo.all()
      |> MapSet.new()

    now = DateTime.utc_now()

    # Sorted, so two requests that store the same pairs at the same time take
    # the index entries in the same order and cannot deadlock each other.
    rows =
      pairs
      |> Enum.uniq()
      |> Enum.filter(fn {meal_id, _ingredient_id} -> MapSet.member?(own_meals, meal_id) end)
      |> Enum.sort()
      |> Enum.map(fn {meal_id, ingredient_id} ->
        %{
          account_id: account_id,
          scheduled_meal_id: meal_id,
          ingredient_id: ingredient_id,
          inserted_at: now,
          updated_at: now
        }
      end)

    Repo.insert_all(ShoppingRemoval, rows,
      on_conflict: :nothing,
      conflict_target: [:scheduled_meal_id, :ingredient_id]
    )

    :ok
  end

  @doc """
  Deletes the Shopping removals of the Account for the Scheduled meals and Ingredients of
  `pairs`. It does not change any Shopping item.
  """
  @spec delete_removals(Ecto.UUID.t(), [removal_pair()]) :: :ok
  def delete_removals(_account_id, []), do: :ok

  def delete_removals(account_id, pairs) when is_list(pairs) do
    # A pair without a Scheduled meal has no removal: Ecto refuses to
    # compare a column with `nil`.
    case Enum.reject(pairs, &is_nil(elem(&1, 0))) do
      [] -> :ok
      pairs -> delete_removal_rows(account_id, pairs)
    end
  end

  defp delete_removal_rows(account_id, pairs) do
    of_pairs =
      pairs
      |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
      |> Enum.reduce(dynamic(false), fn {meal_id, ingredient_ids}, of_pairs ->
        dynamic(
          [r],
          ^of_pairs or (r.scheduled_meal_id == ^meal_id and r.ingredient_id in ^ingredient_ids)
        )
      end)

    from(r in ShoppingRemoval, where: r.account_id == ^account_id, where: ^of_pairs)
    |> Repo.delete_all()

    :ok
  end

  @doc """
  Sets to `:removed` the `:pending` planned Shopping items of the given Scheduled meals whose
  meal and Ingredient have a Shopping removal, in every unit, and returns how many it
  changed. The derivation calls it after it stores items, so an item derived for a removal
  is listed as removed.

  It takes no Cart lock, so a Membership can reserve an item before the update: the update
  only changes items that are still `:pending`, and a reserved item stays in its Cart.
  """
  @spec mark_removed_items(Ecto.UUID.t(), [Ecto.UUID.t()]) :: non_neg_integer()
  def mark_removed_items(_account_id, []), do: 0

  def mark_removed_items(account_id, scheduled_meal_ids) when is_list(scheduled_meal_ids) do
    {updated, _} =
      from(i in ShoppingItem,
        join: r in ShoppingRemoval,
        on:
          r.account_id == i.account_id and r.scheduled_meal_id == i.scheduled_meal_id and
            r.ingredient_id == i.ingredient_id,
        where:
          i.account_id == ^account_id and i.scheduled_meal_id in ^scheduled_meal_ids and
            i.source == :planned_meal and i.status == :pending
      )
      |> Repo.update_all(set: [status: :removed, updated_at: DateTime.utc_now()])

    updated
  end

  @doc """
  The keys of the Shopping removals of the Account whose Scheduled meal falls in
  `[from_date, to_date]`. Take it before the meals of the window are replaced, and store
  the removals again for the new meals that still use the Ingredient.
  """
  @spec removal_keys(Ecto.UUID.t(), Date.t(), Date.t()) :: MapSet.t(removal_key())
  def removal_keys(account_id, from_date, to_date) do
    from(r in ShoppingRemoval,
      join: meal in assoc(r, :scheduled_meal),
      where: r.account_id == ^account_id and meal.date >= ^from_date and meal.date <= ^to_date,
      select: {meal.date, meal.slot, r.ingredient_id}
    )
    |> Repo.all()
    |> MapSet.new()
  end

  def update_open_items_for_ingredient(account_id, ingredient_id, attrs, from_date, to_date) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.ingredient_id == ^ingredient_id and
          i.status in [:pending, :in_cart] and i.planned_date >= ^from_date and
          i.planned_date <= ^to_date
    )
    |> Repo.update_all(set: Keyword.merge(Enum.into(attrs, []), updated_at: DateTime.utc_now()))
  end

  def get_supermarket(supermarket_id), do: Repo.get(Supermarket, supermarket_id)

  def latest_catalog_for_ingredients(ingredient_ids) when is_list(ingredient_ids) do
    from(c in SupermarketCatalog,
      where: c.ingredient_id in ^ingredient_ids,
      join: s in assoc(c, :supermarket),
      order_by: [asc: c.ingredient_id, asc: c.supermarket_id, desc: c.price_date],
      distinct: [c.ingredient_id, c.supermarket_id],
      select: %{
        ingredient_id: c.ingredient_id,
        supermarket_id: c.supermarket_id,
        supermarket_name: s.name,
        price_cents_ars: c.price_cents_ars,
        unit: c.unit,
        price_date: c.price_date
      }
    )
    |> Repo.all()
  end

  def list_items_grouped_by_supermarket(account_id, from_date, to_date) do
    from(i in ShoppingItem,
      where:
        i.account_id == ^account_id and i.status in [:pending, :in_cart] and
          i.planned_date >= ^from_date and i.planned_date <= ^to_date,
      group_by: i.assigned_supermarket_id,
      select: %{assigned_supermarket_id: i.assigned_supermarket_id, count: count(i.id)}
    )
    |> Repo.all()
  end
end
