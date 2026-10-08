defmodule MealPlannerApi.Repo.Migrations.CreateDeviceSessions do
  @moduledoc """
  Device sessions (issue #9): one row per refresh token handed to the
  mobile app, so a refresh token can be rotated, recognised when it is
  replayed, and revoked on logout.

    * `token_hash` — SHA-256 hex digest of the refresh JWT, unique. The
      token itself is never stored.
    * `user_id`, `membership_id` — who the session belongs to and the
      Account it is scoped to. Both cascade: a session cannot outlive
      its User or its Membership.
    * `device_id` — the `deviceId` the app sent when the session opened.
    * `revoked_at` — set on rotation, logout, replay and re-login.
    * `replaced_by_id` — the row a rotation put in this one's place. It
      is cleared when that row is swept.

  A User has at most one session that is not revoked per device: the
  unique index on `(user_id, device_id)` over the rows with no
  `revoked_at` is what holds that when two requests race, and it is the
  index that finds the session to revoke.

  Other indexes: the `expires_at` and `revoked_at` indexes serve the
  sweep, and the `user_id`, `membership_id` and `replaced_by_id` indexes
  keep the cascades from scanning the table.
  """
  use Ecto.Migration

  def change do
    create table(:device_sessions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      add :membership_id,
          references(:account_memberships, type: :binary_id, on_delete: :delete_all),
          null: false

      add :device_id, :string, size: 255, null: false
      add :token_hash, :string, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :revoked_at, :utc_datetime_usec

      add :replaced_by_id,
          references(:device_sessions, type: :binary_id, on_delete: :nilify_all)

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:device_sessions, [:token_hash],
             name: :device_sessions_token_hash_unique_index
           )

    create unique_index(:device_sessions, [:user_id, :device_id],
             name: :device_sessions_active_user_id_device_id_unique_index,
             where: "revoked_at IS NULL"
           )

    create index(:device_sessions, [:user_id], name: :device_sessions_user_id_index)

    create index(:device_sessions, [:membership_id],
             name: :device_sessions_membership_id_index
           )

    create index(:device_sessions, [:expires_at], name: :device_sessions_expires_at_index)

    create index(:device_sessions, [:revoked_at],
             name: :device_sessions_revoked_at_index,
             where: "revoked_at IS NOT NULL"
           )

    create index(:device_sessions, [:replaced_by_id],
             name: :device_sessions_replaced_by_id_index,
             where: "replaced_by_id IS NOT NULL"
           )
  end
end
