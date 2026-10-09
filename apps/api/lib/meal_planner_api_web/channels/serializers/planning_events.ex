defmodule MealPlannerApiWeb.Channels.Serializers.PlanningEvents do
  @moduledoc """
  The frozen payloads of the events the Planner screen reads on
  `planning:<account_id>` (issue #25).

  The generation server broadcasts what it has: the proposal as the optimizer
  result was stored, and a `generation_error` whose shape depends on where the
  pipeline failed. `PlanningChannel` runs those payloads through this module on
  their way to the client, so the screen reads one shape per event. The
  generation server is not touched.

  The functions take the payload as it was broadcast (atom or string keys) and
  return snake_case maps; the channel camelizes them. The shapes are
  documented in `apps/api/docs/CHANNELS.md`.
  """

  alias MealPlannerApiWeb.Casing

  @slot_order ~w(breakfast lunch dinner snack)

  @doc """
  The `proposal_ready` payload and the `planning_message` the assistant says
  about it, for a proposal the generation server broadcast.

  Returns `:passthrough` for a payload that is not that: the proposal of
  `swap_constraints` has its own shape and reaches the client as it is.

  `proposal_ready`:

      %{proposal_id, run_id, estimated_cost_cents,
        days: [%{date: "YYYY-MM-DD", cost_cents, meals: [meal]}]}

  where a `meal` is `%{slot, recipe_id, recipe_name, price_cents, macros:
  %{protein_g, carbs_g, calories}}` and the days and their meals are in
  calendar order. A meal whose price is unknown has `price_cents: nil` and
  adds nothing to the cost.
  """
  @spec proposal_ready(map()) :: {:ok, map(), map()} | :passthrough
  def proposal_ready(payload) when is_map(payload) do
    with %{} = proposal <- field(payload, :proposal),
         slots when is_list(slots) <- field(proposal, :slots) do
      days = slots |> Enum.flat_map(&meal_of_slot/1) |> group_into_days()
      estimated_cost_cents = days |> Enum.map(& &1.cost_cents) |> Enum.sum()
      proposal_id = field(payload, :proposal_id)
      run_id = field(payload, :run_id)

      ready = %{
        proposal_id: proposal_id,
        run_id: run_id,
        estimated_cost_cents: estimated_cost_cents,
        days: days
      }

      {:ok, ready, planning_message(proposal_id, run_id, days, estimated_cost_cents)}
    else
      _not_a_generation_proposal -> :passthrough
    end
  end

  def proposal_ready(_payload), do: :passthrough

  @doc """
  The `generation_error` payload. The generation server and the channel
  broadcast it with a reason alone, with a run, a reason and details, or with
  a request id and a reason; the client reads all of them as

      %{reason, details, run_id, request_id}

  `reason` is a string, `details` a map (empty when there are none) and the
  two ids are `nil` when the broadcaster had none. A key a broadcaster adds is
  kept.
  """
  @spec generation_error(map()) :: map()
  def generation_error(payload) when is_map(payload) do
    payload = Casing.snake_keys(payload)

    payload
    |> Map.put("reason", reason_text(Map.get(payload, "reason")))
    |> Map.put("details", details_map(Map.get(payload, "details")))
    |> Map.put_new("run_id", nil)
    |> Map.put_new("request_id", nil)
  end

  # -------------------------------------------------------------------------
  # Proposal
  # -------------------------------------------------------------------------

  # A slot of the stored proposal names its day and its slot in `slot_key`
  # (`"2026-10-09_lunch"`). A slot whose key does not read that way has no day
  # to be listed on and is left out.
  defp meal_of_slot(slot) when is_map(slot) do
    with key when is_binary(key) <- field(slot, :slot_key),
         [date, slot_name] <- String.split(key, "_", parts: 2),
         {:ok, _date} <- Date.from_iso8601(date) do
      [
        %{
          date: date,
          slot: slot_name,
          recipe_id: field(slot, :recipe_id),
          recipe_name: field(slot, :recipe_name),
          price_cents: price_cents(field(slot, :price_cents)),
          macros: macros(field(slot, :macros))
        }
      ]
    else
      _unreadable -> []
    end
  end

  defp meal_of_slot(_slot), do: []

  defp group_into_days(meals) do
    meals
    |> Enum.group_by(& &1.date)
    |> Enum.sort_by(fn {date, _meals} -> date end)
    |> Enum.map(fn {date, day_meals} ->
      sorted = Enum.sort_by(day_meals, &{slot_rank(&1.slot), &1.slot})

      %{
        date: date,
        cost_cents: sorted |> Enum.map(&(&1.price_cents || 0)) |> Enum.sum(),
        meals: Enum.map(sorted, &Map.delete(&1, :date))
      }
    end)
  end

  defp slot_rank(slot), do: Enum.find_index(@slot_order, &(&1 == slot)) || length(@slot_order)

  defp price_cents(price) when is_integer(price), do: price
  defp price_cents(_unknown), do: nil

  defp macros(macros) when is_map(macros) do
    %{
      protein_g: field(macros, :protein_g),
      carbs_g: field(macros, :carbs_g),
      calories: field(macros, :calories)
    }
  end

  defp macros(_missing), do: %{protein_g: nil, carbs_g: nil, calories: nil}

  # -------------------------------------------------------------------------
  # planning_message
  # -------------------------------------------------------------------------

  # What the assistant says about the proposal. The text is English like the
  # rest of the API; `summary` carries the numbers for a client that words
  # them itself.
  defp planning_message(proposal_id, run_id, days, estimated_cost_cents) do
    day_count = length(days)
    meal_count = days |> Enum.map(&length(&1.meals)) |> Enum.sum()

    %{
      role: "assistant",
      text:
        "Here is your plan for #{plural(day_count, "day")}: " <>
          "#{plural(meal_count, "meal")}, estimated cost #{money(estimated_cost_cents)}.",
      proposal_id: proposal_id,
      run_id: run_id,
      summary: %{
        day_count: day_count,
        meal_count: meal_count,
        estimated_cost_cents: estimated_cost_cents
      }
    }
  end

  defp plural(1, noun), do: "1 #{noun}"
  defp plural(count, noun), do: "#{count} #{noun}s"

  defp money(cents) do
    "#{div(cents, 100)}.#{cents |> rem(100) |> Integer.to_string() |> String.pad_leading(2, "0")}"
  end

  # -------------------------------------------------------------------------
  # generation_error
  # -------------------------------------------------------------------------

  defp reason_text(reason) when is_binary(reason), do: reason
  defp reason_text(reason) when is_atom(reason) and not is_nil(reason), do: Atom.to_string(reason)
  defp reason_text(_other), do: "unknown"

  defp details_map(details) when is_map(details) and not is_struct(details), do: details
  defp details_map(_other), do: %{}

  # A payload key as the broadcaster spelled it, atom or string.
  defp field(map, key) when is_map(map) do
    case Map.fetch(map, key) do
      {:ok, value} -> value
      :error -> Map.get(map, Atom.to_string(key))
    end
  end
end
