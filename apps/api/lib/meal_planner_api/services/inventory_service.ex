defmodule MealPlannerApi.Services.InventoryService do
  import Ecto.Query, warn: false

  @moduledoc """
  Orchestration layer for inventory management use-cases.

  Coordinates:
  - Inventory view (grouped by freshness and category)
  - Adding/removing inventory items
  - Voice adjustment: a spoken subtract, previewed then applied
  - Delta application with mutation logging

  Delegates to InventoryIntentParser for natural language parsing.
  Delegates to data repos for persistence.
  """

  alias MealPlannerApi.Inventory.LotFreshness
  alias MealPlannerApi.Persistence.Inventory, as: InventoryPersistence
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Voice.InventoryIntentParser
  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Repo
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

  @spec get_inventory_item(map(), pos_integer() | String.t()) ::
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

  # -------------------------------------------------------------------------
  # Voice adjustment
  # -------------------------------------------------------------------------

  @doc """
  Reads a spoken transcript into one subtract intent against the Account's
  usable stock, with a confidence and whether the User must confirm it
  before it is applied. Writes nothing.
  """
  @spec voice_preview(map(), map()) :: {:ok, map()} | {:error, term()}
  def voice_preview(user, payload) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, transcript} <- voice_transcript(payload),
         {:ok, parsed} <-
           InventoryIntentParser.parse(transcript, usable_stock(identity.account_id)) do
      {:ok,
       %{
         confirmation_required: InventoryIntentParser.confirmation_required?(parsed.confidence),
         intent: view_voice_intent(parsed.intent),
         confidence: parsed.confidence
       }}
    end
  end

  @doc """
  Subtracts a previewed intent from inventory, FEFO across the ingredient's
  lots, and logs each lot's mutation as a voice event carrying the transcript.

  The confidence is derived again from the transcript here; a client value is
  never read. An intent that is not confident, or that differs from what the
  transcript says, needs `confirmed: true`. The subtraction is capped at the
  stock, so inventory never goes negative.
  """
  @spec voice_apply(map(), map()) :: {:ok, map()} | {:error, term()}
  def voice_apply(user, payload) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, transcript} <- voice_transcript(payload),
         {:ok, intent} <- voice_intent(param(payload, :intent)),
         stock = usable_stock(identity.account_id),
         {:ok, parsed} <- InventoryIntentParser.parse(transcript, stock),
         :ok <- check_voice_confirmation(parsed, intent, param(payload, :confirmed)),
         {:ok, entry} <- voice_stock_entry(stock, intent) do
      subtract_voice(identity, entry, min(intent.quantity_milli, entry.total_milli), transcript)
    end
  end

  defp voice_transcript(payload) do
    case param(payload, :transcript) do
      transcript when is_binary(transcript) ->
        if String.trim(transcript) == "",
          do: {:error, :invalid_voice_payload},
          else: {:ok, transcript}

      _ ->
        {:error, :invalid_voice_payload}
    end
  end

  defp voice_intent(%{} = intent) do
    with "subtract" <- stringify_operation(param(intent, :operation)),
         quantity when is_integer(quantity) and quantity > 0 <- param(intent, :quantity_milli),
         {:ok, ingredient_id} <- Ecto.UUID.cast(param(intent, :ingredient_id) || :error) do
      {:ok,
       %{
         ingredient_id: ingredient_id,
         quantity_milli: quantity,
         unit: param(intent, :unit)
       }}
    else
      _ -> {:error, :invalid_voice_payload}
    end
  end

  defp voice_intent(_), do: {:error, :invalid_voice_payload}

  defp stringify_operation(operation) when is_atom(operation) and not is_nil(operation),
    do: Atom.to_string(operation)

  defp stringify_operation(operation), do: operation

  # Only an explicit `true` confirms; "true" and 1 do not.
  defp check_voice_confirmation(parsed, intent, confirmed) do
    edited? =
      parsed.intent.ingredient_id != intent.ingredient_id or
        parsed.intent.quantity_milli != intent.quantity_milli

    if (InventoryIntentParser.confirmation_required?(parsed.confidence) or edited?) and
         confirmed != true,
       do: {:error, :voice_confirmation_required},
       else: :ok
  end

  # The unit the intent names, else the unit the transcript would use.
  defp voice_stock_entry(stock, intent) do
    candidates = Enum.filter(stock, &(&1.ingredient_id == intent.ingredient_id))

    entry =
      Enum.find(candidates, &(Atom.to_string(&1.unit) == intent.unit)) ||
        if(is_nil(intent.unit), do: Enum.max_by(candidates, & &1.total_milli, fn -> nil end))

    if entry, do: {:ok, entry}, else: {:error, :inventory_item_not_found}
  end

  defp subtract_voice(identity, entry, quantity_milli, transcript) do
    today = AccountClock.today(identity.account_id)

    Repo.transaction(fn ->
      {remaining, events} =
        Enum.reduce_while([:planned, :extra], {quantity_milli, []}, fn source_kind,
                                                                       {remaining, events} ->
          available = source_total(identity.account_id, entry, source_kind, today)
          take = min(remaining, available)

          cond do
            remaining == 0 ->
              {:halt, {remaining, events}}

            take == 0 ->
              {:cont, {remaining, events}}

            true ->
              case InventoryPersistence.subtract_usable_lots_and_log(%{
                     account_id: identity.account_id,
                     ingredient_id: entry.ingredient_id,
                     unit: entry.unit,
                     source_kind: source_kind,
                     delta: -take,
                     today: today,
                     source_user_id: identity.user_id,
                     trigger_type: :voice,
                     operation: :subtract,
                     raw_voice_text: transcript,
                     metadata: %{reason: "voice_adjust"}
                   }) do
                {:ok, result} ->
                  {:cont, {remaining + result.delta, events ++ result.mutation_events}}

                {:error, reason} ->
                  Repo.rollback(reason)
              end
          end
        end)

      %{
        ingredient_id: entry.ingredient_id,
        quantity_delta_milli: remaining - quantity_milli,
        mutation_events: Enum.map(events, &view_mutation_event/1)
      }
    end)
  end

  defp source_total(account_id, entry, source_kind, today) do
    account_id
    |> usable_lots()
    |> Enum.filter(
      &(&1.ingredient_id == entry.ingredient_id and &1.unit == entry.unit and
          &1.source_kind == source_kind and LotFreshness.usable?(&1, today))
    )
    |> Enum.map(& &1.quantity_milli)
    |> Enum.sum()
  end

  # What the User can still use, per ingredient and unit.
  defp usable_stock(account_id) do
    account_id
    |> usable_lots()
    |> Enum.group_by(&{&1.ingredient_id, &1.unit})
    |> Enum.map(fn {{ingredient_id, unit}, lots} ->
      %{
        ingredient_id: ingredient_id,
        name: hd(lots).ingredient.name,
        unit: unit,
        total_milli: lots |> Enum.map(& &1.quantity_milli) |> Enum.sum()
      }
    end)
  end

  defp usable_lots(account_id) do
    today = AccountClock.today(account_id)

    account_id
    |> InventoryPersistence.list_inventory_with_ingredient()
    |> Enum.filter(&(&1.quantity_milli > 0 and LotFreshness.usable?(&1, today)))
  end

  defp view_voice_intent(intent) do
    %{
      operation: Atom.to_string(intent.operation),
      ingredient_id: intent.ingredient_id,
      name: intent.name,
      quantity_milli: intent.quantity_milli,
      unit: Atom.to_string(intent.unit)
    }
  end

  @spec rescue_plan(map(), map(), BudgetService.t()) :: {:ok, map()} | {:error, term()}
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
