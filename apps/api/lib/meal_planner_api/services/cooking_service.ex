defmodule MealPlannerApi.Services.CookingService do
  @moduledoc """
  Runtime cooking orchestration with contextual AI assistant.

  Coordinates:
  - Session lifecycle (start, state, finish)
  - Step tracking with snapshot persistence
  - Ephemeral questions with contextual AI answers (no transcript storage)
  - Inventory deduction on session completion

  Stateless service — all DB via PlanningRepo and InventoryRepo.
  """

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.AI
  alias MealPlannerApi.Data.{InventoryRepo, PlanningRepo}
  alias MealPlannerApi.Services.{RecipeAccess, RecipeVersions}
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo

  @type step_status :: :started | :paused | :completed | :error

  # -------------------------------------------------------------------------
  # Session lifecycle
  # -------------------------------------------------------------------------

  @doc """
  Starts a Cooking session for a Scheduled meal of the Account.

  A meal is eligible only on the Account's today (`AccountClock`), judged at
  `now`, so moving a meal to today makes it eligible. Any other day is
  `{:error, :cooking_chat_unavailable}`.
  """
  @spec start_session(map(), binary(), DateTime.t()) :: {:ok, map()} | {:error, term()}
  def start_session(current_user, scheduled_meal_id, now \\ DateTime.utc_now())
      when is_binary(scheduled_meal_id) do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, meal_id} <- cast_id(scheduled_meal_id, :scheduled_meal_not_found),
         meal when not is_nil(meal) <-
           PlanningRepo.get_scheduled_meal_for_account(ids.account_id, meal_id),
         :ok <- planned_meal(meal, ids.account_id),
         :ok <- meal_is_today(meal, ids.account_id, now),
         {:ok, session} <- create_session(ids, meal) do
      snapshot = PlanningRepo.latest_context_snapshot(session.id)
      # Preload scheduled_meal on session for serialization
      session = PlanningRepo.get_cooking_session_for_account(ids.account_id, session.id)
      {:ok, serialize_session_payload(session, snapshot)}
    else
      nil -> {:error, :scheduled_meal_not_found}
      {:error, %Ecto.Changeset{}} -> {:error, :validation_error}
      {:error, _} = error -> error
    end
  end

  @spec session_state(map(), binary()) :: {:ok, map()} | {:error, term()}
  def session_state(current_user, session_id) when is_binary(session_id) do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, session_id} <- cast_id(session_id, :session_not_found),
         session when not is_nil(session) <-
           PlanningRepo.get_cooking_session_for_account(ids.account_id, session_id),
         :ok <- planned_meal(session.scheduled_meal, ids.account_id) do
      snapshot = PlanningRepo.latest_context_snapshot(session.id)
      {:ok, serialize_session_payload(session, snapshot)}
    else
      nil -> {:error, :session_not_found}
      {:error, _} = error -> error
    end
  end

  @doc """
  Finishes a Cooking session atomically: the meal is marked cooked, the
  recipe's Ingredients are consumed from Inventory oldest lot first (clamped at
  zero), and the meal's open Shopping items are removed.

  Returns the meal, one mutation per lot touched and one shortage per
  Ingredient the stock could not cover. A session that already finished, or a
  meal that is already cooked, is `{:error, :cooking_already_finished}` and
  changes nothing. Lot usability uses the Account's today at `now`.
  """
  @spec finish_session(map(), binary(), DateTime.t()) :: {:ok, map()} | {:error, term()}
  def finish_session(current_user, session_id, now \\ DateTime.utc_now())
      when is_binary(session_id) do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, session_id} <- cast_id(session_id, :session_not_found) do
      persist_finish(ids, session_id, AccountClock.today(ids.account_id, now))
    end
  end

  # -------------------------------------------------------------------------
  # Step tracking
  # -------------------------------------------------------------------------

  @spec track_step(map(), binary(), binary(), step_status(), map()) ::
          {:ok, map()} | {:error, term()}
  def track_step(current_user, session_id, recipe_step_id, status, extra \\ %{})
      when is_binary(session_id) and is_binary(recipe_step_id) and
             status in [:started, :paused, :completed, :error] do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, session_id} <- cast_id(session_id, :session_not_found),
         session when not is_nil(session) <-
           PlanningRepo.get_cooking_session_for_account(ids.account_id, session_id),
         :ok <- active_session(session),
         true <- belongs_to_recipe?(session, recipe_step_id),
         {:ok, event} <-
           PlanningRepo.add_step_event(%{
             cooking_session_id: session.id,
             recipe_step_id: recipe_step_id,
             event_type: status,
             event_at: DateTime.utc_now()
           }),
         snapshot_data <- build_snapshot_data(session, recipe_step_id, status, extra),
         {:ok, snapshot} <-
           PlanningRepo.add_context_snapshot(%{
             cooking_session_id: session.id,
             snapshot_data: snapshot_data,
             captured_at: DateTime.utc_now()
           }) do
      {:ok,
       %{
         session_id: session.id,
         recipe_step_id: recipe_step_id,
         status: Atom.to_string(event.event_type),
         snapshot: snapshot.snapshot_data
       }}
    else
      nil -> {:error, :session_not_found}
      false -> {:error, :recipe_step_not_found}
      {:error, %Ecto.Changeset{}} -> {:error, :validation_error}
      {:error, _} = error -> error
    end
  end

  # -------------------------------------------------------------------------
  # Chat / AI answers
  # -------------------------------------------------------------------------

  @spec answer_question(map(), binary(), binary(), String.t()) :: {:ok, map()} | {:error, term()}
  def answer_question(current_user, session_id, message, content_type \\ "text")
      when is_binary(session_id) and is_binary(message) and is_binary(content_type) do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, session_id} <- cast_id(session_id, :session_not_found),
         session when not is_nil(session) <-
           PlanningRepo.get_cooking_session_for_account(ids.account_id, session_id),
         :ok <- active_session(session),
         current_snapshot <- PlanningRepo.latest_context_snapshot(session.id),
         assistant_text <-
           build_contextual_answer(session, current_snapshot, message, content_type),
         {:ok, _ids} <- RecipeAccess.authorize(current_user),
         :ok <-
           active_session(
             PlanningRepo.get_cooking_session_for_account(ids.account_id, session_id)
           ) do
      {:ok,
       %{
         session_id: session.id,
         message: assistant_text,
         content_type: "text",
         step_context: snapshot_step_context(current_snapshot)
       }}
    else
      nil -> {:error, :session_not_found}
      {:error, _} = error -> error
    end
  end

  defp active_session(%{status: :active} = session),
    do: planned_meal(session.scheduled_meal, session.account_id)

  defp active_session(_), do: {:error, :cooking_session_not_active}

  defp planned_meal(
         %{account_id: account_id, recipe_version_id: version_id, recipe_snapshot: snapshot},
         account_id
       )
       when is_binary(version_id) and is_map(snapshot), do: :ok

  defp planned_meal(_, _), do: {:error, :scheduled_meal_not_found}

  defp meal_is_today(%{date: date}, account_id, now) do
    if Date.compare(date, AccountClock.today(account_id, now)) == :eq,
      do: :ok,
      else: {:error, :cooking_chat_unavailable}
  end

  # A malformed id cannot name a record, so it reads as the record's absence.
  defp cast_id(id, not_found) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, not_found}
    end
  end

  # -------------------------------------------------------------------------
  # Private helpers
  # -------------------------------------------------------------------------

  defp create_session(ids, meal) do
    recipe = RecipeVersions.recipe_for_meal(meal)

    first_step_id =
      recipe &&
        recipe.recipe_steps
        |> Enum.sort_by(& &1.step_number)
        |> List.first()
        |> case do
          nil -> nil
          step -> step.id
        end

    initial_snapshot = %{
      "current_step_id" => first_step_id,
      "step_status" => "started",
      "timers" => %{},
      "view" => "recipe"
    }

    result =
      Planning.create_cooking_session(%{
        account_id: ids.account_id,
        scheduled_meal_id: meal.id,
        status: :active,
        started_at: DateTime.utc_now(),
        context_snapshot: initial_snapshot
      })

    with {:ok, session} <- result do
      # Capture the initial context snapshot
      {:ok, _snapshot} =
        PlanningRepo.add_context_snapshot(%{
          cooking_session_id: session.id,
          snapshot_data: initial_snapshot,
          captured_at: DateTime.utc_now()
        })

      # Record the first step event if a step exists
      if first_step_id do
        {:ok, _event} =
          PlanningRepo.add_step_event(%{
            cooking_session_id: session.id,
            recipe_step_id: first_step_id,
            event_type: :started,
            event_at: DateTime.utc_now()
          })
      end

      {:ok, session}
    else
      {:error, _} = error -> error
    end
  end

  defp persist_finish(ids, session_id, today) do
    Repo.transaction(fn ->
      session =
        PlanningRepo.lock_cooking_session_for_account(ids.account_id, session_id) ||
          Repo.rollback(:session_not_found)

      case session.status do
        :completed -> Repo.rollback(:cooking_already_finished)
        status when status in [:active, :paused] -> :ok
        _ -> Repo.rollback(:cooking_session_not_active)
      end

      meal =
        PlanningRepo.lock_cooking_meal_for_account(ids.account_id, session.scheduled_meal_id) ||
          Repo.rollback(:scheduled_meal_not_found)

      case planned_meal(meal, ids.account_id) do
        :ok -> :ok
        {:error, reason} -> Repo.rollback(reason)
      end

      # The meal can have been marked cooked outside a session (calendar).
      if meal.is_cooked, do: Repo.rollback(:cooking_already_finished)

      {mutations, shortages} = deduct_ingredients(ids, session, meal, today)
      Shopping.delete_open_items_for_meal(ids.account_id, meal.id)

      with {:ok, cooked} <- PlanningRepo.update_scheduled_meal(meal, %{is_cooked: true}),
           {:ok, _completed} <-
             PlanningRepo.update_cooking_session(session, %{
               status: :completed,
               completed_at: DateTime.utc_now()
             }) do
        %{
          scheduled_meal: serialize_finished_meal(cooked, meal),
          inventory_mutations: mutations,
          shortages: shortages
        }
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  # A cooked meal is never skipped, so the flag is fixed to false.
  defp serialize_finished_meal(cooked, locked) do
    recipe = RecipeVersions.recipe_for_meal(locked)

    %{
      id: cooked.id,
      date: Date.to_iso8601(cooked.date),
      slot: Atom.to_string(cooked.slot),
      is_cooked: cooked.is_cooked,
      is_skipped: false,
      recipe_id: cooked.recipe_id,
      recipe_version_id: cooked.recipe_version_id,
      selected_quantity: cooked.selected_quantity,
      recipe_name: recipe && recipe.name
    }
  end

  defp deduct_ingredients(ids, session, meal, today) do
    recipe = RecipeVersions.recipe_for_meal(meal)
    ingredients = (recipe && recipe.recipe_ingredients) || []

    # All cooking transactions acquire ingredient locks in the same order.
    # Nested inventory transactions share this transaction, including their audit writes.
    {mutations, shortages} =
      ingredients
      |> Enum.sort_by(&{&1.ingredient_id, &1.unit})
      |> Enum.reduce({[], []}, fn ingredient, {mutations, shortages} ->
        requested = ingredient.quantity_milli

        case InventoryRepo.apply_delta(%{
               account_id: ids.account_id,
               ingredient_id: ingredient.ingredient_id,
               unit: ingredient.unit,
               source_kind: :planned,
               delta: -requested,
               today: today,
               source_user_id: ids.user_id,
               source_cooking_session_id: session.id,
               trigger_type: :cooking,
               operation: :subtract,
               metadata: %{scheduled_meal_id: session.scheduled_meal_id}
             }) do
          {:ok, result} ->
            applied = -result.delta
            lot_mutations = Enum.map(result.item_states, &serialize_mutation(&1, ingredient))

            {[lot_mutations | mutations],
             maybe_shortage(shortages, ingredient, requested, applied)}

          {:error, _reason} ->
            Repo.rollback(:inventory_mutation_failed)
        end
      end)

    {mutations |> Enum.reverse() |> List.flatten(), Enum.reverse(shortages)}
  end

  defp serialize_mutation(state, ingredient) do
    %{
      inventory_item_id: state.item.id,
      ingredient_id: ingredient.ingredient_id,
      ingredient_name: ingredient.ingredient && ingredient.ingredient.name,
      unit: Atom.to_string(ingredient.unit),
      quantity_before_milli: state.before_qty,
      quantity_delta_milli: state.delta,
      quantity_after_milli: state.after_qty
    }
  end

  defp maybe_shortage(shortages, _ingredient, requested, applied) when applied >= requested,
    do: shortages

  defp maybe_shortage(shortages, ingredient, requested, applied) do
    [
      %{
        ingredient_id: ingredient.ingredient_id,
        ingredient_name: ingredient.ingredient && ingredient.ingredient.name,
        unit: Atom.to_string(ingredient.unit),
        requested_milli: requested,
        missing_milli: requested - applied
      }
      | shortages
    ]
  end

  defp belongs_to_recipe?(session, recipe_step_id) do
    recipe = RecipeVersions.recipe_for_meal(session.scheduled_meal)
    recipe && Enum.any?(recipe.recipe_steps, &(&1.id == recipe_step_id))
  end

  defp build_snapshot_data(session, recipe_step_id, status, extra) do
    previous = session.context_snapshot || %{}

    previous
    |> Map.merge(%{
      "current_step_id" => recipe_step_id,
      "step_status" => Atom.to_string(status),
      "updated_at" => DateTime.utc_now() |> DateTime.to_iso8601()
    })
    |> maybe_put("timers", extra["timers"])
    |> maybe_put("view", extra["view"])
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp build_contextual_answer(session, snapshot, question, content_type) do
    recipe = session.scheduled_meal && RecipeVersions.recipe_for_meal(session.scheduled_meal)

    step_text =
      if recipe do
        current_step_id = snapshot_step_context(snapshot)
        step = Enum.find(recipe.recipe_steps, &(&1.id == current_step_id))

        if step do
          "Paso actual #{step.step_number}: #{step.instructions}."
        else
          "No tengo paso activo, te guio con la receta completa."
        end
      else
        "Tenes una sesion de cocina activa."
      end

    system_prompt = build_system_prompt(recipe, step_text, content_type)

    case AI.generate_text(question, system_prompt: system_prompt) do
      {:ok, text} ->
        text

      {:error, _reason} ->
        fallback_answer(question, content_type, recipe && recipe.name, step_text)
    end
  end

  defp build_system_prompt(recipe, step_text, content_type) do
    voice_mode = if content_type == "speech_transcript", do: "si", else: "no"
    recipe_name = (recipe && recipe.name) || "receta sin nombre"

    steps_text =
      if recipe && recipe.recipe_steps do
        recipe.recipe_steps
        |> Enum.sort_by(& &1.step_number)
        |> Enum.map(fn step -> "#{step.step_number}. #{step.instructions}" end)
        |> Enum.join("\n")
      else
        "Sin pasos disponibles"
      end

    ingredients_text =
      if recipe && recipe.recipe_ingredients do
        recipe.recipe_ingredients
        |> Enum.map(fn ri ->
          name = (ri.ingredient && ri.ingredient.name) || "ingrediente"
          "- #{name}: #{ri.quantity_milli} #{ri.unit}"
        end)
        |> Enum.join("\n")
      else
        "Sin ingredientes disponibles"
      end

    """
    Eres el asistente culinario de MyFood.
    El usuario esta cocinando la receta: #{recipe_name}.
    Modo voz: #{voice_mode}.
    #{step_text}

    Ingredientes de la receta:
    #{ingredients_text}

    Pasos oficiales de la receta:
    #{steps_text}

    Responde basandote estrictamente en esta receta.
    Da una respuesta breve, accionable y segura para cocina.
    Si falta informacion, dilo sin inventar.
    """
  end

  defp fallback_answer(question, content_type, recipe_name, step_text) do
    prefix = if content_type == "speech_transcript", do: "Entendido por voz", else: "Entendido"
    name = recipe_name || "una receta"

    "#{prefix}. Estas cocinando #{name}. #{step_text} #{brief_guidance(question)}"
  end

  defp brief_guidance(question) do
    lowered = String.downcase(question)

    cond do
      String.contains?(lowered, "salsa") ->
        "Manten fuego bajo a medio y agrega liquido de a poco para que no se pegue."

      String.contains?(lowered, "sal") ->
        "Agrega sal gradualmente, mezcla y prueba antes de corregir otra vez."

      String.contains?(lowered, "quemado") or String.contains?(lowered, "pegado") ->
        "Retira lo que puedas, raspá el fondo y agregá liquido. Revolvé constantemente."

      true ->
        "Segui el paso actual y ajustá de a una variable: fuego, liquido o tiempo."
    end
  end

  defp snapshot_step_context(nil), do: nil

  defp snapshot_step_context(snapshot) do
    (snapshot && snapshot.snapshot_data && snapshot.snapshot_data["current_step_id"]) ||
      (snapshot && snapshot.snapshot_data && snapshot.snapshot_data["current_step_id"]) ||
      nil
  end

  # -------------------------------------------------------------------------
  # Serialization
  # -------------------------------------------------------------------------

  defp serialize_session_payload(session, latest_snapshot) do
    scheduled_meal =
      case session.scheduled_meal do
        %Ecto.Association.NotLoaded{} -> nil
        sm -> sm
      end

    recipe =
      scheduled_meal &&
        case RecipeVersions.recipe_for_meal(scheduled_meal) do
          %Ecto.Association.NotLoaded{} -> nil
          r -> r
        end

    %{
      session_id: session.id,
      scheduled_meal_id: session.scheduled_meal_id,
      recipe_version_id: scheduled_meal && scheduled_meal.recipe_version_id,
      selected_quantity: scheduled_meal && scheduled_meal.selected_quantity,
      status: Atom.to_string(session.status),
      slot:
        (scheduled_meal &&
           case scheduled_meal.slot do
             nil -> "unknown"
             atom when is_atom(atom) -> Atom.to_string(atom)
             string when is_binary(string) -> string
             _ -> "unknown"
           end) || "unknown",
      recipe:
        if recipe do
          %{
            id: recipe.id,
            name: recipe.name,
            steps: serialize_steps(recipe.recipe_steps),
            ingredients: serialize_ingredients(recipe.recipe_ingredients)
          }
        else
          %{id: nil, name: nil, steps: [], ingredients: []}
        end,
      snapshot:
        (latest_snapshot && latest_snapshot.snapshot_data) ||
          session.context_snapshot ||
          %{},
      chat_messages: []
    }
  end

  defp serialize_steps(nil), do: []
  defp serialize_steps(%Ecto.Association.NotLoaded{}), do: []

  defp serialize_steps(steps) do
    steps
    |> Enum.sort_by(& &1.step_number)
    |> Enum.map(fn step ->
      %{
        id: step.id,
        step_number: step.step_number,
        instructions: step.instructions,
        duration_minutes: step.duration_minutes
      }
    end)
  end

  defp serialize_ingredients(nil), do: []
  defp serialize_ingredients(%Ecto.Association.NotLoaded{}), do: []

  defp serialize_ingredients(ingredients) do
    Enum.map(ingredients, fn item ->
      %{
        ingredient_id: item.ingredient_id,
        name: item.ingredient && item.ingredient.name,
        quantity_milli: item.quantity_milli,
        unit: Atom.to_string(item.unit)
      }
    end)
  end
end
