defmodule MealPlannerApi.Repo.Migrations.AddAllergensProposedToIngredients do
  @moduledoc """
  The Hard restriction codes proposed for an Ingredient nobody has reviewed
  yet (issue #302).

  `mix ai_populate` writes the union of the codes the AI names and the codes
  `MealPlannerApi.Persistence.Catalog.AllergenRules` finds in the name. The
  proposal is a hint for the human who runs `mix catalog.review_allergens`;
  the planner never reads it. Only that review writes `allergens`.

  The CHECK is the same as the one on `allergens`.
  """
  use Ecto.Migration

  def change do
    alter table(:ingredients) do
      add :allergens_proposed, {:array, :string}, null: true
    end

    create constraint(:ingredients, :ingredients_allergens_proposed_check,
             check:
               "allergens_proposed <@ ARRAY['peanut', 'tree_nut', 'shellfish', 'gluten', 'dairy', 'egg', 'soy']::varchar[]"
           )
  end
end
