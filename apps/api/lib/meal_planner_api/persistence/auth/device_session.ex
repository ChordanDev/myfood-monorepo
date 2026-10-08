defmodule MealPlannerApi.Persistence.Auth.DeviceSession do
  @moduledoc """
  One refresh token handed to the mobile app (issue #9).

  The refresh JWT is never persisted — only its SHA-256 hex digest
  (column `token_hash`) is stored. The row is bound to a `user_id`, to the
  Membership the session is scoped to (`membership_id`, the Account scope)
  and to the `device_id` the app sent when the session opened.

  A row is active while `revoked_at` is `nil` and `expires_at` is in the
  future. Rotation revokes the row and points `replaced_by_id` at the row
  of the new refresh token, which is how a rotated token that shows up
  again is told apart from one that was merely logged out.

  Rows are written by `MealPlannerApi.Services.DeviceSessions` only.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "device_sessions" do
    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)
    belongs_to(:membership, MealPlannerApi.Persistence.Accounts.AccountMembership)
    belongs_to(:replaced_by, __MODULE__)

    field(:device_id, :string)
    field(:token_hash, :string)
    field(:expires_at, :utc_datetime_usec)
    field(:revoked_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @doc """
  Casts and validates a new Device session. Required: `id`, `user_id`,
  `membership_id`, `device_id`, `token_hash`, `expires_at`. The `id` is
  chosen by the caller because the refresh token names it in its `sid`
  claim, so it exists before the row does. `revoked_at` and
  `replaced_by_id` are set by rotation and revocation, not here.
  """
  def changeset(session, attrs) do
    session
    |> cast(attrs, [:id, :user_id, :membership_id, :device_id, :token_hash, :expires_at])
    |> validate_required([:id, :user_id, :membership_id, :device_id, :token_hash, :expires_at])
    |> validate_length(:device_id, max: 255)
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:membership_id)
    |> unique_constraint(:token_hash, name: :device_sessions_token_hash_unique_index)
  end
end
