defmodule MealPlannerApi.Repo.Migrations.CreatePreparedLeftovers do
  @moduledoc """
  Prepared leftovers (issue #45): cooked portions an Account keeps apart from
  Inventory. A row is open until `consumed_at` or `discarded_at` is set.
  """

  use Ecto.Migration

  def change do
    create table(:prepared_leftovers, primary_key: false) do
      add(:id, :binary_id, primary_key: true)

      add(:account_id, references(:accounts, type: :binary_id, on_delete: :delete_all),
        null: false
      )

      add(:scheduled_meal_id, references(:scheduled_meals, type: :binary_id, on_delete: :nilify_all))

      add(:title, :string, null: false)
      add(:portions, :integer, null: false)
      add(:stored_at, :utc_datetime_usec, null: false)
      add(:consume_by_date, :date, null: false)
      add(:notes, :text)
      add(:consumed_at, :utc_datetime_usec)
      add(:discarded_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(
      constraint(:prepared_leftovers, :prepared_leftovers_portions_non_negative,
        check: "portions >= 0"
      )
    )

    create(index(:prepared_leftovers, [:account_id, :consume_by_date]))
    create(index(:prepared_leftovers, [:scheduled_meal_id]))
  end
end
