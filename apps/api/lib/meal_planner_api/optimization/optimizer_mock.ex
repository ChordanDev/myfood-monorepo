defmodule MealPlannerApi.Optimization.OptimizerMock do
  @moduledoc """
  Test double for `OptimizerPort`.

  Returns deterministic results in the v2 result shape: the first candidate
  of each slot for every day, no Deviations, proven optimal. Configurable to
  produce errors on demand via application env:
  - `:optimizer_mock_error` — causes `select_weekly_menu` to return error
  """

  @behaviour MealPlannerApi.Optimization.OptimizerPort

  @impl true
  def select_weekly_menu(payload) do
    if Application.get_env(:meal_planner_api, :optimizer_mock_error, false) do
      {:error, :optimizer_unavailable}
    else
      days = Map.get(payload, "days", Map.get(payload, :days, []))

      candidates_by_slot =
        Map.get(payload, "candidates_by_slot", Map.get(payload, :candidates_by_slot, %{}))

      slots =
        Map.get(payload, "slots", Map.get(payload, :slots, Map.keys(candidates_by_slot)))

      meals = build_mock_meals(days, candidates_by_slot, slots)
      {:ok, %{"meals" => meals, "deviations" => [], "optimality" => "optimal"}}
    end
  end

  @impl true
  def health_check, do: :ok

  # ---

  defp build_mock_meals(days, candidates_by_slot, slots) do
    Enum.flat_map(days, fn day ->
      Enum.map(slots, &build_mock_meal(day, &1, candidates_by_slot))
    end)
  end

  defp build_mock_meal(day, slot, candidates_by_slot) do
    slot_str = to_string(slot)

    first =
      candidates_by_slot |> candidates_for_slot(slot_str) |> List.first() |> stringify_keys()

    Map.merge(first || %{}, %{
      "day" => day,
      "slot" => slot_str,
      "recipe_id" => (first && first["recipe_id"]) || "mock-recipe-#{slot_str}"
    })
    |> Map.put_new("estimated_cost_cents", mock_cost_cents(first, slot_str))
  end

  # Use price_per_serving_cents if available, else generate mock
  # based on slot (breakfast = 3200 to match test expectations)
  defp mock_cost_cents(first, slot_str) do
    if first && is_map(first) do
      case first["price_per_serving_cents"] do
        nil -> default_slot_cost_cents(slot_str)
        0 -> default_slot_cost_cents(slot_str)
        val -> val
      end
    else
      default_slot_cost_cents(slot_str)
    end
  end

  defp default_slot_cost_cents("breakfast"), do: 3200
  defp default_slot_cost_cents("lunch"), do: 2200
  defp default_slot_cost_cents("dinner"), do: 2800
  defp default_slot_cost_cents(_slot), do: 0

  defp candidates_for_slot(candidates_by_slot, slot_name) do
    Map.get(candidates_by_slot, slot_name) ||
      Enum.find_value(candidates_by_slot, [], fn {slot, candidates} ->
        if to_string(slot) == slot_name, do: candidates
      end) || []
  end

  defp stringify_keys(nil), do: nil

  defp stringify_keys(candidate),
    do: Map.new(candidate, fn {key, value} -> {to_string(key), value} end)
end
