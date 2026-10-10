defmodule MealPlannerApi.Services.RecipeDetail do
  @moduledoc """
  Projection of a frozen Recipe version, as `GET /api/recipes/:id` serves it.

  The theme comes from the version. A version without one serves the theme
  of the Recipe's base recipe, when it has a base.

  It reads the stored snapshot itself instead of going through
  `RecipeVersions.decode/1`, whose shape cooking and the calendar depend on.
  Quantities are those of the Recipe's own `servings`: no selected quantity
  is applied.

  The category of an ingredient line is not version content. It is read live
  from the Ingredient, with one query for all lines, and is `nil` once the
  Ingredient no longer exists.
  """

  alias MealPlannerApi.Data.RecipeRepo
  alias MealPlannerApi.Persistence.Catalog.{Recipe, RecipeVersion}

  @spec project(%Recipe{}, %RecipeVersion{}) :: map()
  def project(%Recipe{} = recipe, %RecipeVersion{snapshot: snapshot} = version) do
    %{
      id: recipe.id,
      recipe_version_id: version.id,
      successor_recipe_id: recipe.superseded_by_id,
      source: snapshot["source"],
      name: snapshot["name"],
      description: snapshot["description"],
      servings: snapshot["servings"],
      duration_minutes: duration_minutes(snapshot),
      ingredients: ingredients(snapshot["recipe_ingredients"] || []),
      steps: steps(snapshot["recipe_steps"] || []),
      estimated_cost_cents: snapshot["estimated_cost_cents"],
      # No column backs these yet. They are part of the shape already so the
      # tickets that fill them do not change it.
      tags: [],
      image_url: nil,
      theme: snapshot["theme"] || base_theme(recipe)
    }
  end

  # The theme of a derived Recipe without one of its own is the base recipe's
  # current one, read live. The base counts only when it is visible to the
  # derived recipe's Account (a catalog recipe, or one of that Account); a
  # missing or hidden base, or one without a theme, gives nil.
  defp base_theme(%Recipe{base_recipe_id: nil}), do: nil

  defp base_theme(%Recipe{base_recipe_id: base_id, account_id: account_id}) do
    RecipeRepo.get_visible_recipe_theme(account_id, base_id)
  end

  # Prep plus cook, counting a missing one as 0; nil when the Recipe has neither.
  defp duration_minutes(snapshot) do
    case {snapshot["prep_time_minutes"], snapshot["cook_time_minutes"]} do
      {nil, nil} -> nil
      {prep, cook} -> (prep || 0) + (cook || 0)
    end
  end

  defp ingredients(lines) do
    categories = RecipeRepo.ingredient_categories(Enum.map(lines, & &1["ingredient_id"]))

    Enum.map(lines, fn line ->
      category = categories[line["ingredient_id"]]

      %{
        ingredient_id: line["ingredient_id"],
        name: line["ingredient"]["name"],
        category: category && Atom.to_string(category),
        quantity_milli: line["quantity_milli"],
        unit: line["unit"]
      }
    end)
  end

  defp steps(steps) do
    steps
    |> Enum.sort_by(& &1["step_number"])
    |> Enum.map(fn step ->
      %{
        order: step["step_number"],
        text: step["instructions"],
        duration_minutes: step["duration_minutes"]
      }
    end)
  end
end
