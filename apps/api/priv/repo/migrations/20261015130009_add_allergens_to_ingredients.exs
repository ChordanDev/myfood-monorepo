defmodule MealPlannerApi.Repo.Migrations.AddAllergensToIngredients do
  @moduledoc """
  The Hard restriction codes an Ingredient carries (issue #114).

  `allergens` is a list of codes from
  `MealPlannerApi.Persistence.Accounts.UserHardRestriction.codes/0`. NULL
  means nobody has reviewed the Ingredient; `[]` means it was reviewed and
  carries none. The CHECK keeps a code outside the catalog out of the table.

  The version has 15 digits so it sorts after every other migration: Ecto
  orders versions as integers and the folder already holds 15-digit versions.
  """
  use Ecto.Migration

  def change do
    alter table(:ingredients) do
      add :allergens, {:array, :string}, null: true
    end

    create constraint(:ingredients, :ingredients_allergens_check,
             check:
               "allergens <@ ARRAY['peanut', 'tree_nut', 'shellfish', 'gluten', 'dairy', 'egg', 'soy']::varchar[]"
           )
  end
end
