defmodule MealPlannerApi.Repo.Migrations.AddProfileFieldsToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :household_size, :integer
      add :cooking_skill, :string
    end
  end
end
