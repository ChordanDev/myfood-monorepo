defmodule MealPlannerApi.PlanningAgent.FakeOptimizer do
  @moduledoc """
  An `OptimizerPort` for the planning agent tests (issue #423). It answers
  what the test set with `answer!/1`, or the first candidate of every day and
  slot, and sends the payload of every call to the test with `notify!/1`.

  The answer lives in `:persistent_term`, so it reaches the turn process
  that calls the optimizer; tests that use it are `async: false`.
  """

  @behaviour MealPlannerApi.Optimization.OptimizerPort

  @key {__MODULE__, :answer}
  @notify {__MODULE__, :notify}

  @doc "Sets the answer: `{:ok, result}`, `{:error, reason}` or a function of the payload."
  def answer!(answer), do: :persistent_term.put(@key, answer)

  @doc "Sends `{:optimizer_payload, payload}` to `pid` on every call."
  def notify!(pid), do: :persistent_term.put(@notify, pid)

  @doc "Forgets the answer and the pid."
  def reset! do
    :persistent_term.erase(@key)
    :persistent_term.erase(@notify)
  end

  @impl true
  def select_weekly_menu(payload) do
    case :persistent_term.get(@notify, nil) do
      pid when is_pid(pid) -> send(pid, {:optimizer_payload, payload})
      _ -> :ok
    end

    case :persistent_term.get(@key, nil) do
      nil -> {:ok, first_candidates(payload)}
      fun when is_function(fun, 1) -> fun.(payload)
      answer -> answer
    end
  end

  @impl true
  def health_check, do: :ok

  @doc "A result with the first candidate of every day and slot of `payload`."
  def first_candidates(payload) do
    meals =
      for day <- payload["days"], slot <- payload["slots"] do
        [first | _] = payload["candidates_by_slot"][slot]
        %{"day" => day, "slot" => slot, "recipe_id" => first["recipe_id"]}
      end

    %{"meals" => meals, "deviations" => [], "optimality" => "optimal"}
  end
end
