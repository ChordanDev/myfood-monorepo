defmodule MealPlannerApi.Services.PlanningService do
  @moduledoc """
  Orchestration layer for meal planning use-cases.

  Coordinates:
  - Identity resolution
  - Recipe candidate building
  - Optimization payload construction
  - Plan persistence (scheduled meals, proposals, runs)

  Delegates to OptimizerPort for optimization decisions.
  Delegates to data repos for persistence.
  """

  require Logger

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Optimization.OptimizerPort
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Services.CookingService
  alias MealPlannerApi.Services.{PlanningCandidateBuilder, PlanningRequestValidator}

  @slots [:breakfast, :lunch, :dinner]
  @default_days ~w(monday tuesday wednesday thursday friday saturday sunday)

  # -------------------------------------------------------------------------
  # Weekly plan generation
  # -------------------------------------------------------------------------

  @type planning_user :: %{
          optional(:user_id) => Ecto.UUID.t(),
          optional(:account_id) => Ecto.UUID.t(),
          optional(:account_type) => atom() | String.t(),
          optional(:subscription_tier) => atom() | String.t(),
          optional(:kcal_target) => integer(),
          optional(:weekly_budget_cents) => integer(),
          optional(:user_ids) => [Ecto.UUID.t()]
        }

  @type planning_params :: %{
          optional(:days) => [String.t()],
          optional(:kcal_target) => integer() | String.t(),
          optional(:weekly_budget_cents) => integer() | String.t(),
          optional(:user_ids) => [Ecto.UUID.t()]
        }

  @spec generate_weekly_plan(planning_user(), planning_params(), module()) ::
          {:ok,
           %{
             days: [map()],
             estimated_cost_cents: non_neg_integer(),
             optimizer_used: boolean(),
             max_planning_days: pos_integer(),
             subscription_tier: String.t()
           }}
          | {:error, term()}
  def generate_weekly_plan(user, params \\ %{}, optimizer \\ client_module()) do
    with {:ok, identity} <- resolve_identity(user),
         {:ok, max_days} <- resolve_max_days(user),
         {:ok, selected_days} <- resolve_selected_days(params, max_days),
         true <- requested_days_valid?(params, max_days),
         {:ok, candidates_by_slot} <- build_candidates(user, identity),
         {:ok, result} <- run_optimizer(optimizer, selected_days, candidates_by_slot, user) do
      day_plans = build_day_plans(result["meals"], selected_days)

      estimated_cost =
        result["meals"]
        |> Enum.reject(&is_nil/1)
        |> Enum.reduce(0, fn meal, acc -> acc + (meal["estimated_cost_cents"] || 0) end)

      {:ok,
       %{
         days: day_plans,
         estimated_cost_cents: estimated_cost,
         optimizer_used: true,
         max_planning_days: max_days,
         subscription_tier: to_string(Map.get(user, :subscription_tier, :free))
       }}
    else
      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  The most days a User can plan at once: the maximum of their plan.

  Seven days on the premium tier and five on any other; a User without a tier
  is on the free one. `generate_weekly_plan/3` plans no more days than this,
  and `PlanningChatService.generate_menu/2` refuses a longer date range.
  """
  @spec max_planning_days(planning_user()) :: pos_integer()
  def max_planning_days(user) do
    case Map.get(user, :subscription_tier, :free) do
      :premium -> 7
      "premium" -> 7
      _ -> 5
    end
  end

  @spec run_optimizer(module(), [String.t()], map(), planning_user()) ::
          {:ok, %{required(String.t()) => [map()]}}
          | {:error, :optimization_failed | :optimizer_unavailable}
  def run_optimizer(_optimizer, [], _candidates, _user), do: {:ok, %{"meals" => []}}

  def run_optimizer(optimizer, days, candidates_by_slot, user) do
    slots = available_slots(candidates_by_slot)

    payload =
      days
      |> build_optimization_payload(candidates_by_slot, user)
      |> Map.put("slots", slots)

    optimizer.select_weekly_menu(payload)
  end

  defp client_module,
    do: Application.get_env(:meal_planner_api, :planning_optimizer_client, OptimizerMock)

  @spec build_optimization_payload([String.t()], map(), planning_user()) ::
          OptimizerPort.optimizer_payload()
  def build_optimization_payload(days, candidates_by_slot, user) do
    %{
      "days" => days,
      "slots" => Enum.map(@slots, &Atom.to_string/1),
      "constraints" => %{
        "kcal_target" => parse_int(Map.get(user, :kcal_target), 2100),
        "weekly_budget_cents" => parse_int(Map.get(user, :weekly_budget_cents), 45_000),
        "account_type" => to_string(Map.get(user, :account_type, "individual")),
        "subscription_tier" => to_string(Map.get(user, :subscription_tier, "free")),
        "inventory_items" => [],
        "inventory_weight" =>
          Application.get_env(:meal_planner_api, :optimizer_inventory_weight, 100),
        "macro_bounds" => macro_bounds_for_user(user)
      },
      "candidates_by_slot" => candidates_by_slot
    }
  end

  # -------------------------------------------------------------------------
  # Plan persistence
  # -------------------------------------------------------------------------

  @spec save_plan(Ecto.UUID.t(), Ecto.UUID.t(), [map()], map()) ::
          {:ok, %{proposal_id: Ecto.UUID.t(), meal_ids: [Ecto.UUID.t()]}}
          | {:error, term()}
  def save_plan(account_id, user_id, meals, _metadata \\ %{}) do
    run_result =
      PlanningRepo.create_generation_run(%{
        account_id: account_id,
        user_id: user_id,
        status: :completed,
        input_context: %{"source" => "planning_service"},
        started_at: DateTime.utc_now(),
        completed_at: DateTime.utc_now()
      })

    proposal_result =
      case run_result do
        {:ok, run} ->
          PlanningRepo.create_proposal(%{
            generation_run_id: run.id,
            proposal_json: %{meals: meals},
            selected_at: DateTime.utc_now()
          })

        err ->
          err
      end

    with {:ok, run} <- run_result,
         {:ok, proposal} <- proposal_result do
      meal_ids = Enum.flat_map(meals, &schedule_plan_meal(&1, account_id, run, proposal))

      {:ok, %{proposal_id: proposal.id, meal_ids: meal_ids}}
    else
      {:error, reason} ->
        Logger.error("save_plan failed account_id=#{account_id} failure=#{failure_name(reason)}")
        {:error, reason}
    end
  end

  # Both steps fail with a rejected changeset, which carries the plan it was
  # built from, so the log names the schema and the invalid fields only.
  defp failure_name(%Ecto.Changeset{data: %schema{}, errors: errors}) do
    "invalid #{inspect(schema)} fields=#{inspect(Keyword.keys(errors))}"
  end

  defp schedule_plan_meal(meal, account_id, run, proposal) do
    case PlanningRepo.schedule_meal(%{
           account_id: account_id,
           generation_run_id: run.id,
           planning_proposal_id: proposal.id,
           date: parse_date(meal["day"]),
           slot: String.to_existing_atom(meal["slot"]),
           recipe_id: meal["recipe_id"],
           selected_quantity: Map.get(meal, "selected_quantity", 1),
           is_cooked: false
         }) do
      {:ok, scheduled_meal} -> [scheduled_meal.id]
      {:error, _} -> []
    end
  end

  @spec get_scheduled_meals(Ecto.UUID.t(), Date.t(), Date.t()) :: [map()]
  def get_scheduled_meals(
        account_id,
        from_date \\ Date.utc_today(),
        to_date \\ Date.add(Date.utc_today(), 6)
      ) do
    meals = PlanningRepo.list_scheduled_meals(account_id, from_date, to_date)
    Enum.map(meals, &serialize_scheduled_meal/1)
  end

  @spec mark_meal_cooked(Ecto.UUID.t()) :: {:ok, map()}
  def mark_meal_cooked(meal_id) do
    meal = PlanningRepo.get_scheduled_meal!(meal_id)
    {:ok, updated} = PlanningRepo.update_scheduled_meal(meal, %{is_cooked: true})
    {:ok, serialize_scheduled_meal(updated)}
  end

  @spec delete_scheduled_meal(Ecto.UUID.t()) :: :ok | {:error, term()}
  def delete_scheduled_meal(meal_id) do
    PlanningRepo.delete_scheduled_meal(meal_id)
    :ok
  rescue
    _ -> {:error, :not_found}
  end

  # -------------------------------------------------------------------------
  # Candidates
  # -------------------------------------------------------------------------

  @spec build_candidates(planning_user(), map()) ::
          {:ok, %{String.t() => [map()]}} | {:error, :not_a_member | :forbidden}
  def build_candidates(user, identity) do
    participants = Map.get(user, :participant_ids, Map.get(user, :user_ids, [identity.user_id]))
    descriptors = Enum.map(@slots, &%{date: Date.utc_today(), slot: &1})

    with {:ok, %{"participant_ids" => participant_ids}, _context} <-
           PlanningRequestValidator.validate_request(
             %{"participant_ids" => participants},
             identity.account_id,
             identity.user_id
           ),
         {:ok, %{slots: slots}} <-
           PlanningCandidateBuilder.build_available_candidate_set(
             identity.account_id,
             descriptors,
             participant_ids
           ) do
      {:ok, Map.new(slots, &{&1.slot, &1.candidates})}
    end
  end

  defp available_slots(candidates_by_slot) do
    @slots
    |> Enum.map(&Atom.to_string/1)
    |> Enum.filter(&(Map.get(candidates_by_slot, &1, []) != []))
  end

  # -------------------------------------------------------------------------
  # Cooking sessions
  # -------------------------------------------------------------------------

  @spec start_cooking_session(Ecto.UUID.t(), Ecto.UUID.t(), Ecto.UUID.t()) ::
          {:ok, map()} | {:error, :meal_not_found}
  def start_cooking_session(account_id, user_id, scheduled_meal_id) do
    case CookingService.start_session(
           %{id: user_id, account_id: account_id},
           scheduled_meal_id
         ) do
      {:ok, session} ->
        {:ok,
         %{session_id: session.session_id, meal_id: scheduled_meal_id, recipe: session.recipe}}

      {:error, :scheduled_meal_not_found} ->
        {:error, :meal_not_found}

      error ->
        error
    end
  end

  # -------------------------------------------------------------------------
  # Helpers
  # -------------------------------------------------------------------------

  defp resolve_identity(user) do
    Identity.ensure_persistent_identity(user)
  end

  defp resolve_max_days(user), do: {:ok, max_planning_days(user)}

  defp macro_bounds_for_user(_user) do
    %{
      "protein_g" => %{"min" => 100.0, "max" => 150.0},
      "carbs_g" => %{"min" => 225.0, "max" => 325.0},
      "fat_g" => %{"min" => 44.44, "max" => 77.78},
      "calories" => %{"min" => 1800.0, "max" => 2500.0}
    }
  end

  defp resolve_selected_days(params, max_days) do
    requested = Map.get(params, "days", @default_days)
    # Handle both list (["monday", "tuesday"]) and integer ("8" or 8)
    normalized =
      cond do
        is_list(requested) ->
          requested

        is_binary(requested) ->
          case Integer.parse(requested) do
            {n, ""} -> List.first(@default_days) |> next_days_until(n)
            :error -> @default_days
          end

        is_integer(requested) ->
          List.first(@default_days) |> next_days_until(requested)

        true ->
          @default_days
      end

    selected = Enum.take(normalized, max_days)
    {:ok, selected}
  end

  defp requested_days_valid?(params, max_days) do
    requested = Map.get(params, "days")

    if is_nil(requested) do
      true
    else
      count = requested_days_count(requested)

      if count > max_days do
        {:error, :exceeds_max_planning_days}
      else
        true
      end
    end
  end

  defp requested_days_count(requested) do
    cond do
      is_list(requested) ->
        length(requested)

      is_binary(requested) ->
        case Integer.parse(requested) do
          {n, ""} -> n
          :error -> length(@default_days)
        end

      is_integer(requested) ->
        requested

      true ->
        length(@default_days)
    end
  end

  defp next_days_until(start_day, count) do
    day_atoms = [:monday, :tuesday, :wednesday, :thursday, :friday, :saturday, :sunday]
    start_idx = Enum.find_index(day_atoms, &(&1 == start_day)) || 0

    Enum.map(0..(count - 1), fn i ->
      day_atom = Enum.at(day_atoms, rem(start_idx + i, 7))
      Atom.to_string(day_atom)
    end)
  end

  defp build_day_plans(meals, days) do
    Enum.map(days, fn day ->
      day_meals = Enum.filter(meals, &(&1["day"] == day))
      %{day: day, meals: day_meals}
    end)
  end

  defp parse_date("monday"), do: next_weekday(:monday)
  defp parse_date("tuesday"), do: next_weekday(:tuesday)
  defp parse_date("wednesday"), do: next_weekday(:wednesday)
  defp parse_date("thursday"), do: next_weekday(:thursday)
  defp parse_date("friday"), do: next_weekday(:friday)
  defp parse_date("saturday"), do: next_weekday(:saturday)
  defp parse_date("sunday"), do: next_weekday(:sunday)
  defp parse_date(_), do: Date.utc_today() |> Date.add(1)

  defp next_weekday(target) do
    today = Date.utc_today()
    today_weekday = Date.day_of_week(today)

    target_weekday =
      case target do
        :monday -> 1
        :tuesday -> 2
        :wednesday -> 3
        :thursday -> 4
        :friday -> 5
        :saturday -> 6
        :sunday -> 7
      end

    days_ahead = target_weekday - today_weekday
    days_ahead = if days_ahead <= 0, do: days_ahead + 7, else: days_ahead
    Date.add(today, days_ahead)
  end

  defp serialize_scheduled_meal(meal) do
    %{
      id: meal.id,
      date: meal.date,
      slot: Atom.to_string(meal.slot),
      recipe_id: meal.recipe_id,
      is_cooked: meal.is_cooked
    }
  end

  defp parse_int(nil, f), do: f
  defp parse_int(value, _f) when is_integer(value), do: value

  defp parse_int(value, f) when is_binary(value) do
    case Integer.parse(value) do
      {int, _} -> int
      :error -> f
    end
  end

  defp parse_int(_, _), do: nil

  # -------------------------------------------------------------------------
  # Slot favorites
  # -------------------------------------------------------------------------

  # A favorite belongs to the Scheduled meal in the slot, so the slot must hold
  # one, and it must have a recipe. The meal is resolved first in both
  # directions (create and remove).
  @spec toggle_slot_favorite(map(), map()) :: {:ok, %{is_favorite: boolean()}} | {:error, atom()}
  def toggle_slot_favorite(user, payload) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, date} <- parse_date_service(Map.get(payload, "date")),
         slot_str when is_binary(slot_str) <- Map.get(payload, "slot"),
         {:ok, slot} <- parse_slot_service(slot_str),
         {:ok, meal} <- fetch_favoritable_meal(identity.account_id, date, slot),
         {:ok, toggled} <-
           PlanningRepo.toggle_slot_favorite(%{
             account_id: identity.account_id,
             user_id: identity.user_id,
             date: date,
             slot: slot,
             scheduled_meal_id: meal.id,
             recipe_id: meal.recipe_id
           }) do
      {:ok, %{is_favorite: Map.get(toggled, :status) != :removed}}
    else
      {:error, %Ecto.Changeset{}} -> {:error, :invalid_payload}
      {:error, reason} -> {:error, reason}
      nil -> {:error, :invalid_slot}
      _ -> {:error, :invalid_payload}
    end
  end

  defp fetch_favoritable_meal(account_id, date, slot) do
    case PlanningRepo.get_scheduled_meal_at(account_id, date, slot) do
      nil -> {:error, :meal_not_found}
      %{recipe_id: nil} -> {:error, :meal_without_recipe}
      meal -> {:ok, meal}
    end
  end

  defp parse_date_service(nil), do: {:error, :missing_date}
  defp parse_date_service(%Date{} = d), do: {:ok, d}

  defp parse_date_service(s) when is_binary(s) do
    case Date.from_iso8601(s) do
      {:ok, d} -> {:ok, d}
      _ -> {:error, :invalid_date}
    end
  end

  defp parse_slot_service(s) when is_binary(s) do
    case s do
      "breakfast" -> {:ok, "breakfast"}
      "lunch" -> {:ok, "lunch"}
      "snack" -> {:ok, "snack"}
      "dinner" -> {:ok, "dinner"}
      _ -> nil
    end
  end
end
