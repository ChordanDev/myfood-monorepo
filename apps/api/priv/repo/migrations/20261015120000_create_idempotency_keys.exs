defmodule MealPlannerApi.Repo.Migrations.CreateIdempotencyKeys do
  @moduledoc """
  Idempotency keys (issue #140): one row per mutation an Account ran under a
  client-generated key, holding the response that mutation returned. A repeat
  with the same key on the same endpoint replays that response instead of
  running the mutation again. A row lives 24 hours; a sweeper prunes it after
  `expires_at`.
  """

  use Ecto.Migration

  def change do
    create table(:idempotency_keys, primary_key: false) do
      add(:id, :binary_id, primary_key: true)

      add(:account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      add(:endpoint, :string, null: false)
      add(:key, :string, null: false)
      add(:response, :map)
      add(:expires_at, :utc_datetime_usec, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:idempotency_keys, [:account_id, :endpoint, :key]))
    create(index(:idempotency_keys, [:expires_at]))
  end
end
