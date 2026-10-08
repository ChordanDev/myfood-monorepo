defmodule MealPlannerApi.Repo.Migrations.AllowEmptyDietaryProfileAndCheckHardRestrictionCodes do
  @moduledoc """
  Storage for `PUT /api/me/preferences` (issue #18).

  A User can save "no Diet", and a dietary profile the mobile app creates
  has no macro goal, so `diet_type` and `macro_goal` stop being NOT NULL.
  Their CHECK constraints stay as they are: `NULL IN (...)` is not false, so
  a CHECK lets a null through.

  `user_hard_restrictions.code` gets a CHECK with the catalog of
  `MealPlannerApi.Persistence.Accounts.UserHardRestriction`. Until now only
  the changeset kept a code outside the catalog out of the table.

  Rolling back puts NOT NULL back, which fails while a dietary profile holds
  a null: those rows have to be settled by hand first.
  """
  use Ecto.Migration

  def change do
    alter table(:user_dietary_profiles) do
      modify :diet_type, :string, null: true, from: {:string, null: false}
      modify :macro_goal, :string, null: true, from: {:string, null: false}
    end

    create constraint(:user_hard_restrictions, :user_hard_restrictions_code_check,
             check: "code IN ('peanut', 'tree_nut', 'shellfish', 'gluten', 'dairy', 'egg', 'soy')"
           )
  end
end
