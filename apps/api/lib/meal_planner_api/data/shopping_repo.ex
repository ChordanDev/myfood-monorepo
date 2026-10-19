defmodule MealPlannerApi.Data.ShoppingRepo do
  @moduledoc """
  Pure data access for supermarkets, shopping items, and checkout sessions.

  No business logic. No orchestration. Just queries and persistence.
  """

  import Ecto.Query, warn: false
  alias MealPlannerApi.Repo

  alias MealPlannerApi.Persistence.Shopping.{
    CheckoutSession,
    ShoppingItem,
    Supermarket,
    SupermarketCatalog
  }

  # -------------------------------------------------------------------------
  # Supermarkets
  # -------------------------------------------------------------------------

  @spec create_supermarket(map()) :: {:ok, Supermarket.t()} | {:error, Ecto.Changeset.t()}
  def create_supermarket(attrs),
    do: %Supermarket{} |> Supermarket.changeset(attrs) |> Repo.insert()

  @spec upsert_supermarket(map()) :: {:ok, Supermarket.t()} | {:error, Ecto.Changeset.t()}
  def upsert_supermarket(attrs) do
    %Supermarket{}
    |> Supermarket.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace_all_except, [:id, :inserted_at]},
      conflict_target: [:name]
    )
  end

  @spec get_supermarket!(Ecto.UUID.t()) :: Supermarket.t()
  def get_supermarket!(id), do: Repo.get!(Supermarket, id)

  # -------------------------------------------------------------------------
  # Price catalog
  # -------------------------------------------------------------------------

  @spec upsert_catalog_entry(map()) ::
          {:ok, SupermarketCatalog.t()} | {:error, Ecto.Changeset.t()}
  def upsert_catalog_entry(attrs) do
    %SupermarketCatalog{}
    |> SupermarketCatalog.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace, [:price_cents_ars, :unit, :last_scraped_at, :updated_at]},
      conflict_target: [:supermarket_id, :ingredient_id, :price_date]
    )
  end

  @spec get_latest_price(Ecto.UUID.t(), Ecto.UUID.t(), Date.t()) ::
          SupermarketCatalog.t() | nil
  def get_latest_price(supermarket_id, ingredient_id, date) do
    from(c in SupermarketCatalog,
      where: c.supermarket_id == ^supermarket_id and c.ingredient_id == ^ingredient_id,
      where: c.price_date <= ^date,
      order_by: [desc: c.price_date],
      limit: 1
    )
    |> Repo.one()
  end

  @spec list_prices_for_ingredient(Ecto.UUID.t()) :: [SupermarketCatalog.t()]
  def list_prices_for_ingredient(ingredient_id) do
    from(c in SupermarketCatalog,
      where: c.ingredient_id == ^ingredient_id,
      order_by: [asc: c.price_cents_ars],
      preload: [:supermarket]
    )
    |> Repo.all()
  end

  # -------------------------------------------------------------------------
  # Checkout sessions
  # -------------------------------------------------------------------------

  @spec create_checkout_session(map()) ::
          {:ok, CheckoutSession.t()} | {:error, Ecto.Changeset.t()}
  def create_checkout_session(attrs),
    do: %CheckoutSession{} |> CheckoutSession.changeset(attrs) |> Repo.insert()

  @spec update_checkout_session(CheckoutSession.t(), map()) ::
          {:ok, CheckoutSession.t()} | {:error, Ecto.Changeset.t()}
  def update_checkout_session(session, attrs),
    do: session |> CheckoutSession.changeset(attrs) |> Repo.update()

  @spec get_checkout_session!(Ecto.UUID.t()) :: CheckoutSession.t()
  def get_checkout_session!(id), do: Repo.get!(CheckoutSession, id)

  @spec get_checkout_session_for_account(Ecto.UUID.t(), Ecto.UUID.t()) ::
          CheckoutSession.t() | nil
  def get_checkout_session_for_account(account_id, checkout_session_id) do
    from(s in CheckoutSession,
      where: s.account_id == ^account_id and s.id == ^checkout_session_id,
      limit: 1
    )
    |> Repo.one()
  end

  @spec list_checkout_sessions(Ecto.UUID.t()) :: [CheckoutSession.t()]
  def list_checkout_sessions(account_id) do
    from(s in CheckoutSession,
      where: s.account_id == ^account_id,
      order_by: [desc: s.inserted_at]
    )
    |> Repo.all()
  end

  @spec list_pending_delivery_sessions(Ecto.UUID.t()) :: [CheckoutSession.t()]
  def list_pending_delivery_sessions(account_id) do
    from(s in CheckoutSession,
      where: s.account_id == ^account_id and s.status == :pending_delivery,
      order_by: [asc: s.inserted_at]
    )
    |> Repo.all()
  end

  # -------------------------------------------------------------------------
  # Window wipe (shopping-derived-from-confirmed-plan PR1)
  # -------------------------------------------------------------------------

  @doc """
  Deletes the planned ShoppingItems for the given account whose
  `planned_date` falls within `[range_from, range_to]` AND whose status is
  `:pending`, `:in_cart` or `:removed`.

  Terminal statuses (`:checked_out`, `:archived`, `:pending_delivery`)
  are preserved, and so are manual items (issue #40): they are for no date
  or meal, and a rebuild of the plan has no say over them. The User's
  Shopping removals are kept apart from the items and stay: mark the items
  derived again with `Persistence.Shopping.mark_removed_items/2`.

  Returns `{deleted_count, nil}`.
  """
  @spec delete_pending_for_window(String.t(), Date.t(), Date.t()) ::
          {non_neg_integer(), nil}
  def delete_pending_for_window(account_id, range_from, range_to) do
    window =
      from(i in ShoppingItem,
        where: i.account_id == ^account_id,
        where: i.source == :planned_meal,
        where: i.planned_date >= ^range_from and i.planned_date <= ^range_to,
        where: i.status in [:pending, :in_cart, :removed]
      )

    # Locked in id order before the delete, the order a Shopping list read
    # locks the pending items it corrects
    # (`Persistence.Shopping.lock_pending_planned_items/2`): deleting them in
    # the order it finds them, the wipe could hold one item a read waits for
    # while it waits for another the read holds.
    window |> order_by(:id) |> lock("FOR UPDATE") |> select([i], i.id) |> Repo.all()

    Repo.delete_all(window)
  end

  # -------------------------------------------------------------------------
  # Shopping items
  # -------------------------------------------------------------------------

  @spec create_shopping_item(map()) :: {:ok, ShoppingItem.t()} | {:error, Ecto.Changeset.t()}
  def create_shopping_item(attrs),
    do: %ShoppingItem{} |> ShoppingItem.changeset(attrs) |> Repo.insert()

  # The partial unique index `shopping_items_open_planned_key_index`: its
  # predicate is part of the conflict target, or PostgreSQL does not match it.
  @open_planned_key {:unsafe_fragment,
                     ~s|("account_id","scheduled_meal_id","planned_date","ingredient_id","unit") | <>
                       ~s|WHERE status IN ('pending','in_cart')|}

  @doc """
  Stores a ShoppingItem, replacing the open one (`:pending` or `:in_cart`)
  that has the same planned key: Account, Scheduled meal, planned date,
  Ingredient and unit.

  The given `quantity_milli`, `checkout_session_id`, `status` and
  `reservation_token` win over the stored row, which keeps its id and
  `inserted_at`, so a reserved item comes back without its reservation. Closed ShoppingItems with
  the same planned key are left alone.

  The plan confirm rebuild writes through this: a Shopping list read can
  derive an open ShoppingItem between the rebuild's wipe and its insert, and
  a plain insert would then fail the confirm.
  """
  @spec upsert_open_shopping_item(map()) ::
          {:ok, ShoppingItem.t()} | {:error, Ecto.Changeset.t()}
  def upsert_open_shopping_item(attrs) do
    %ShoppingItem{}
    |> ShoppingItem.changeset(attrs)
    |> Repo.insert(
      on_conflict:
        {:replace,
         [:quantity_milli, :checkout_session_id, :status, :reservation_token, :updated_at]},
      conflict_target: @open_planned_key,
      returning: true
    )
  end

  @spec upsert_shopping_item(map()) :: {:ok, ShoppingItem.t()} | {:error, Ecto.Changeset.t()}
  def upsert_shopping_item(attrs) do
    %ShoppingItem{}
    |> ShoppingItem.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace, [:quantity_milli, :is_checked, :updated_at]},
      conflict_target: [:checkout_session_id, :ingredient_id]
    )
  end

  @spec list_shopping_items(Ecto.UUID.t()) :: [ShoppingItem.t()]
  def list_shopping_items(checkout_session_id) do
    from(i in ShoppingItem,
      where: i.checkout_session_id == ^checkout_session_id,
      preload: [:ingredient],
      order_by: [asc: i.inserted_at]
    )
    |> Repo.all()
  end

  @spec update_shopping_item(ShoppingItem.t(), map()) ::
          {:ok, ShoppingItem.t()} | {:error, Ecto.Changeset.t()}
  def update_shopping_item(item, attrs),
    do: item |> ShoppingItem.changeset(attrs) |> Repo.update()

  @spec delete_shopping_item(Ecto.UUID.t()) :: :ok
  def delete_shopping_item(id) do
    Repo.delete!(Repo.get!(ShoppingItem, id))
    :ok
  end

  @spec toggle_shopping_item_checked(Ecto.UUID.t()) ::
          {:ok, ShoppingItem.t()} | {:error, Ecto.Changeset.t()}
  def toggle_shopping_item_checked(id) do
    item = Repo.get!(ShoppingItem, id)
    update_shopping_item(item, %{is_checked: not item.is_checked})
  end
end
