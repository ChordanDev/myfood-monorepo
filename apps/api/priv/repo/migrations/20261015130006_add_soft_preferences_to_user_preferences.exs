defmodule MealPlannerApi.Repo.Migrations.AddSoftPreferencesToUserPreferences do
  @moduledoc """
  Soft preferences (issue #18): the free-text entries a User saved, kept in
  the order they were saved.

  The version has 15 digits on purpose. Ecto orders versions as integers and
  `202603312000002_create_user_preferences.exs` carries a 15-digit version,
  so on a fresh database the table is created after every 14-digit
  migration. A 14-digit version here would run before the table exists.
  """
  use Ecto.Migration

  def change do
    alter table(:user_preferences) do
      add :soft_preferences, {:array, :string}, null: false, default: []
    end
  end
end
