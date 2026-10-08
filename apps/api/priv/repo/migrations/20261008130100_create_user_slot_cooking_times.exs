defmodule MealPlannerApi.Repo.Migrations.CreateUserSlotCookingTimes do
  @moduledoc """
  Slot cooking times (issue #19): for each of breakfast, lunch and dinner,
  the minutes a User will cook and their Hunger level.

  One row per User and slot, held by the unique index on `(user_id, slot)`,
  which is also the index that finds a User's rows and serves the cascade.
  The rows belong to the User, not to an Account, and are deleted with it.
  """
  use Ecto.Migration

  def change do
    create table(:user_slot_cooking_times, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :slot, :string, null: false
      add :cooking_time_minutes, :integer, null: false
      add :hunger_level, :string, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:user_slot_cooking_times, [:user_id, :slot],
             name: :user_slot_cooking_times_user_id_slot_index
           )

    create constraint(:user_slot_cooking_times, :user_slot_cooking_times_slot_check,
             check: "slot IN ('breakfast', 'lunch', 'dinner')"
           )

    create constraint(
             :user_slot_cooking_times,
             :user_slot_cooking_times_cooking_time_minutes_check,
             check: "cooking_time_minutes BETWEEN 0 AND 240"
           )

    create constraint(:user_slot_cooking_times, :user_slot_cooking_times_hunger_level_check,
             check: "hunger_level IN ('light', 'normal', 'strong')"
           )
  end
end
