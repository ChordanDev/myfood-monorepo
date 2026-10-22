defmodule MealPlannerApi.Repo.Migrations.CreatePlanningConsents do
  @moduledoc """
  AI-processing consent of a User (issue #423): given once, the first time
  the User plans with the planning agent, and valid in every Account the
  User belongs to. One row per User.

    * `user_id` — cascades: the consent goes with its User.
    * `granted_at` — when the User agreed.
    * `text_version` — the version of the consent text the User agreed to.
      The text is a placeholder until its legal review (Argentina, Ley
      25.326, health data); a reviewed text gets a new version.

  Ported from myfood's `ai_processing_consents` with a new timestamp; that
  table had one row per Account and User.
  """
  use Ecto.Migration

  def change do
    create table(:planning_consents, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false)
      add(:granted_at, :utc_datetime_usec, null: false)
      add(:text_version, :string, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:planning_consents, [:user_id]))
  end
end
