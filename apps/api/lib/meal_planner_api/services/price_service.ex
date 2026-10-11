defmodule MealPlannerApi.Services.PriceService do
  @moduledoc """
  Business logic layer for price data.

  Reads recipe prices from the data layer (PriceRepo) in the shape the
  optimizer takes, and holds the constraint and slot-suitability helpers.
  """

  alias MealPlannerApi.Data.PriceRepo

  # -------------------------------------------------------------------------
  # Price lookups
  # -------------------------------------------------------------------------

  @doc """
  Returns a map of `recipe_id => price_per_serving_cents` for the given recipes.

  Skips recipes with no price. Used to build `recipe_prices` input for OR-Tools.
  """
  @spec fetch_recipe_prices([Ecto.UUID.t()]) :: %{Ecto.UUID.t() => non_neg_integer()}
  def fetch_recipe_prices(recipe_ids) when is_list(recipe_ids) do
    recipe_ids
    |> PriceRepo.get_recipe_prices()
    |> Enum.reject(&is_nil/1)
    |> Enum.into(%{}, fn rp ->
      {rp.recipe_id, rp.price_per_serving_cents}
    end)
  end

  @doc """
  Returns recipe prices as floats (in currency units, not cents) for the Python API.

  Python OR-Tools expects prices in the same unit as budget_cents / 100.
  """
  @spec fetch_recipe_prices_float([Ecto.UUID.t()]) :: %{Ecto.UUID.t() => float()}
  def fetch_recipe_prices_float(recipe_ids) when is_list(recipe_ids) do
    recipe_ids
    |> PriceRepo.get_recipe_prices()
    |> Enum.reject(&is_nil/1)
    |> Enum.into(%{}, fn rp ->
      {rp.recipe_id, rp.price_per_serving_cents / 100.0}
    end)
  end

  # -------------------------------------------------------------------------
  # Constraints helpers
  # -------------------------------------------------------------------------

  @doc """
  Merges user profile defaults with constraint overrides from the request payload.

  Payload constraints take precedence over profile defaults.
  """
  @spec merge_constraints(map(), map() | nil) :: map()
  def merge_constraints(profile, nil), do: profile

  def merge_constraints(profile, overrides) when is_map(overrides) do
    %{
      protein_g_per_meal: overrides[:protein_g] || profile.protein_g_per_meal,
      max_budget_per_meal_cents: overrides[:budget_cents] || 10_000,
      max_calories: overrides[:max_calories] || 1000,
      excluded_recipe_ids: overrides[:excluded_recipe_ids] || [],
      excluded_ingredients:
        (overrides[:excluded_ingredients] || []) ++
          (profile.default_exclusions || [])
    }
  end

  @doc """
  Returns the list of valid recipe IDs for a given slot type.

  Excludes recipes that don't match the slot type (e.g. breakfast-only vs dinner).
  """
  @spec available_recipe_ids_for_slot([map()], String.t()) :: [Ecto.UUID.t()]
  def available_recipe_ids_for_slot(recipes, slot_type) do
    recipes
    |> Enum.filter(&suitable_for_slot?(&1, slot_type))
    |> Enum.map(& &1.id)
  end

  # -------------------------------------------------------------------------
  # Private
  # -------------------------------------------------------------------------

  defp suitable_for_slot?(recipe, slot) do
    suitable_slots = Map.get(recipe, :suitable_for_slots, []) |> Enum.map(&to_string/1)
    suitable_slots == [] || slot in suitable_slots
  end
end
