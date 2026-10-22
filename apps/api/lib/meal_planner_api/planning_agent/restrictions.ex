defmodule MealPlannerApi.PlanningAgent.Restrictions do
  @moduledoc """
  The recipes the Participants' restrictions forbid (issue #423), enforced by
  code in recipe search, the optimizer candidates and the proposal
  validator, so the agent never sees, pins or proposes one.

  A recipe is forbidden when one of its Ingredients:

    * carries a forbidden code in `ingredients.allergens` (the Hard
      restriction codes and the Diet marks of the Participants, see
      `MealPlannerApi.PlanningAgent.HouseholdContext`), or
    * was never reviewed (`allergens` NULL), which counts as carrying every
      code, as long as any code is forbidden, or
    * is an Ingredient a Participant excluded as an allergy.
  """

  import Ecto.Query

  alias MealPlannerApi.Persistence.Catalog.{Ingredient, RecipeIngredient}
  alias MealPlannerApi.Repo

  @doc """
  Narrows `query`, whose recipe binding is named `:recipe`, to the recipes
  the household's restrictions allow.
  """
  @spec allowed(Ecto.Query.t(), map()) :: Ecto.Query.t()
  def allowed(query, household) do
    case forbidding(household) do
      nil ->
        query

      condition ->
        where(
          query,
          [recipe: r],
          not exists(
            from(ri in RecipeIngredient,
              join: i in Ingredient,
              on: i.id == ri.ingredient_id,
              where: ri.recipe_id == parent_as(:recipe).id,
              where: ^condition
            )
          )
        )
    end
  end

  @doc "The ids among `recipe_ids` the household's restrictions forbid."
  @spec forbidden_ids(map(), [Ecto.UUID.t()]) :: MapSet.t(Ecto.UUID.t())
  def forbidden_ids(household, recipe_ids) do
    case {forbidding(household), recipe_ids} do
      {nil, _ids} ->
        MapSet.new()

      {_condition, []} ->
        MapSet.new()

      {condition, ids} ->
        from(ri in RecipeIngredient,
          join: i in Ingredient,
          on: i.id == ri.ingredient_id,
          where: ri.recipe_id in ^ids,
          where: ^condition,
          distinct: true,
          select: ri.recipe_id
        )
        |> Repo.all()
        |> MapSet.new()
    end
  end

  # The condition on a recipe ingredient (`ri`) and its Ingredient (`i`)
  # that forbids the recipe, or nil when nothing is forbidden.
  defp forbidding(household) do
    codes = MapSet.to_list(household.forbidden_codes)
    allergic = MapSet.to_list(household.allergic_ingredient_ids)

    by_code =
      if codes == [],
        do: nil,
        else:
          dynamic(
            [ri, i],
            is_nil(i.allergens) or fragment("? && ?::varchar[]", i.allergens, ^codes)
          )

    by_allergy = if allergic == [], do: nil, else: dynamic([ri, i], ri.ingredient_id in ^allergic)

    case {by_code, by_allergy} do
      {nil, nil} -> nil
      {code, nil} -> code
      {nil, allergy} -> allergy
      {code, allergy} -> dynamic([ri, i], ^code or ^allergy)
    end
  end
end
