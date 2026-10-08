defmodule MealPlannerApi.Repo.Migrations.AllowEmailVerificationCodesWithoutUser do
  @moduledoc """
  A sign-up code (issue #8) is issued before its User exists, so
  `email_verification_codes.user_id` becomes nullable. The foreign key
  and its `ON DELETE CASCADE` are untouched: a row that does name a User
  still has to name a real one.
  """
  use Ecto.Migration

  def up do
    execute("ALTER TABLE email_verification_codes ALTER COLUMN user_id DROP NOT NULL")
  end

  # Codes without a User are pending sign-ups that live ten minutes at
  # most; they cannot satisfy the restored constraint, so they are dropped.
  def down do
    execute("DELETE FROM email_verification_codes WHERE user_id IS NULL")
    execute("ALTER TABLE email_verification_codes ALTER COLUMN user_id SET NOT NULL")
  end
end
