defmodule MealPlannerApi.Persistence.MealSlotTest do
  @moduledoc """
  The Meal slots are breakfast, lunch and dinner (issue #342). A Scheduled
  meal, a Recipe and a Slot favorite refuse the snack slot like any other
  unknown slot.
  """
  use ExUnit.Case, async: true

  alias MealPlannerApi.Persistence.Catalog.{Recipe, SlotFavorite}
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal

  test "a Scheduled meal refuses the snack slot" do
    changeset =
      ScheduledMeal.changeset(%ScheduledMeal{}, %{
        account_id: Ecto.UUID.generate(),
        date: ~D[2026-10-20],
        slot: "snack"
      })

    assert %{slot: [_]} = errors_on(changeset)
    assert Ecto.Enum.values(ScheduledMeal, :slot) == [:breakfast, :lunch, :dinner]
  end

  test "a Recipe refuses the snack slot" do
    changeset =
      Recipe.changeset(%Recipe{}, %{
        name: "Toast",
        source: :user_created,
        suitable_for_slots: ["breakfast", "snack"]
      })

    assert errors_on(changeset).suitable_for_slots == ["invalid slot: snack"]
  end

  test "a Slot favorite refuses the snack slot" do
    changeset =
      SlotFavorite.changeset(%SlotFavorite{}, %{
        account_id: Ecto.UUID.generate(),
        user_id: Ecto.UUID.generate(),
        date: ~D[2026-10-20],
        slot: "snack",
        scheduled_meal_id: Ecto.UUID.generate(),
        recipe_id: Ecto.UUID.generate()
      })

    assert %{slot: ["is invalid"]} = errors_on(changeset)
    assert SlotFavorite.slot_values() == ~w(breakfast lunch dinner)
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
  end
end
