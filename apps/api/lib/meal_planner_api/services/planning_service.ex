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

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Optimization.OptimizerPort
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Services.CookingService
  alias MealPlannerApi.Services.{PlanningCandidateBuilder, PlanningRequestValidator}

  @slots [:breakfast, :lunch, :dinner]
  @default_days ~w(monday tuesday wednesday thursday friday saturday sunday)

  # The most days a User plans at once, whatever the plan of their Account.
  # Decided in #230: the plan rows' `max_planning_days` is not a planning rule.
  @max_planning_days 7

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
         max_days = max_planning_days(),
         {:ok, selected_days} <- resolve_selected_days(params, max_days),
         true <- requested_days_valid?(params, max_days),
         {:ok, candidates_by_slot} <- build_candidates(user, identity),
         {:ok, result} <- run_optimizer(optimizer, selected_days, candidates_by_slot, user),
         :ok <- refuse_deviations(result),
         :ok <- validate_meals_in_candidates(result["meals"], candidates_by_slot) do
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
  The most days a User can plan at once: seven, on every plan.

  The plan of the Account does not change it. `generate_weekly_plan/3` plans
  no more days than this, `PlanningChatService.generate_menu/2` refuses a
  longer date range, and so does `start_planning` on the planning channel.
  """
  @spec max_planning_days() :: pos_integer()
  def max_planning_days, do: @max_planning_days

  @spec run_optimizer(module(), [String.t()], map(), planning_user()) ::
          {:ok, %{required(String.t()) => term()}} | {:error, term()}
  def run_optimizer(_optimizer, [], _candidates, _user),
    do: {:ok, %{"meals" => [], "deviations" => [], "optimality" => "optimal"}}

  # The v2 optimizer plans ISO dates (issue #422), while this planner names
  # its days. The n-th day is planned on the n-th date from today, and the
  # meals come back under the day's own name.
  def run_optimizer(optimizer, days, candidates_by_slot, user) do
    slots = available_slots(candidates_by_slot)
    dates = days |> Enum.with_index() |> Enum.map(&optimizer_date/1)
    day_by_date = dates |> Enum.zip(days) |> Map.new()

    payload =
      dates
      |> build_optimization_payload(candidates_by_slot, user)
      |> Map.put("slots", slots)

    case optimizer.select_weekly_menu(payload) do
      {:ok, %{"meals" => meals} = result} when is_list(meals) ->
        {:ok, %{result | "meals" => Enum.map(meals, &name_meal_day(&1, day_by_date))}}

      other ->
        other
    end
  end

  defp optimizer_date({_day, offset}),
    do: Date.utc_today() |> Date.add(offset) |> Date.to_iso8601()

  defp name_meal_day(%{"day" => date} = meal, day_by_date),
    do: %{meal | "day" => Map.get(day_by_date, date, date)}

  defp name_meal_day(meal, _day_by_date), do: meal

  # The v2 optimizer returns the closest plan and lists every goal it misses
  # as a Deviation. This planner has no approval step, so a plan that misses
  # the budget or a nutrition goal is refused, as when they were hard rules.
  defp refuse_deviations(%{"deviations" => [_ | _]}), do: {:error, :optimization_failed}
  defp refuse_deviations(_result), do: :ok

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

  @spec get_scheduled_meals(Ecto.UUID.t(), Date.t(), Date.t()) :: [map()]
  def get_scheduled_meals(
        account_id,
        from_date \\ Date.utc_today(),
        to_date \\ Date.add(Date.utc_today(), 6)
      ) do
    meals = PlanningRepo.list_scheduled_meals(account_id, from_date, to_date)
    Enum.map(meals, &serialize_scheduled_meal/1)
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
    descriptors = Enum.map(@slots, &%{date: Date.utc_today(), slot: &1})

    with {:ok, %{"participant_ids" => participant_ids}, _context} <-
           PlanningRequestValidator.validate_request(
             participant_constraints(user),
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

  # Issue #311: a User map that names no participants leaves the default to
  # `PlanningRequestValidator`, which plans for every active member of the
  # Account. The persisted User carries none, so that is the usual case. A
  # key that is present is the caller's choice, so a null one is refused by
  # the validator rather than widened here.
  defp participant_constraints(user) do
    cond do
      Map.has_key?(user, :participant_ids) -> %{"participant_ids" => user.participant_ids}
      Map.has_key?(user, :user_ids) -> %{"participant_ids" => user.user_ids}
      true -> %{}
    end
  end

  # Issue #312: the optimizer's answer is external input. Every meal must be
  # one of the candidates of its slot, so a recipe the dietary filter removed
  # never reaches the plan. Same rule as `GenerationService.validate_assignments/3`,
  # keyed by slot because this path builds its candidates by slot only.
  defp validate_meals_in_candidates(meals, candidates_by_slot) when is_list(meals) do
    candidate_ids =
      Map.new(candidates_by_slot, fn {slot, candidates} ->
        {slot, MapSet.new(candidates, & &1["recipe_id"])}
      end)

    if Enum.all?(meals, &meal_in_candidates?(&1, candidate_ids)),
      do: :ok,
      else: {:error, :optimization_failed}
  end

  defp validate_meals_in_candidates(_meals, _candidates_by_slot),
    do: {:error, :optimization_failed}

  # A `nil` meal carries no recipe; the plan has always skipped it.
  defp meal_in_candidates?(nil, _candidate_ids), do: true

  defp meal_in_candidates?(%{"slot" => slot, "recipe_id" => recipe_id}, candidate_ids)
       when is_binary(recipe_id) do
    candidate_ids |> Map.get(slot, MapSet.new()) |> MapSet.member?(recipe_id)
  end

  defp meal_in_candidates?(_meal, _candidate_ids), do: false

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
      "dinner" -> {:ok, "dinner"}
      _ -> nil
    end
  end
end
