defmodule MealPlannerApi.Repo.Migrations.CreatePlanningConfirmations do
  @moduledoc """
  Confirmations of planning agent Proposals (issue #423). The primary key is
  the confirmed Proposal's id: a replayed confirmation finds its row instead
  of saving the meals twice. Rows outlive the Planning session, so a lost
  acknowledgement can be reconciled through `confirmation_status` later.

    * `account_id` — cascades with the Account.
    * `planning_session_id`, `confirmed_by_membership_id` — kept as audit,
      cleared when the session row or the Membership goes.
    * `range_from`, `range_to`, `meals_count` — what was saved.

  Ported from myfood's `planning_agent_confirmations` with a new timestamp,
  without its Shopping line count: this repository derives the Shopping list
  from the Scheduled meals.
  """
  use Ecto.Migration

  def change do
    create table(:planning_confirmations, primary_key: false) do
      add(:id, :binary_id, primary_key: true)

      add(:account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      add(
        :planning_session_id,
        references(:planning_sessions, type: :binary_id, on_delete: :nilify_all)
      )

      add(
        :confirmed_by_membership_id,
        references(:account_memberships, type: :binary_id, on_delete: :nilify_all)
      )

      add(:range_from, :date, null: false)
      add(:range_to, :date, null: false)
      add(:meals_count, :integer, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:planning_confirmations, [:account_id]))
    create(index(:planning_confirmations, [:planning_session_id]))
    create(index(:planning_confirmations, [:confirmed_by_membership_id]))
  end
end
