defmodule MealPlannerApi.Repo.Migrations.DropAccountSelectionContinuations do
  @moduledoc """
  Drops `account_selection_continuation_memberships` and
  `account_selection_continuations` (issue #108). Nothing issues or
  exchanges an account selection continuation: `POST
  /api/auth/switch-account` takes a bearer token only.

  `down` recreates both tables empty, with the columns, indexes and
  constraints `20260831000000_create_email_code_auth_tables.exs` gave
  them.
  """

  use Ecto.Migration

  # The join table goes first: it references the other one.
  def up do
    drop(table(:account_selection_continuation_memberships))
    drop(table(:account_selection_continuations))
  end

  def down do
    create table(:account_selection_continuations, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false)
      add(:token_hash, :string, null: false)
      add(:expires_at, :utc_datetime_usec, null: false)
      add(:consumed_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(
      unique_index(:account_selection_continuations, [:token_hash],
        name: :account_selection_continuations_token_hash_unique_index
      )
    )

    create table(:account_selection_continuation_memberships, primary_key: false) do
      add(
        :continuation_id,
        references(:account_selection_continuations, type: :binary_id, on_delete: :delete_all),
        primary_key: true,
        null: false
      )

      add(
        :membership_id,
        references(:account_memberships, type: :binary_id, on_delete: :delete_all),
        primary_key: true,
        null: false
      )
    end

    create(
      index(:account_selection_continuation_memberships, [:membership_id],
        name: :account_selection_continuation_memberships_membership_id_index
      )
    )
  end
end
