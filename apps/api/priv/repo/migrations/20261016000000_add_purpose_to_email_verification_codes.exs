defmodule MealPlannerApi.Repo.Migrations.AddPurposeToEmailVerificationCodes do
  @moduledoc """
  Every `email_verification_codes` row names the flow that issued it
  (issue #297): `login`, `signup` or `invite`. Until now a login code was
  told from a sign-up code by whether it named a User, which an invite
  code (it names its User too) cannot use: an invite code must never log
  in, and a login code must never accept an invite.

  Existing rows are backfilled from that old rule. The check constraint
  keeps the rule true: only a sign-up code names no User.
  """
  use Ecto.Migration

  def up do
    alter table(:email_verification_codes) do
      add(:purpose, :string)
    end

    execute("""
    UPDATE email_verification_codes
    SET purpose = CASE WHEN user_id IS NULL THEN 'signup' ELSE 'login' END
    """)

    execute("ALTER TABLE email_verification_codes ALTER COLUMN purpose SET NOT NULL")

    create(
      constraint(:email_verification_codes, :email_verification_codes_purpose_check,
        check: """
        (purpose = 'signup' AND user_id IS NULL)
        OR (purpose IN ('login', 'invite') AND user_id IS NOT NULL)
        """
      )
    )
  end

  # Without the column an invite code would read as a login code, so the
  # pending ones (ten minutes at most) are dropped.
  def down do
    execute("DELETE FROM email_verification_codes WHERE purpose = 'invite'")

    drop(constraint(:email_verification_codes, :email_verification_codes_purpose_check))

    alter table(:email_verification_codes) do
      remove(:purpose)
    end
  end
end
