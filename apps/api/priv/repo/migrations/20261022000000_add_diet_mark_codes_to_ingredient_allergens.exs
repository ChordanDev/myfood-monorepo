defmodule MealPlannerApi.Repo.Migrations.AddDietMarkCodesToIngredientAllergens do
  @moduledoc """
  The Diet marks `meat`, `fish` and `animal_product` become Ingredient codes
  (issue #441). They join the Hard restriction codes in the CHECKs on
  `allergens` and `allergens_proposed`; `user_hard_restrictions` keeps its own
  CHECK, so a User still cannot declare them as a Hard restriction.

  Every Ingredient reviewed so far was reviewed without the Diet marks: a
  reviewed "Pechuga de pollo" holds `[]`, which would let a vegetarian have it.
  So every reviewed Ingredient goes back to unreviewed (`allergens` NULL), and
  its reviewed codes become its `allergens_proposed`, which
  `mix catalog.review_allergens --export` pre-fills: the reviewer only adds
  the Diet marks. Until then the planner treats those Ingredients as carrying
  every code.

  Rolling back removes the Diet marks from both columns and restores the
  CHECKs; it does not restore the reviews, so those Ingredients stay
  unreviewed.
  """
  use Ecto.Migration

  @hard_restriction_codes ~w(peanut tree_nut shellfish gluten dairy egg soy)
  @diet_mark_codes ~w(meat fish animal_product)

  def up do
    replace_checks(@hard_restriction_codes ++ @diet_mark_codes)
    execute(reset_sql())
  end

  def down do
    for column <- ~w(allergens allergens_proposed) do
      execute("""
      UPDATE ingredients
      SET #{column} = ARRAY(SELECT code FROM unnest(#{column}) AS code WHERE NOT code = ANY(#{array(@diet_mark_codes)}))
      WHERE #{column} && #{array(@diet_mark_codes)}
      """)
    end

    replace_checks(@hard_restriction_codes)
  end

  @doc "Moves every reviewed Ingredient back to unreviewed, keeping its codes as the proposal."
  def reset_sql do
    """
    UPDATE ingredients
    SET allergens_proposed = allergens, allergens = NULL
    WHERE allergens IS NOT NULL
    """
  end

  defp replace_checks(codes) do
    for column <- ~w(allergens allergens_proposed) do
      name = :"ingredients_#{column}_check"
      drop constraint(:ingredients, name)
      create constraint(:ingredients, name, check: "#{column} <@ #{array(codes)}")
    end
  end

  defp array(codes),
    do: "ARRAY[" <> Enum.map_join(codes, ", ", &"'#{&1}'") <> "]::varchar[]"
end
