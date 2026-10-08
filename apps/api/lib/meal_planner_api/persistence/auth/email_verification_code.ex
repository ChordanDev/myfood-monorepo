defmodule MealPlannerApi.Persistence.Auth.EmailVerificationCode do
  @moduledoc """
  Phase 1 — Persistence and Code Request (issue #31).

  One row per pending (or recently-consumed) email verification code.
  Codes are never stored in plaintext — only their SHA-256 hex digest.

  See `design.md` §"Persistence Shapes".
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "email_verification_codes" do
    # Empty on a sign-up code, which is issued before its User exists
    # (`MealPlannerApi.Services.EmailCodeSignup`). Login only reads rows
    # that have one.
    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)
    field(:email, :string)
    field(:code_hash, :string)
    field(:expires_at, :utc_datetime_usec)
    field(:consumed_at, :utc_datetime_usec)
    # Failed verifications against this code, counted by the mobile login
    # and sign-up flows (`MealPlannerApi.Services.EmailCodeLogin`).
    field(:attempts, :integer, default: 0)

    timestamps(type: :utc_datetime_usec)
  end
end
