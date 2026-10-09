defmodule MealPlannerApi.Services.InventoryService do
  import Ecto.Query, warn: false

  @moduledoc """
  Orchestration layer for inventory management use-cases.

  Coordinates:
  - Inventory view (grouped by freshness and category)
  - Adding/removing inventory items
  - Voice parsing for natural language quantity updates
  - Delta application with mutation logging

  Delegates to VoiceParserPort for natural language parsing.
  Delegates to data repos for persistence.
  """

  alias MealPlannerApi.Inventory.LotFreshness
  alias MealPlannerApi.Persistence.Inventory, as: InventoryPersistence
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Voice.VoiceParserPort
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Persistence.Catalog.Ingredient

  @warning_days 2
  # The longest note a lot keeps, counted once trimmed. `InventoryItem` holds
  # the same bound.
  @max_notes_length 1_000

  @doc "Returns usable inventory for one account without changing inventory state."
  @spec list_for_account(Ecto.UUID.t(), Date.t()) :: [map()]
  def list_for_account(account_id, today \\ Date.utc_today()) do
    InventoryPersistence.list_inventory_with_ingredient(account_id)
    |> Enum.filter(fn item -> item.quantity_milli > 0 and LotFreshness.usable?(item, today) end)
  end

  # -------------------------------------------------------------------------
  # Inventory view
  # -------------------------------------------------------------------------

  @spec inventory_view(map()) :: {:ok, map()} | {:error, term()}
  def inventory_view(user) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user) do
      now = DateTime.utc_now()

      # A disposed or fully consumed lot is kept at quantity zero for the ledger;
      # it is not stock.
      decorated =
        identity.account_id
        |> InventoryPersistence.list_inventory_with_ingredient()
        |> Enum.filter(&(&1.quantity_milli > 0))
        |> Enum.map(&view_item(&1, now))

      {:ok,
       %{
         sections: %{
           ok: Enum.filter(decorated, &(&1.freshness == "ok")),
           warning: Enum.filter(decorated, &(&1.freshness == "warning")),
           expired: Enum.filter(decorated, &(&1.freshness == "expired"))
         },
         by_category: group_by_category(decorated),
         extras: Enum.filter(decorated, &(&1.source_kind == "extra")),
         totals: %{
           items_count: length(decorated),
           warning_count: Enum.count(decorated, &(&1.freshness == "warning")),
           expired_count: Enum.count(decorated, &(&1.freshness == "expired"))
         }
       }}
    end
  end

  defp view_item(item, now) do
    %{
      id: item.id,
      ingredient_id: item.ingredient_id,
      name: item.ingredient.name,
      category: Atom.to_string(item.ingredient.category),
      quantity_milli: item.quantity_milli,
      unit: Atom.to_string(item.unit),
      source_kind: Atom.to_string(item.source_kind),
      acquired_at: iso_datetime(item.acquired_at),
      # Always a date, whether the expiry is explicit or inferred.
      expires_at: item |> LotFreshness.effective_expiry(now) |> Date.to_iso8601(),
      freshness: freshness_status(item, now),
      is_leftover: item.is_leftover,
      notes: item.notes
    }
  end

  # The ledger row, named as its schema names it.
  defp view_mutation_event(event) do
    %{
      id: event.id,
      inventory_item_id: event.inventory_item_id,
      trigger_type: Atom.to_string(event.trigger_type),
      operation: Atom.to_string(event.operation),
      quantity_before_milli: event.quantity_before_milli,
      quantity_delta_milli: event.quantity_delta_milli,
      quantity_after_milli: event.quantity_after_milli,
      inserted_at: iso_datetime(event.inserted_at)
    }
  end

  defp view_written_item(result) do
    %{
      item: view_item(result.item, DateTime.utc_now()),
      mutation_event: view_mutation_event(result.mutation_event)
    }
  end

  @spec freshness_status(map(), DateTime.t()) :: String.t()
  def freshness_status(item, now), do: LotFreshness.status(item, now, @warning_days)

  # -------------------------------------------------------------------------
  # Manual operations
  # -------------------------------------------------------------------------

  @doc """
  Adds stock from outside the app as an `extra` lot and returns the resulting
  item with its mutation event.

  An add carrying an expiry, notes or a set leftover flag creates a lot of its
  own; an add with none of them accumulates in the anonymous lot.
  """
  @spec add_extra_item(map(), map()) :: {:ok, map()} | {:error, term()}
  def add_extra_item(user, payload) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, ingredient_id} <- resolve_ingredient_id(payload),
         {:ok, quantity_milli} <- parse_positive_int(param(payload, :quantity_milli)),
         {:ok, unit} <- parse_unit(param(payload, :unit)),
         {:ok, lot_metadata} <- lot_metadata_from_payload(payload),
         mutation_opts =
           Map.merge(
             %{
               account_id: identity.account_id,
               ingredient_id: ingredient_id,
               unit: unit,
               source_kind: :extra,
               delta: quantity_milli,
               source_user_id: identity.user_id,
               trigger_type: :manual,
               operation: :add,
               metadata: %{reason: "manual_extra"}
             },
             lot_metadata
           ),
         {:ok, result} <- InventoryPersistence.apply_delta_and_log(mutation_opts) do
      {:ok, view_written_item(result)}
    end
  end

  @doc "Sets the quantity of one lot and returns the resulting item with its mutation event."
  @spec adjust_item_quantity(map(), String.t(), map()) :: {:ok, map()} | {:error, term()}
  def adjust_item_quantity(user, item_id, payload) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, new_qty} <- parse_non_negative_int(param(payload, :quantity_milli)),
         {:ok, item_id} <- cast_item_id(item_id),
         {:ok, result} <-
           InventoryPersistence.apply_delta_and_log(%{
             account_id: identity.account_id,
             inventory_item_id: item_id,
             target_quantity_milli: new_qty,
             source_user_id: identity.user_id,
             trigger_type: :manual,
             operation: :set,
             metadata: %{reason: "manual_adjust", inventory_item_id: item_id}
           }) do
      {:ok, view_written_item(result)}
    else
      {:error, :item_not_found} -> {:error, :inventory_item_not_found}
      {:error, _} = error -> error
    end
  end

  # -------------------------------------------------------------------------
  # Voice parsing
  # -------------------------------------------------------------------------

  @spec parse_voice_and_apply(map(), String.t(), module()) :: {:ok, [map()]} | {:error, term()}
  def parse_voice_and_apply(user, text, parser \\ VoiceParserPort) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         items <- InventoryPersistence.list_inventory_with_ingredient(identity.account_id),
         {:ok, deltas} <- parser.parse(text, items) do
      results =
        Enum.map(deltas, fn delta ->
          InventoryPersistence.apply_delta_and_log(%{
            account_id: identity.account_id,
            ingredient_id: delta.inventory_item_id,
            unit: :g,
            source_kind: :extra,
            delta: delta.quantity_milli,
            source_user_id: identity.user_id,
            trigger_type: :voice,
            operation: if(delta.quantity_milli >= 0, do: :add, else: :subtract),
            raw_voice_text: text
          })
        end)

      ok_results =
        Enum.filter(results, fn
          {:ok, _} -> true
          _ -> false
        end)

      {:ok,
       Enum.map(ok_results, fn {:ok, r} ->
         %{
           ingredient_id: r.item.ingredient_id,
           quantity_delta_milli: r.delta,
           operation: r.mutation_event && Atom.to_string(r.mutation_event.operation)
         }
       end)}
    end
  end

  @spec get_inventory_item(map(), Ecto.UUID.t()) ::
          {:ok, map()} | {:error, :not_found}
  def get_inventory_item(user, item_id) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         item when not is_nil(item) <-
           InventoryPersistence.get_inventory_item_for_account(identity.account_id, item_id) do
      {:ok,
       %{
         id: item.id,
         ingredient_id: item.ingredient_id,
         ingredient_name: item.ingredient.name,
         quantity_milli: item.quantity_milli,
         unit: Atom.to_string(item.unit)
       }}
    else
      nil -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  # -------------------------------------------------------------------------
  # Helpers
  # -------------------------------------------------------------------------

  defp group_by_category(items) do
    Enum.group_by(items, & &1.category)
  end

  # -------------------------------------------------------------------------
  # Inventory mutations: dispose, voice, rescue
  # -------------------------------------------------------------------------

  @doc """
  Disposes of one lot. The row is kept at quantity zero, so its mutation
  events survive, and it leaves the inventory view.
  """
  @spec dispose_item(map(), String.t(), map()) :: {:ok, map()} | {:error, term()}
  def dispose_item(user, item_id, payload) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, item_id} <- cast_item_id(item_id),
         {:ok, result} <-
           InventoryPersistence.apply_delta_and_log(%{
             account_id: identity.account_id,
             inventory_item_id: item_id,
             target_quantity_milli: 0,
             source_user_id: identity.user_id,
             trigger_type: :manual,
             operation: :delete,
             metadata: %{
               reason: Map.get(payload, "reason") || Map.get(payload, :reason, "disposed"),
               inventory_item_id: item_id
             }
           }) do
      {:ok, %{disposed: true, mutation_event: view_mutation_event(result.mutation_event)}}
    else
      {:error, :item_not_found} -> {:error, :inventory_item_not_found}
      {:error, _} = error -> error
    end
  end

  @spec voice_preview(map(), map()) :: {:ok, map()} | {:error, term()}
  def voice_preview(user, payload) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         text when is_binary(text) <- Map.get(payload, "text"),
         items <- InventoryPersistence.list_inventory_with_ingredient(identity.account_id) do
      ops = parse_voice_operations_internally(text, items)

      {:ok,
       %{
         raw_text: text,
         operations: ops,
         confirmation_required: true
       }}
    else
      _ -> {:error, :invalid_voice_payload}
    end
  end

  @spec voice_apply(map(), map()) :: {:ok, map()} | {:error, term()}
  def voice_apply(user, payload) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         operations when is_list(operations) <-
           Map.get(payload, "operations") || Map.get(payload, :operations) do
      moved =
        Enum.reduce_while(operations, 0, fn op, acc ->
          item_id = Map.get(op, "inventory_item_id") || Map.get(op, :inventory_item_id)
          qty = Map.get(op, "quantity_milli") || Map.get(op, :quantity_milli)

          cond do
            is_nil(item_id) or not is_integer(qty) or qty <= 0 ->
              {:cont, acc}

            true ->
              case InventoryPersistence.apply_delta_and_log(%{
                     account_id: identity.account_id,
                     inventory_item_id: item_id,
                     delta: -qty,
                     source_user_id: identity.user_id,
                     trigger_type: :voice,
                     operation: :subtract,
                     raw_voice_text: Map.get(payload, "raw_text") || Map.get(payload, :raw_text),
                     metadata: %{inventory_item_id: item_id}
                   }) do
                {:ok, _} -> {:cont, acc + 1}
                {:error, :item_not_found} -> {:cont, acc}
                {:error, _} -> {:halt, acc}
              end
          end
        end)

      {:ok, %{status: "ok", applied_operations: moved}}
    else
      _ -> {:error, :invalid_voice_payload}
    end
  end

  @spec rescue_plan(map(), map(), MealPlannerApi.Budgets.Budget.t()) ::
          {:ok, map()} | {:error, term()}
  def rescue_plan(user, payload, _budget) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         ingredient_ids <- normalize_rescue_ingredient_ids(payload),
         false <- ingredient_ids == [],
         {:ok, recipe} <- pick_rescue_recipe(identity.account_id, ingredient_ids),
         {:ok, slot} <- first_available_slot(identity.account_id, Date.utc_today()),
         {:ok, scheduled} <-
           PlanningRepo.schedule_meal(%{
             account_id: identity.account_id,
             user_id: identity.user_id,
             date: Date.utc_today(),
             slot: slot,
             recipe_id: recipe.id,
             is_cooked: false
           }) do
      {:ok,
       %{
         status: "scheduled",
         scheduled_meal_id: scheduled.id,
         date: Date.to_iso8601(scheduled.date),
         slot: Atom.to_string(slot),
         recipe: %{id: recipe.id, name: recipe.name},
         rescued_ingredient_ids: ingredient_ids
       }}
    else
      true -> {:error, :no_ingredients_selected}
      {:error, _} = error -> error
      nil -> {:error, :no_rescue_recipe_found}
      _ -> {:error, :no_available_slot_today}
    end
  end

  # -------------------------------------------------------------------------
  # Private helpers
  # -------------------------------------------------------------------------

  defp parse_voice_operations_internally(text, items) do
    # Simple rule-based fallback parsing for voice operations
    fallback_parse_voice_operations(text, items)
  end

  defp fallback_parse_voice_operations(text, items) do
    lowered = String.downcase(text)

    # Spanish eating patterns
    spanish_eat_patterns = [
      "me comi",
      "me com\xED",
      "me comiera",
      "me comer\xED",
      "com\xED",
      "com\xED",
      "comiendo",
      "me terminé",
      "me termine",
      "me acabé",
      "consum\xed",
      "consumi",
      "consumiendo",
      "us\xe9",
      "use",
      "usando",
      "gast\xe9",
      "gaste",
      "gastando"
    ]

    # English patterns
    english_eat_patterns = [
      "use",
      "consume",
      "ate",
      "eaten",
      "finished",
      "used up",
      "consumed",
      "finished eating"
    ]

    all_patterns = spanish_eat_patterns ++ english_eat_patterns

    has_eating = Enum.any?(all_patterns, &String.contains?(lowered, &1))

    items
    |> Enum.map(fn item ->
      name = item.ingredient.name |> String.downcase()
      qty = item.quantity_milli

      # Check if item name is mentioned near eating pattern
      name_mentioned = String.contains?(lowered, name)

      # Check if any generic quantity is mentioned
      half_patterns = ["medio", "half", "la mitad", "mitad"]
      quarter_patterns = ["cuarto", "quarter", "un cuarto"]

      quantity_multiplier =
        cond do
          Enum.any?(half_patterns, &String.contains?(lowered, &1)) -> 0.5
          Enum.any?(quarter_patterns, &String.contains?(lowered, &1)) -> 0.25
          true -> 1.0
        end

      if has_eating and name_mentioned do
        %{
          "inventory_item_id" => item.id,
          "quantity_milli" => floor(qty * quantity_multiplier)
        }
      else
        nil
      end
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_rescue_ingredient_ids(payload) do
    case Map.get(payload, "ingredient_ids") do
      ids when is_list(ids) -> ids
      _ -> []
    end
  end

  defp pick_rescue_recipe(_account_id, _ingredient_ids) do
    # Find ANY recipe from the database for rescue
    # This is a fallback for when no account-specific recipe exists
    try do
      recipes = MealPlannerApi.Repo.all(MealPlannerApi.Persistence.Catalog.Recipe)

      case recipes do
        [] -> {:error, :no_rescue_recipe_found}
        [first | _] -> {:ok, first}
      end
    rescue
      _ -> {:error, :no_rescue_recipe_found}
    end
  end

  defp first_available_slot(_account_id, _date) do
    # Default to dinner slot for rescue
    {:ok, :dinner}
  end

  defp iso_datetime(nil), do: nil
  defp iso_datetime(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp iso_datetime(%Date{} = d), do: Date.to_iso8601(d)
  defp iso_datetime(other), do: other

  defp param(payload, key), do: Map.get(payload, key) || Map.get(payload, Atom.to_string(key))

  # A lot id that is not a UUID cannot name a lot, so it is not found rather
  # than a query error.
  defp cast_item_id(item_id) do
    case Ecto.UUID.cast(item_id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :inventory_item_not_found}
    end
  end

  # By id when the payload names one, else by exact name.
  defp resolve_ingredient_id(payload) do
    case {param(payload, :ingredient_id), param(payload, :ingredient_name)} do
      {nil, name} when is_binary(name) ->
        case MealPlannerApi.Repo.get_by(Ingredient, name: name) do
          nil -> {:error, :ingredient_not_found}
          ingredient -> {:ok, ingredient.id}
        end

      {nil, _missing_or_invalid} ->
        {:error, :missing_ingredient}

      {id, _name} ->
        with {:ok, uuid} <- Ecto.UUID.cast(id),
             %Ingredient{} <- MealPlannerApi.Repo.get(Ingredient, uuid) do
          {:ok, uuid}
        else
          :error -> {:error, :invalid_ingredient_id}
          nil -> {:error, :ingredient_not_found}
        end
    end
  end

  defp parse_positive_int(nil), do: {:error, :missing_quantity}
  defp parse_positive_int(n) when is_integer(n) and n > 0, do: {:ok, n}

  defp parse_positive_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} when n > 0 -> {:ok, n}
      _ -> {:error, :invalid_quantity}
    end
  end

  defp parse_positive_int(_), do: {:error, :invalid_quantity}

  defp parse_non_negative_int(nil), do: {:error, :missing_quantity}
  defp parse_non_negative_int(n) when is_integer(n) and n >= 0, do: {:ok, n}

  defp parse_non_negative_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} when n >= 0 -> {:ok, n}
      _ -> {:error, :invalid_quantity}
    end
  end

  defp parse_non_negative_int(_), do: {:error, :invalid_quantity}

  # The lot fields an add may carry. `expires_at` is the name on the wire; the
  # column is `expired_at`.
  defp lot_metadata_from_payload(payload) do
    with {:ok, expired_at} <- parse_expires_at(param(payload, :expires_at)),
         {:ok, notes} <- parse_notes(param(payload, :notes)),
         {:ok, is_leftover} <- parse_is_leftover(param(payload, :is_leftover)) do
      metadata =
        %{
          acquired_at: param(payload, :acquired_at),
          acquired_price_cents: param(payload, :acquired_price_cents),
          expired_at: expired_at,
          notes: notes
        }
        |> Map.reject(fn {_key, value} -> is_nil(value) end)
        |> Map.put(:is_leftover, is_leftover)

      {:ok, metadata}
    end
  end

  # An ISO date expires at the start of that day in UTC; freshness only reads
  # the date.
  defp parse_expires_at(nil), do: {:ok, nil}
  defp parse_expires_at(%DateTime{} = datetime), do: {:ok, datetime}
  defp parse_expires_at(%Date{} = date), do: {:ok, DateTime.new!(date, ~T[00:00:00], "Etc/UTC")}

  defp parse_expires_at(value) when is_binary(value) do
    with {:error, _} <- Date.from_iso8601(value),
         {:error, _} <- DateTime.from_iso8601(value) do
      {:error, :invalid_expires_at}
    else
      {:ok, %Date{} = date} -> parse_expires_at(date)
      {:ok, %DateTime{} = datetime, _offset} -> {:ok, datetime}
    end
  end

  defp parse_expires_at(_), do: {:error, :invalid_expires_at}

  defp parse_notes(nil), do: {:ok, nil}

  defp parse_notes(notes) when is_binary(notes) do
    trimmed = String.trim(notes)

    cond do
      trimmed == "" -> {:ok, nil}
      String.length(trimmed) > @max_notes_length -> {:error, :invalid_notes}
      true -> {:ok, trimmed}
    end
  end

  defp parse_notes(_), do: {:error, :invalid_notes}

  defp parse_is_leftover(nil), do: {:ok, false}
  defp parse_is_leftover(flag) when is_boolean(flag), do: {:ok, flag}
  defp parse_is_leftover(_), do: {:error, :invalid_is_leftover}

  defp parse_unit(nil), do: {:error, :missing_unit}
  defp parse_unit(:g), do: {:ok, :g}
  defp parse_unit("g"), do: {:ok, :g}
  defp parse_unit(:grams), do: {:ok, :g}
  defp parse_unit("grams"), do: {:ok, :g}
  defp parse_unit(:ml), do: {:ok, :ml}
  defp parse_unit("ml"), do: {:ok, :ml}
  defp parse_unit(:unit), do: {:ok, :unit}
  defp parse_unit("unit"), do: {:ok, :unit}
  defp parse_unit(:units), do: {:ok, :unit}
  defp parse_unit("units"), do: {:ok, :unit}
  defp parse_unit(_), do: {:error, :invalid_unit}
end
