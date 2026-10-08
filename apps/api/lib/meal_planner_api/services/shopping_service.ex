defmodule MealPlannerApi.Services.ShoppingService do
  @moduledoc """
  Shopping list orchestration.

  Builds, manages, and resolves shopping lists with supermarket assignments
  and price estimates.
  """

  import Ecto.Query, warn: false
  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Cart
  alias MealPlannerApi.Data.ShoppingRepo
  alias MealPlannerApi.Data.RecipeRepo
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo
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
      the pending and in-cart Shopping items planned from today on, with
      `status` `"needed"` or `"in_cart"` and `source` `"planned_meal"`.
    * `manual` — always `[]` until manual items exist.
    * `cart` — `%{session_id, lease_expires_at}` for the caller's own
      active Cart, otherwise `nil`. A line held in another member's Cart
      still reads `"in_cart"`.
    * `totals` — `needed`, `in_cart` and `removed` count the planned
      lines by status; `estimated_cents` adds the estimated price of the
      needed items.
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

    # Auto-archive past items (always runs on every call)
    prune_past_items(account_id, today)

    upcoming_meals = upcoming_uncooked_meals(account_id, today)

    # Build items from scheduled meals (if not already created)
    _ =
      ensure_shopping_items_from_schedule(
        account_id,
        ShoppingRebuilder.limit_to_date(upcoming_meals, until_date)
      )

    items =
      account_id
      |> Shopping.list_open_items_with_context(today, until_date)
      |> Enum.sort_by(&list_position/1)

    planned =
      items
      |> Enum.map(&planned_row/1)
      |> ShoppingRebuilder.group_lines(group_by)

    %{
      planned: Enum.map(planned, &serialize_line/1),
      manual: [],
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

  # Enum values leave as strings, like the rest of this service. Dates stay
  # `Date` structs, which the JSON encoder writes as ISO 8601.
  defp serialize_line(line) do
    %{
      line
      | category: Atom.to_string(line.category),
        unit: Atom.to_string(line.unit),
        status: Atom.to_string(line.status),
        source: Atom.to_string(line.source),
        allocations: Enum.map(line.allocations, &%{&1 | slot: Atom.to_string(&1.slot)})
    }
  end

  defp serialize_cart(nil), do: nil

  defp serialize_cart(%Shopping.CheckoutSession{} = cart) do
    %{session_id: cart.id, lease_expires_at: cart.lease_expires_at}
  end

  # Prune/archive past-dated items (planned_date before the Account's today)
  # Always runs on every get_shopping_list call
  defp prune_past_items(account_id, today) do
    past_items =
      Ecto.Query.from(i in MealPlannerApi.Persistence.Shopping.ShoppingItem,
        where: i.account_id == ^account_id,
        where: not is_nil(i.planned_date),
        where: i.planned_date < ^today,
        where: i.status == :pending
      )
      |> Repo.all()

    Enum.each(past_items, fn item ->
      Repo.update!(Ecto.Changeset.change(item, %{status: :archived}))
    end)
  rescue
    _ -> :ok
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

  # Ensure shopping items exist for the given scheduled meals
  defp ensure_shopping_items_from_schedule(account_id, scheduled_meals) do
    scheduled_meals = Repo.preload(scheduled_meals, recipe: :recipe_ingredients)

    pool =
      MealPlannerApi.Services.InventoryService.list_for_account(account_id)
      |> Enum.reduce(%{}, fn item, pool ->
        Map.update(
          pool,
          {item.ingredient_id, item.unit},
          item.quantity_milli,
          &(&1 + item.quantity_milli)
        )
      end)

    ShoppingRebuilder.compute_net_shortages(scheduled_meals, pool)
    |> Enum.each(fn line ->
      existing =
        from(i in MealPlannerApi.Persistence.Shopping.ShoppingItem,
          where: i.account_id == ^account_id,
          where: i.ingredient_id == ^line.ingredient_id and i.unit == ^line.unit,
          where: i.scheduled_meal_id == ^line.scheduled_meal_id,
          where: i.planned_date == ^line.planned_date
        )
        |> Repo.exists?()

      if not existing do
        Shopping.create_shopping_item(
          Map.merge(line, %{account_id: account_id, status: :pending})
        )
      end
    end)
  rescue
    _ -> :ok
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

  @spec mark_in_cart(map(), [pos_integer()]) :: {:ok, map()} | {:error, term()}
  def mark_in_cart(user, item_ids) do
    MealPlannerApi.Cart.reserve(user, item_ids)
  end

  @spec mark_ingredient_in_cart(map(), binary(), Date.t(), Date.t()) ::
          {:ok, map()} | {:error, term()}
  def mark_ingredient_in_cart(user, ingredient_id, from_date, end_date) do
    MealPlannerApi.Cart.reserve_ingredient(user, ingredient_id, from_date, end_date)
  end

  @spec assign_supermarket(map(), pos_integer(), pos_integer()) :: {:ok, map()} | {:error, term()}
  def assign_supermarket(user, item_id, supermarket_id) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        case Shopping.list_items_by_ids(identity.account_id, [item_id]) do
          [item] ->
            case Shopping.update_shopping_item(item, %{assigned_supermarket_id: supermarket_id}) do
              {:ok, final_item} -> {:ok, serialize_shopping_item(final_item)}
              {:error, reason} -> {:error, reason}
            end

          [] ->
            {:error, :item_not_found}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec assign_ingredient_supermarket(map(), binary(), pos_integer(), Date.t(), Date.t()) ::
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
          Enum.map(items_to_update, fn item ->
            case Shopping.update_shopping_item(item, %{assigned_supermarket_id: supermarket_id}) do
              {:ok, updated_item} -> updated_item
              {:error, _} -> nil
            end
          end)
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

  @spec confirm_checkout(map(), pos_integer(), map()) :: {:ok, map()} | {:error, term()}
  def confirm_checkout(user, session_id, payload) do
    MealPlannerApi.Cart.purchase(user, session_id, payload)
  end

  # Date-range based checkout: create session from items in range
  @spec create_checkout_from_range(map(), Date.t(), Date.t(), String.t()) ::
          {:ok, map()} | {:error, term()}
  def create_checkout_from_range(_user, _start_date, _end_date, _checkout_type),
    do: {:error, :reservation_required}

  @spec confirm_delivery(map(), pos_integer()) :: {:ok, map()} | {:error, term()}
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
    ingredient = i.ingredient

    ingredient_map =
      cond do
        is_nil(ingredient) ->
          nil

        Map.has_key?(ingredient, :__struct__) and
            String.contains?(inspect(ingredient.__struct__), "NotLoaded") ->
          nil

        true ->
          ingredient
      end

    assigned_supermarket = i.assigned_supermarket

    supermarket_map =
      cond do
        is_nil(assigned_supermarket) ->
          nil

        Map.has_key?(assigned_supermarket, :__struct__) and
            String.contains?(inspect(assigned_supermarket.__struct__), "NotLoaded") ->
          nil

        true ->
          assigned_supermarket
      end

    category =
      case ingredient_map do
        %{category: cat} when cat != nil -> Atom.to_string(cat)
        _ -> nil
      end

    # Look up price options from supermarket catalog
    price_options =
      if i.ingredient_id do
        ShoppingRepo.list_prices_for_ingredient(i.ingredient_id)
        |> Enum.map(fn p ->
          %{supermarket_id: p.supermarket_id, price_cents: p.price_cents_ars}
        end)
      else
        []
      end

    %{
      id: i.id,
      ingredient_id: i.ingredient_id,
      ingredient_name: ingredient_map && ingredient_map.name,
      category: category,
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
      price_options: price_options
    }
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
