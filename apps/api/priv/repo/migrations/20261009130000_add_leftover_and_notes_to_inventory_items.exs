defmodule MealPlannerApi.Repo.Migrations.AddLeftoverAndNotesToInventoryItems do
  use Ecto.Migration

  def change do
    alter table(:inventory_items) do
      add :is_leftover, :boolean, null: false, default: false
      add :notes, :text
    end
  end
end
