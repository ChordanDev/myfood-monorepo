defmodule MealPlannerApi.TestSupport.OutOfCandidateOptimizer do
  @moduledoc """
  Test double that answers like `OptimizerMock`, then puts the recipe in
  `:out_of_candidate_recipe_id` on the first meal: a recipe that is not among
  the candidates of that meal's slot. Used to prove planning refuses a
  recipe the optimizer was never offered (issue #312).
  """

  @behaviour MealPlannerApi.Optimization.OptimizerPort

  alias MealPlannerApi.Optimization.OptimizerMock

  @impl true
  def select_weekly_menu(payload) do
    recipe_id = Application.fetch_env!(:meal_planner_api, :out_of_candidate_recipe_id)

    case OptimizerMock.select_weekly_menu(payload) do
      {:ok, %{"meals" => [first | rest]} = result} ->
        {:ok, %{result | "meals" => [Map.put(first, "recipe_id", recipe_id) | rest]}}

      other ->
        other
    end
  end

  @impl true
  def health_check, do: :ok
end
