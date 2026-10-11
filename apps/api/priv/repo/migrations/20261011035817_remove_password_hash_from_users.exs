defmodule MealPlannerApi.Repo.Migrations.RemovePasswordHashFromUsers do
  @moduledoc """
  Users hold no password (issue #107): sign-in is by email code only and
  no route verifies a password, so the column has no reader or writer.

  `remove/2` names the column type so the migration is reversible.
  """
  use Ecto.Migration

  def change do
    alter table(:users) do
      remove :password_hash, :string
    end
  end
end
