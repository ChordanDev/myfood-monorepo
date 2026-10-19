defmodule MealPlannerApi.Data.RemoveSnackMealSlotMigrationTest do
  @moduledoc """
  Removing the snack Meal slot (issue #342): the product offers breakfast,
  lunch and dinner. The migration deletes the stored snack rows and the
  database refuses a new one.
  """
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Catalog.{Recipe, SlotFavorite}
  alias MealPlannerApi.Persistence.{Leftovers, Planning, Shopping}
  alias MealPlannerApi.Persistence.Leftovers.PreparedLeftover
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo

  @migration MealPlannerApi.Repo.Migrations.RemoveSnackMealSlot
  @migration_path Path.expand(
                    "../../../priv/repo/migrations/20261019000000_remove_snack_meal_slot.exs",
                    __DIR__
                  )

  setup_all do
    # `mix ecto.migrate` may have compiled the migration in this VM already.
    unless Code.ensure_loaded?(@migration), do: Code.require_file(@migration_path)
    {:ok, migration: @migration}
  end

  setup do
    :ok = Sandbox.checkout(Repo)
    suffix = Ecto.UUID.generate()
    account = Fixtures.insert_account("No snack #{suffix}")
    user = Fixtures.insert_user_with_membership(account, "no-snack-#{suffix}@example.com")

    recipe =
      Fixtures.insert_recipe("No snack #{suffix}",
        account_id: account.id,
        created_by_user_id: user.id,
        suitable_for_slots: ["lunch"]
      )

    {:ok, account: account, user: user, recipe: recipe}
  end

  describe "the stored snack rows" do
    test "are deleted with what hangs off them, and other slots are kept",
         %{migration: migration, account: account, user: user, recipe: recipe} do
      # The checks are tightened on this database, so the test widens them
      # again inside its sandbox transaction to store the rows a database
      # held before the migration.
      Repo.query!("ALTER TABLE scheduled_meals DROP CONSTRAINT scheduled_meals_slot_check")
      Repo.query!("ALTER TABLE recipes DROP CONSTRAINT recipes_slots_allowed_check")

      # The snack meal is stored in another slot first: the schema no longer
      # loads a snack row, and the leftover looks its meal up.
      snack = meal!(account, recipe, :breakfast, Date.utc_today())
      lunch = meal!(account, recipe, :lunch, Date.utc_today())
      snack_favorite = favorite!(account, user, snack, "snack")
      lunch_favorite = favorite!(account, user, lunch, "lunch")
      snack_item = item!(account, snack)
      lunch_item = item!(account, lunch)

      {:ok, leftover} =
        Leftovers.create(account.id, %{
          title: "Snack leftover",
          portions: 1,
          scheduled_meal_id: snack.id
        })

      Repo.query!("UPDATE scheduled_meals SET slot = 'snack' WHERE id = $1", [uuid(snack.id)])

      Repo.query!(
        "UPDATE recipes SET suitable_for_slots = ARRAY['lunch','snack','dinner'] WHERE id = $1",
        [uuid(recipe.id)]
      )

      Enum.each(migration.delete_snack_sql(), &Repo.query!/1)

      refute Repo.get(ScheduledMeal, snack.id)
      refute Repo.get(SlotFavorite, snack_favorite.id)
      refute Repo.get(ShoppingItem, snack_item.id)
      assert Repo.get!(PreparedLeftover, leftover.id).scheduled_meal_id == nil

      assert Repo.get!(ScheduledMeal, lunch.id).slot == :lunch
      assert Repo.get(SlotFavorite, lunch_favorite.id)
      assert Repo.get(ShoppingItem, lunch_item.id)
      assert Repo.get!(Recipe, recipe.id).suitable_for_slots == ["lunch", "dinner"]
    end
  end

  describe "the database checks" do
    test "refuse a Scheduled meal with the snack slot", %{account: account, recipe: recipe} do
      meal = meal!(account, recipe, :lunch, Date.utc_today())

      assert_raise Postgrex.Error, ~r/scheduled_meals_slot_check/, fn ->
        Repo.query!("UPDATE scheduled_meals SET slot = 'snack' WHERE id = $1", [uuid(meal.id)])
      end
    end

    test "refuse a Recipe suitable for the snack slot", %{recipe: recipe} do
      assert_raise Postgrex.Error, ~r/recipes_slots_allowed_check/, fn ->
        Repo.query!(
          "UPDATE recipes SET suitable_for_slots = ARRAY['lunch','snack'] WHERE id = $1",
          [uuid(recipe.id)]
        )
      end
    end

    test "accept the three Meal slots", %{account: account, recipe: recipe} do
      for {slot, days} <- [breakfast: 0, lunch: 1, dinner: 2] do
        assert %ScheduledMeal{slot: ^slot} =
                 meal!(account, recipe, slot, Date.add(Date.utc_today(), days))
      end

      Repo.query!(
        "UPDATE recipes SET suitable_for_slots = ARRAY['breakfast','lunch','dinner'] WHERE id = $1",
        [uuid(recipe.id)]
      )
    end
  end

  defp meal!(account, recipe, slot, date) do
    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account.id,
        recipe_id: recipe.id,
        date: date,
        slot: slot
      })

    meal
  end

  # The favorite is stored as a database held it before the migration, past
  # the changeset that refuses a snack slot.
  defp favorite!(account, user, meal, slot) do
    now = DateTime.utc_now()
    id = Ecto.UUID.generate()

    Repo.insert_all(SlotFavorite, [
      %{
        id: id,
        account_id: account.id,
        user_id: user.id,
        date: meal.date,
        slot: slot,
        scheduled_meal_id: meal.id,
        recipe_id: meal.recipe_id,
        inserted_at: now,
        updated_at: now
      }
    ])

    Repo.one!(from(f in SlotFavorite, where: f.id == ^id))
  end

  defp item!(account, meal) do
    ingredient = Fixtures.insert_ingredient("Snack ingredient #{Ecto.UUID.generate()}")

    {:ok, item} =
      Shopping.create_shopping_item(%{
        account_id: account.id,
        scheduled_meal_id: meal.id,
        planned_date: meal.date,
        ingredient_id: ingredient.id,
        unit: :g,
        quantity_milli: 100,
        status: :pending
      })

    item
  end

  defp uuid(id), do: Ecto.UUID.dump!(id)
end
