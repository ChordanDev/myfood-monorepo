defmodule MealPlannerApi.Repo.Migrations.AddDeliveredAtToEmailVerificationCodes do
  @moduledoc """
  Every `email_verification_codes` row records when its mail went out
  (issue #291). A code is committed before it is mailed, so until now an
  unsent code was already the latest pending code: it shadowed the earlier
  code while the mail provider answered, and for good when the process
  died before the failed send could delete it. Verification now reads only
  delivered codes. The resend cooldown counts a delivered code from
  `delivered_at`, and a code still being sent from `inserted_at` for a short
  delivery window only.

  The column stays empty while the mail is out. Every existing row was
  mailed when it was stored, so it is backfilled from `inserted_at`.
  """
  use Ecto.Migration

  def up do
    alter table(:email_verification_codes) do
      add(:delivered_at, :utc_datetime_usec)
    end

    execute("UPDATE email_verification_codes SET delivered_at = inserted_at")
  end

  def down do
    alter table(:email_verification_codes) do
      remove(:delivered_at)
    end
  end
end
