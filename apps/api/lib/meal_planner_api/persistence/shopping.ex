defmodule MealPlannerApi.Persistence.Shopping do
  @moduledoc "Persistence helpers for supermarkets, shopping items and checkout sessions."

  import Ecto.Query, warn: false

  require Logger

  alias MealPlannerApi.Repo

  alias MealPlannerApi.Persistence.Shopping.{
    CheckoutSession,
    ShoppingItem,
    Supermarket,
    SupermarketCatalog
  }

  # A Shopping item derived from a Scheduled meal: its planned key, without
  # the Account, and the columns the derivation writes.
  @planned_key_fields [:scheduled_meal_id, :planned_date, :ingredient_id, :unit]
  @planned_line_fields @planned_key_fields ++ [:quantity_milli]
  @planned_item_fields [:account_id, :status | @planned_line_fields]

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

  @typedoc "Scheduled meal, planned date, Ingredient and unit of a Shopping item."
  @type planned_key :: {Ecto.UUID.t(), Date.t(), Ecto.UUID.t(), atom()}

  @doc """
  Returns the planned keys the Account already has a Shopping item for, among
  the given Scheduled meals.

  Every status counts: a Shopping item that was bought or archived still
  answers for its Scheduled meal, so it is not derived again.
  """
  @spec planned_item_keys(Ecto.UUID.t(), [Ecto.UUID.t()]) :: MapSet.t(planned_key())
  def planned_item_keys(_account_id, []), do: MapSet.new()

  def planned_item_keys(account_id, scheduled_meal_ids) when is_list(scheduled_meal_ids) do
    from(i in ShoppingItem,
      where: i.account_id == ^account_id and i.scheduled_meal_id in ^scheduled_meal_ids,
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

    try do
      Repo.insert_all(ShoppingItem, rows, on_conflict: :nothing)
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
    case Repo.insert(changeset, on_conflict: :nothing) do
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
  The Shopping items of an Account that are still on the list (`:pending`
  or `:in_cart`) and planned from `from_date` on, with their Ingredient
  and Scheduled meal loaded.

  `until_date` is the last planned day to include; `nil` leaves the range
  open.
  """
  @spec list_open_items_with_context(Ecto.UUID.t(), Date.t(), Date.t() | nil) :: [
          ShoppingItem.t()
        ]
  def list_open_items_with_context(account_id, from_date, until_date \\ nil) do
    # Joined, so an item is only listed together with both of them.
    query =
      from(i in ShoppingItem,
        join: ingredient in assoc(i, :ingredient),
        join: meal in assoc(i, :scheduled_meal),
        where:
          i.account_id == ^account_id and i.status in [:pending, :in_cart] and
            i.planned_date >= ^from_date,
        # A stable order for any caller. The Shopping list read re-sorts by
        # the slot's place in the day, which SQL cannot express on a string.
        order_by: [asc: i.planned_date, asc: i.id],
        preload: [ingredient: ingredient, scheduled_meal: meal]
      )

    query =
      if until_date do
        from(i in query, where: i.planned_date <= ^until_date)
      else
        query
      end

    Repo.all(query)
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
  Deletes the open (`:pending`, `:in_cart`) Shopping items of one Scheduled meal, so the next
  list read derives them again from the meal as it is now. Closed items are kept.
  """
  @spec delete_open_items_for_meal(Ecto.UUID.t(), Ecto.UUID.t()) :: non_neg_integer()
  def delete_open_items_for_meal(account_id, scheduled_meal_id) do
    {deleted, _} =
      from(i in ShoppingItem,
        where:
          i.account_id == ^account_id and i.scheduled_meal_id == ^scheduled_meal_id and
            i.status in [:pending, :in_cart]
      )
      |> Repo.delete_all()

    deleted
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
