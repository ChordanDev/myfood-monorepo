defmodule MealPlannerApi.Repo.Migrations.CreateUserHardRestrictions do
  @moduledoc """
  Hard restrictions (issue #18): one row per code a User declared, such as
  `peanut` or `gluten`. The codes come from a fixed list held by
  `MealPlannerApi.Persistence.Accounts.UserHardRestriction`; they are not
  Excluded ingredients and do not reference the ingredient catalog.

  The rows cascade with their User, and the unique index on
  `(user_id, code)` keeps a code from being stored twice for one User. It
  is also the index that lists a User's restrictions.
  """
  use Ecto.Migration

  def change do
    create table(:user_hard_restrictions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :code, :string, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:user_hard_restrictions, [:user_id, :code])
  end
end
