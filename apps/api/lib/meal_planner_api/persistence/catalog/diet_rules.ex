defmodule MealPlannerApi.Persistence.Catalog.DietRules do
  @moduledoc """
  The Ingredient codes each Diet forbids (issue #441).

  A Diet is enforced like a Hard restriction, not weighed like a preference: an
  Ingredient that carries a forbidden code in `allergens` is excluded. The codes
  are the Hard restriction codes plus the Diet marks (`mark_codes/0`), which an
  Ingredient can carry but a User cannot declare as a Hard restriction.

  An Ingredient nobody reviewed (`allergens` NULL) counts as carrying every
  code, so every Diet that forbids something excludes it.
  """

  # The Diet marks, in catalog order. They follow the Hard restriction codes
  # in `Ingredient.codes/0`.
  @mark_codes ~w(meat fish animal_product)

  # Each list is in `Ingredient.codes/0` order: Diet marks first, then the
  # Hard restriction codes. A Diet missing here (omnivore) forbids nothing.
  @forbidden %{
    vegetarian: ~w(meat fish),
    vegan: ~w(meat fish animal_product dairy egg),
    pescatarian: ~w(meat),
    celiac: ~w(gluten)
  }

  @doc "The Diet marks: Ingredient codes that are not Hard restriction choices."
  @spec mark_codes() :: [String.t()]
  def mark_codes, do: @mark_codes

  @doc "The Ingredient codes `diet` forbids; `[]` for omnivore or no Diet."
  @spec forbidden_codes(atom() | nil) :: [String.t()]
  def forbidden_codes(diet), do: Map.get(@forbidden, diet, [])

  @doc """
  Whether `diet` excludes an Ingredient with these `allergens`. NULL (not
  reviewed) is excluded by every Diet that forbids a code.
  """
  @spec excludes?(atom() | nil, [String.t()] | nil) :: boolean()
  def excludes?(diet, allergens) do
    case {forbidden_codes(diet), allergens} do
      {[], _allergens} -> false
      {_forbidden, nil} -> true
      {forbidden, allergens} -> Enum.any?(allergens, &(&1 in forbidden))
    end
  end
end
