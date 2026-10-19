defmodule MealPlannerApi.Repo.Migrations.RemoveSnackMealSlot do
  @moduledoc """
  The snack is not a Meal slot (issue #342): the product offers breakfast,
  lunch and dinner.

  The stored snack rows are deleted, then the checks allow only the three
  slots:

    * a Scheduled meal in the snack slot is deleted. Its rows follow the
      foreign keys: Shopping items, Shopping removals, Slot favorites and
      Cooking sessions are deleted, a Prepared leftover keeps its row with
      no source meal;
    * a Slot favorite of the snack slot is deleted, whatever meal it names;
    * `snack` is removed from `recipes.suitable_for_slots`.

  Rolling back restores the wider checks; the deleted rows are not restored.
  """
  use Ecto.Migration

  def up do
    Enum.each(delete_snack_sql(), &execute/1)

    drop constraint(:scheduled_meals, :scheduled_meals_slot_check)

    create constraint(:scheduled_meals, :scheduled_meals_slot_check,
             check: "slot IN ('breakfast', 'lunch', 'dinner')"
           )

    drop constraint(:recipes, :recipes_slots_allowed_check)

    create constraint(:recipes, :recipes_slots_allowed_check,
             check: "suitable_for_slots <@ ARRAY['breakfast','lunch','dinner']::varchar[]"
           )
  end

  def down do
    drop constraint(:scheduled_meals, :scheduled_meals_slot_check)

    create constraint(:scheduled_meals, :scheduled_meals_slot_check,
             check: "slot IN ('breakfast', 'lunch', 'snack', 'dinner')"
           )

    drop constraint(:recipes, :recipes_slots_allowed_check)

    create constraint(:recipes, :recipes_slots_allowed_check,
             check:
               "suitable_for_slots <@ ARRAY['breakfast','lunch','snack','dinner']::varchar[]"
           )
  end

  @doc false
  def delete_snack_sql do
    [
      "DELETE FROM slot_favorites WHERE slot = 'snack'",
      "DELETE FROM scheduled_meals WHERE slot = 'snack'",
      """
      UPDATE recipes
      SET suitable_for_slots = array_remove(suitable_for_slots, 'snack')
      WHERE 'snack' = ANY(suitable_for_slots)
      """
    ]
  end
end
