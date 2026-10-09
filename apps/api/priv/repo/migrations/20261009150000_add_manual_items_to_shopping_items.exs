defmodule MealPlannerApi.Repo.Migrations.AddManualItemsToShoppingItems do
  @moduledoc """
  Lets a Shopping item be added by hand and a planned one be removed.

    * `source` is `planned_meal` (derived from a Scheduled meal, the default
      every existing row takes) or `manual`.
    * `name` is the label of a manual item.
    * A manual item is for no Scheduled meal, date or Ingredient, so
      `scheduled_meal_id`, `planned_date` and `ingredient_id` become
      nullable. A check keeps a planned row complete and a manual row named.
    * `removed` joins the statuses: a planned item the User will not buy.

  The open-planned unique index is left as it is. A manual row has null in
  the key columns, and PostgreSQL treats nulls as distinct, so the index
  only ever constrains planned rows. A `removed` row is not open, so it is
  outside the index like a closed one; derivation looks at every status
  before it stores a key again.

  Some columns of this table (`checkout_session_id`) come from migrations with
  a 15-digit version, which sort after this one on a fresh database. This
  migration only touches columns created with the table.
  """

  use Ecto.Migration

  @statuses_before "status IN ('pending', 'in_cart', 'pending_delivery', 'checked_out', 'archived')"
  @statuses_after "status IN ('pending', 'in_cart', 'removed', 'pending_delivery', 'checked_out', 'archived')"

  def up do
    alter table(:shopping_items) do
      add :source, :string, null: false, default: "planned_meal"
      add :name, :string
    end

    execute("ALTER TABLE shopping_items ALTER COLUMN scheduled_meal_id DROP NOT NULL")
    execute("ALTER TABLE shopping_items ALTER COLUMN planned_date DROP NOT NULL")
    execute("ALTER TABLE shopping_items ALTER COLUMN ingredient_id DROP NOT NULL")

    drop constraint(:shopping_items, :shopping_items_status_check)
    create constraint(:shopping_items, :shopping_items_status_check, check: @statuses_after)

    create constraint(:shopping_items, :shopping_items_source_check,
             check: "source IN ('planned_meal', 'manual')"
           )

    create constraint(:shopping_items, :shopping_items_source_shape_check,
             check: """
             (source = 'planned_meal'
               AND scheduled_meal_id IS NOT NULL
               AND planned_date IS NOT NULL
               AND ingredient_id IS NOT NULL)
             OR (source = 'manual' AND name IS NOT NULL)
             """
           )
  end

  # Manual rows have no planned key to fall back to, and `removed` has no
  # older status to map to, so both are deleted before the old shape returns.
  def down do
    execute("DELETE FROM shopping_items WHERE source = 'manual' OR status = 'removed'")

    drop constraint(:shopping_items, :shopping_items_source_shape_check)
    drop constraint(:shopping_items, :shopping_items_source_check)
    drop constraint(:shopping_items, :shopping_items_status_check)
    create constraint(:shopping_items, :shopping_items_status_check, check: @statuses_before)

    execute("ALTER TABLE shopping_items ALTER COLUMN ingredient_id SET NOT NULL")
    execute("ALTER TABLE shopping_items ALTER COLUMN planned_date SET NOT NULL")
    execute("ALTER TABLE shopping_items ALTER COLUMN scheduled_meal_id SET NOT NULL")

    alter table(:shopping_items) do
      remove :name
      remove :source
    end
  end
end
