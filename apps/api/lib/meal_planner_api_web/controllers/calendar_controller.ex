defmodule MealPlannerApiWeb.CalendarController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Calendar.MealMove
  alias MealPlannerApi.Services.ShoppingService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.MealSummary

  # Phase A — Tenancy Refactor (PR 3c task 3.14): tenancy scope is always
  # resolved from `conn.assigns.current_membership.account_id` (the
  # DB-resolved row `LoadCurrentMembership` assigns via `membership_id`),
  # never from `current_user.account_id` — see the plug for why the latter
  # is only a dual-write compatibility shim, not an authoritative source.

  def index(conn, params) do
    user = Guardian.Plug.current_resource(conn)
    membership = conn.assigns.current_membership

    with {:ok, start_date} <- parse_date(Map.get(params, "start_date")),
         {:ok, end_date} <- parse_date(Map.get(params, "end_date")),
         :ok <- validate_date_range(start_date, end_date),
         {:ok, selected_date} <-
           parse_optional_date(
             Map.get(params, "selected_date"),
             AccountClock.today(membership.account_id)
           ),
         {:ok, selected_slot} <- parse_optional_slot(Map.get(params, "selected_slot"), :lunch) do
      data =
        Calendar.monthly_overview(membership.account_id, user.id, start_date, end_date, %{
          selected_date: selected_date,
          selected_slot: selected_slot
        })

      json(conn, %{data: serialize_payload(data)})
    else
      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  def replace_range(conn, params) do
    membership = conn.assigns.current_membership

    with {:ok, from_date} <- parse_date(range_param(params, "from", "start_date")),
         {:ok, to_date} <- parse_date(range_param(params, "to", "end_date")),
         :ok <- validate_date_range(from_date, to_date),
         {:ok, meals} <- parse_replacement_meals(Map.get(params, "meals")) do
      case ShoppingService.replace_scheduled_meals_for_range(
             membership.account_id,
             {from_date, to_date},
             meals
           ) do
        {:ok, result} -> json(conn, %{data: result})
        {:error, reason} -> render_error(conn, reason)
      end
    else
      {:error, reason} -> render_error(conn, reason)
    end
  end

  @doc """
  `POST /api/calendar/meals/:id/move` with `date` and `slot`: moves the
  Scheduled meal `:id` of the caller's Account to that position and keeps its
  id. A meal already there takes the position the moved one leaves and comes
  back as `displaced`, which is `nil` for an empty destination; both carry
  `meal_id`, `date` and `slot`.

  Unlike the older actions of this controller, errors use the envelope of
  `ApiError`: 404 `scheduled_meal_not_found`, 422 `validation_error` naming
  `date` or `slot` (the position the meal already has is not a valid
  destination), 409 `scheduled_meal_cooked` when either meal is cooked, and
  409 `calendar_conflict` when a concurrent write took the destination.
  """
  def move_meal(conn, %{"id" => meal_id} = params) do
    account_id = conn.assigns.current_membership.account_id

    with {:date, {:ok, date}} <- {:date, parse_date(Map.get(params, "date"))},
         {:slot, {:ok, slot}} <- {:slot, parse_slot(Map.get(params, "slot"))},
         {:ok, %{moved: moved, displaced: displaced}} <-
           MealMove.move(account_id, meal_id, date, slot, AccountClock.today(account_id)) do
      json(conn, %{
        data: %{moved: serialize_position(moved), displaced: serialize_position(displaced)}
      })
    else
      {:date, {:error, _reason}} -> conn |> ApiError.validation_error("date")
      {:slot, {:error, _reason}} -> conn |> ApiError.validation_error("slot")
      {:error, reason} -> render_move_error(conn, reason)
    end
  end

  def show_slot(conn, params) do
    user = Guardian.Plug.current_resource(conn)
    membership = conn.assigns.current_membership

    with {:ok, date} <- parse_date(Map.get(params, "date")),
         {:ok, slot} <- parse_slot(Map.get(params, "slot")),
         {:ok, meal} <- get_slot_meal_result(membership, user, date, slot) do
      json(conn, %{data: serialize_slot_response(meal, date, slot)})
    else
      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  defp get_slot_meal_result(membership, user, date, slot) do
    case Calendar.get_slot_meal(membership.account_id, user.id, date, slot) do
      nil -> {:ok, nil}
      meal -> {:ok, meal}
    end
  end

  defp range_param(params, primary, fallback) do
    Map.get(params, primary) || Map.get(params, fallback)
  end

  defp parse_replacement_meals(meals) when is_list(meals) do
    Enum.reduce_while(meals, {:ok, []}, fn
      meal, {:ok, parsed} when is_map(meal) ->
        with {:ok, date} <- parse_date(Map.get(meal, "date") || Map.get(meal, :date)),
             {:ok, slot} <- parse_slot(Map.get(meal, "slot") || Map.get(meal, :slot)) do
          {:cont, {:ok, [meal |> Map.put(:date, date) |> Map.put(:slot, slot) | parsed]}}
        else
          {:error, reason} -> {:halt, {:error, reason}}
        end

      _meal, _acc ->
        {:halt, {:error, "invalid_meals"}}
    end)
    |> case do
      {:ok, parsed} -> {:ok, Enum.reverse(parsed)}
      error -> error
    end
  end

  defp parse_replacement_meals(nil), do: {:error, "missing_meals"}
  defp parse_replacement_meals(_), do: {:error, "invalid_meals"}

  defp render_error(conn, reason) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: reason})
  end

  defp render_move_error(conn, :meal_not_found),
    do: conn |> ApiError.error(:scheduled_meal_not_found)

  defp render_move_error(conn, :same_slot), do: conn |> ApiError.validation_error("slot")
  defp render_move_error(conn, :conflict), do: conn |> ApiError.error(:calendar_conflict)

  defp render_move_error(conn, reason) when reason in [:meal_cooked, :target_meal_cooked],
    do: conn |> ApiError.error(:scheduled_meal_cooked)

  defp validate_date_range(start_date, end_date) do
    if Date.compare(start_date, end_date) in [:lt, :eq] do
      :ok
    else
      {:error, "invalid_date_range"}
    end
  end

  defp parse_optional_date(nil, default), do: {:ok, default}
  defp parse_optional_date(value, _default), do: parse_date(value)

  defp parse_optional_slot(nil, default), do: {:ok, default}

  defp parse_optional_slot(value, _default) when is_binary(value) do
    case value do
      "breakfast" -> {:ok, :breakfast}
      "lunch" -> {:ok, :lunch}
      "snack" -> {:ok, :snack}
      "dinner" -> {:ok, :dinner}
      _ -> {:error, "invalid_slot"}
    end
  end

  defp parse_optional_slot(_, _default), do: {:error, "invalid_slot"}

  defp parse_date(nil), do: {:error, "missing_date_param"}

  defp parse_date(value) when is_binary(value) do
    case Date.from_iso8601(value) do
      {:ok, date} -> {:ok, date}
      _ -> {:error, "invalid_date_format"}
    end
  end

  defp parse_date(_), do: {:error, "invalid_date_format"}

  # Required slot parser (used by show_slot)
  defp parse_slot(nil), do: {:error, "missing_slot_param"}

  defp parse_slot(value) when is_binary(value) do
    case value do
      "breakfast" -> {:ok, :breakfast}
      "lunch" -> {:ok, :lunch}
      "snack" -> {:ok, :snack}
      "dinner" -> {:ok, :dinner}
      _ -> {:error, "invalid_slot"}
    end
  end

  defp parse_slot(_), do: {:error, "invalid_slot"}

  defp serialize_payload(payload) do
    %{
      start_date: Date.to_iso8601(payload.start_date),
      end_date: Date.to_iso8601(payload.end_date),
      today: Date.to_iso8601(payload.today),
      selected_date: Date.to_iso8601(payload.selected_date),
      selected_slot: Atom.to_string(payload.selected_slot),
      days: Enum.map(payload.days, &serialize_day/1),
      meals: Enum.map(payload.meals, &serialize_meal/1),
      selected_meal: serialize_selected_meal(payload.selected_meal)
    }
  end

  defp serialize_day(day) do
    %{
      date: Date.to_iso8601(day.date),
      day_state: Atom.to_string(day.day_state),
      has_planned_menu: day.has_planned_menu,
      is_selected: day.is_selected
    }
  end

  defp serialize_meal(meal) do
    summary =
      MealSummary.serialize(%{
        recipe_id: meal.recipe_id,
        recipe_name: meal.recipe_name,
        is_favorite: meal.is_favorite,
        slot: meal.slot,
        calories: meal.calories_per_serving,
        prep_time_minutes: meal.prep_time_minutes
      })

    Map.merge(summary, %{
      meal_id: meal.id,
      date: Date.to_iso8601(meal.date),
      is_cooked: meal.is_cooked,
      is_skipped: meal.is_skipped,
      recipe_version_id: meal.recipe_version_id,
      selected_quantity: meal.selected_quantity,
      can_create: false
    })
  end

  defp serialize_selected_meal(nil), do: nil

  defp serialize_selected_meal(meal) do
    base = serialize_meal(meal)
    Map.put(base, :can_create, is_nil(meal.recipe_id))
  end

  # Serializers for slot response (show_slot endpoint)

  defp serialize_slot_response(nil, date, slot) do
    # Empty slot — can create
    %{
      meal_id: nil,
      date: Date.to_iso8601(date),
      slot: Atom.to_string(slot),
      recipe_id: nil,
      recipe_name: nil,
      is_cooked: false,
      is_skipped: false,
      is_favorite: false,
      can_create: true,
      macros: nil,
      prep_time_minutes: nil
    }
  end

  defp serialize_slot_response(meal, _date, _slot) do
    # Filled slot — can_create is always false for existing meals
    serialize_meal(meal)
    |> Map.put(:can_create, false)
  end

  # Where a meal sits after a move (move_meal endpoint)

  defp serialize_position(nil), do: nil

  defp serialize_position(meal) do
    %{meal_id: meal.id, date: Date.to_iso8601(meal.date), slot: Atom.to_string(meal.slot)}
  end
end
