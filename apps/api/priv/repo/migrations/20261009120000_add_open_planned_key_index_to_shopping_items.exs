defmodule MealPlannerApi.Repo.Migrations.AddOpenPlannedKeyIndexToShoppingItems do
  @moduledoc """
  Allows at most one open Shopping item (`pending` or `in_cart`) per planned
  key: Account, Scheduled meal, planned date, Ingredient and unit.

  Shopping items are derived on every Shopping list read with an unlocked
  check-then-insert, so two concurrent reads could store the same item twice.
  Those duplicates are removed here before the index is built. Closed rows
  (`pending_delivery`, `checked_out`, `archived`) are left alone: a partial
  purchase keeps a `checked_out` row next to the `pending` remainder.

  Only columns created with the table are referenced. The migration that adds
  `checkout_session_id` has a 15-digit version, so on a fresh database it runs
  after this one.
  """

  use Ecto.Migration

  require Logger

  @index_name :shopping_items_open_planned_key_index
  @planned_key [:account_id, :scheduled_meal_id, :planned_date, :ingredient_id, :unit]
  @open_statuses "status IN ('pending', 'in_cart')"

  def up do
    # Blocks writers, not readers, until the transaction commits, so no
    # insert lands between the dedupe and the index build.
    execute("LOCK TABLE shopping_items IN SHARE ROW EXCLUSIVE MODE")

    execute(fn ->
      # Keeps one open row per planned key: a reserved (`in_cart`) row before
      # a `pending` one, then the oldest, then the lowest id. Quantities are
      # not summed, because the extra rows are the defect.
      %{num_rows: deleted} =
        repo().query!("""
        DELETE FROM shopping_items
        WHERE id IN (
          SELECT id
          FROM (
            SELECT
              id,
              row_number() OVER (
                PARTITION BY account_id, scheduled_meal_id, planned_date, ingredient_id, unit
                ORDER BY (status = 'in_cart') DESC, inserted_at ASC, id ASC
              ) AS position
            FROM shopping_items
            WHERE #{@open_statuses}
          ) AS ranked
          WHERE position > 1
        )
        """)

      Logger.info("shopping_items open planned key dedupe deleted_rows=#{deleted}")
    end)

    create(
      unique_index(:shopping_items, @planned_key, name: @index_name, where: @open_statuses)
    )
  end

  # The deleted duplicates are not restored: they are derived rows, and the
  # next Shopping list read derives whatever is missing.
  def down do
    drop(index(:shopping_items, [], name: @index_name))
  end
end
