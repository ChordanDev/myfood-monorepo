defmodule MealPlannerApi.PlanningAgent.RecipeSearch do
  @moduledoc """
  Structured recipe search for the planning agent (issue #423, ported from
  myfood@d9b965a): free text over the recipe name and its ingredient names,
  filters by meal slot and ingredient, scoped to the recipes visible to the
  Account (the catalog and the Account's own, never a superseded one).

  Recipes the Participants' restrictions forbid are excluded by code before
  the agent ever sees them (`MealPlannerApi.PlanningAgent.Restrictions`).
  """

  import Ecto.Query

  alias MealPlannerApi.Persistence.Catalog.{Ingredient, Recipe, RecipeIngredient}
  alias MealPlannerApi.PlanningAgent.Restrictions
  alias MealPlannerApi.Repo

  @default_limit 20
  @max_limit 50

  @type filters :: %{
          optional(:query) => String.t(),
          optional(:slot) => String.t(),
          optional(:ingredient) => String.t(),
          optional(:exclude_recipe_ids) => [Ecto.UUID.t()],
          optional(:limit) => pos_integer()
        }

  @type recipe :: %{
          id: Ecto.UUID.t(),
          name: String.t(),
          slots: [String.t()],
          ingredients: [String.t()],
          calories_per_serving: integer() | nil,
          protein_g_per_serving: number() | nil,
          carbs_g_per_serving: number() | nil,
          fat_g_per_serving: number() | nil
        }

  @doc """
  Searches recipes for the Account described by `household` (a
  `MealPlannerApi.PlanningAgent.HouseholdContext`). Returns
  `{:error, :search_failed}` when the search itself fails, so a failure is
  never mistaken for "no recipes".
  """
  @spec search(map(), filters()) :: {:ok, [recipe()]} | {:error, :search_failed}
  def search(household, filters) do
    limit = filters |> Map.get(:limit, @default_limit) |> min(@max_limit) |> max(1)

    recipes =
      from(r in Recipe, as: :recipe)
      |> where([r], is_nil(r.account_id) or r.account_id == ^household.account_id)
      |> where([r], is_nil(r.superseded_by_id))
      |> filter_slot(filters[:slot])
      |> filter_text(filters[:query])
      |> filter_ingredient(filters[:ingredient])
      |> exclude_ids(filters[:exclude_recipe_ids])
      |> Restrictions.allowed(household)
      |> order_by([r], asc: r.name, asc: r.id)
      |> limit(^limit)
      |> preload(recipe_ingredients: :ingredient)
      |> Repo.all()

    {:ok, Enum.map(recipes, &serialize/1)}
  rescue
    _error in [DBConnection.ConnectionError, Postgrex.Error, Ecto.QueryError] ->
      {:error, :search_failed}
  end

  defp filter_slot(query, slot) when is_binary(slot) and slot != "",
    do: where(query, [r], ^slot in r.suitable_for_slots)

  defp filter_slot(query, _), do: query

  defp filter_text(query, text) when is_binary(text) do
    case like_pattern(text) do
      nil ->
        query

      pattern ->
        where(
          query,
          [r],
          ilike(r.name, ^pattern) or
            exists(
              from(ri in RecipeIngredient,
                join: i in Ingredient,
                on: i.id == ri.ingredient_id,
                where: ri.recipe_id == parent_as(:recipe).id and ilike(i.name, ^pattern)
              )
            )
        )
    end
  end

  defp filter_text(query, _), do: query

  defp filter_ingredient(query, text) when is_binary(text) do
    case like_pattern(text) do
      nil ->
        query

      pattern ->
        where(
          query,
          [r],
          exists(
            from(ri in RecipeIngredient,
              join: i in Ingredient,
              on: i.id == ri.ingredient_id,
              where: ri.recipe_id == parent_as(:recipe).id and ilike(i.name, ^pattern)
            )
          )
        )
    end
  end

  defp filter_ingredient(query, _), do: query

  defp exclude_ids(query, [_ | _] = ids) do
    ids = Enum.flat_map(ids, &cast_uuid/1)
    where(query, [r], r.id not in ^ids)
  end

  defp exclude_ids(query, _), do: query

  defp like_pattern(text) do
    case String.trim(text) do
      "" ->
        nil

      trimmed ->
        escaped = String.replace(trimmed, ["\\", "%", "_"], fn char -> "\\" <> char end)
        "%" <> escaped <> "%"
    end
  end

  defp cast_uuid(value) do
    case Ecto.UUID.cast(value) do
      {:ok, uuid} -> [uuid]
      :error -> []
    end
  end

  defp serialize(recipe) do
    %{
      id: recipe.id,
      name: recipe.name,
      slots: recipe.suitable_for_slots,
      ingredients: recipe.recipe_ingredients |> Enum.map(& &1.ingredient.name) |> Enum.sort(),
      calories_per_serving: recipe.calories_per_serving,
      protein_g_per_serving: number(recipe.protein_g_per_serving),
      carbs_g_per_serving: number(recipe.carbs_g_per_serving),
      fat_g_per_serving: number(recipe.fat_g_per_serving)
    }
  end

  defp number(nil), do: nil
  defp number(%Decimal{} = value), do: Decimal.to_float(value)
  defp number(value), do: value
end
