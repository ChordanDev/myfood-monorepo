defmodule MealPlannerApi.Repo.Migrations.CreateShoppingRemovals do
  @moduledoc """
  Shopping removals (issue #334): the User's decision not to buy one
  Ingredient for one Scheduled meal, kept apart from the Shopping item.

  A removal stays while its Scheduled meal exists, whether or not a
  Shortage derives a Shopping item for it: stock that covers the Ingredient
  leaves no item to mark, and the removal is still there when the stock is
  used up. The derivation marks as `removed` every item of the pair.

    * `account_id` — the Account of the meal, so a removal is read and
      written per Account like the Shopping items.
    * `scheduled_meal_id` — cascades: a removal goes with its meal, and a
      range replace that gives the meals new ids carries it itself.
    * `ingredient_id` — the Ingredient the User will not buy.

  The unique index on `(scheduled_meal_id, ingredient_id)` holds one row
  per pair when two requests write it at once. The `ingredient_id` and
  `account_id` indexes keep the cascades from scanning the table.
  """
  use Ecto.Migration

  def change do
    create table(:shopping_removals, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :account_id, references(:accounts, type: :binary_id, on_delete: :delete_all), null: false

      add :scheduled_meal_id,
          references(:scheduled_meals, type: :binary_id, on_delete: :delete_all),
          null: false

      add :ingredient_id,
          references(:ingredients, type: :binary_id, on_delete: :delete_all),
          null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:shopping_removals, [:scheduled_meal_id, :ingredient_id],
             name: :shopping_removals_scheduled_meal_id_ingredient_id_index
           )

    create index(:shopping_removals, [:ingredient_id])
    create index(:shopping_removals, [:account_id])
  end
end
