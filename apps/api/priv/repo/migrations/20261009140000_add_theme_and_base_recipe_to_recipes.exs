defmodule MealPlannerApi.Repo.Migrations.AddThemeAndBaseRecipeToRecipes do
  @moduledoc """
  Recipe theme (issue #33): the palette the app takes while the Recipe is
  in view, stored with the Recipe as camelCase JSON, and the base recipe a
  derived Recipe inherits it from.

  Both columns are nullable. Versions frozen before this migration have no
  `theme` key and read as `nil`; no backfill.
  """
  use Ecto.Migration

  def change do
    alter table(:recipes) do
      add :theme, :map
      add :base_recipe_id, references(:recipes, type: :binary_id, on_delete: :nilify_all)
    end

    create index(:recipes, [:base_recipe_id], where: "base_recipe_id IS NOT NULL")
  end
end
