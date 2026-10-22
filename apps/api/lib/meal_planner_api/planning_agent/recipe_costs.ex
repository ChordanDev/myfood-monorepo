defmodule MealPlannerApi.PlanningAgent.RecipeCosts do
  @moduledoc """
  The estimated cost of recipes (issue #423): the `estimated_cost_cents` of
  each recipe's frozen version (`RecipeVersions.freeze_many/1`), the same
  figure the legacy planner gives the optimizer. The optimizer candidates
  and the proposal validator read it from here, so the plan and its budget
  check use one source. The Purchase by package (#430) replaces it.
  """

  alias MealPlannerApi.Services.RecipeVersions

  @doc "The estimated cost in cents of each recipe of `recipe_ids` that has one."
  @spec load([Ecto.UUID.t()]) :: %{Ecto.UUID.t() => non_neg_integer()}
  def load([]), do: %{}

  def load(recipe_ids) do
    recipe_ids
    |> RecipeVersions.freeze_many()
    |> Enum.flat_map(fn {recipe_id, version} ->
      case version.snapshot["estimated_cost_cents"] do
        cents when is_integer(cents) and cents >= 0 -> [{recipe_id, cents}]
        _ -> []
      end
    end)
    |> Map.new()
  end
end
