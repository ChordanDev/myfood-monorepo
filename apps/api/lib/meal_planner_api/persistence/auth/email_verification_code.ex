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

  @type t :: %__MODULE__{}

  schema "email_verification_codes" do
    # Empty on a sign-up code, which is issued before its User exists
    # (`MealPlannerApi.Services.EmailCodeSignup`); set on every other code.
    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)
    # The flow that issued the code, and the only one that may redeem it:
    # `:login` (`MealPlannerApi.Services.EmailCodeLogin`), `:signup`, or
    # `:invite` (`MealPlannerApi.AccountsMembership.request_invite_code/2`).
    field(:purpose, Ecto.Enum, values: [:login, :signup, :invite])
    field(:email, :string)
    field(:code_hash, :string)
    field(:expires_at, :utc_datetime_usec)
    field(:consumed_at, :utc_datetime_usec)
    # When the code's mail went out; empty while it is being sent. Only a
    # delivered code verifies. A delivered code holds the resend cooldown
    # from this time, and a code still being sent holds it from
    # `inserted_at` for the delivery window
    # (`MealPlannerApi.Services.EmailCodeLogin.issue_code/4`).
    field(:delivered_at, :utc_datetime_usec)
    # Failed verifications against this code, counted by every flow
    # (`MealPlannerApi.Services.EmailCodeLogin.redeem_code/5`).
    field(:attempts, :integer, default: 0)

    timestamps(type: :utc_datetime_usec)
  end
end
