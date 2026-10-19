defmodule MealPlannerApi.Data.ShoppingRemovalsBackfillMigrationTest do
  @moduledoc """
  The Shopping removals backfill (issue #334): an item the User removed
  before the `shopping_removals` table existed keeps its removal, so a plan
  confirm or a range replace does not bring it back as needed.
  """
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.{Planning, Shopping}
  alias MealPlannerApi.Persistence.Shopping.ShoppingRemoval
  alias MealPlannerApi.Repo

  @migration MealPlannerApi.Repo.Migrations.CreateShoppingRemovals
  @migration_path Path.expand(
                    "../../../priv/repo/migrations/20261018000000_create_shopping_removals.exs",
                    __DIR__
                  )

  setup_all do
    # `mix ecto.migrate` may have compiled the migration in this VM already.
    unless Code.ensure_loaded?(@migration), do: Code.require_file(@migration_path)
    {:ok, migration: @migration}
  end

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  test "stores one removal per meal and Ingredient of every removed planned item",
       %{migration: migration} do
    suffix = Ecto.UUID.generate()
    account = Fixtures.insert_account("Backfill #{suffix}")
    user = Fixtures.insert_user_with_membership(account, "backfill-#{suffix}@example.com")

    recipe =
      Fixtures.insert_recipe("Backfill #{suffix}", account_id: account.id, user_id: user.id)

    [removed, two_units, kept, already] =
      for n <- 1..4, do: Fixtures.insert_ingredient("I#{n} #{suffix}")

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account.id,
        recipe_id: recipe.id,
        date: Date.utc_today(),
        slot: :dinner
      })

    item!(account, meal, removed, :g, :removed)
    # The same Ingredient removed in two units is one removal.
    item!(account, meal, two_units, :g, :removed)
    item!(account, meal, two_units, :ml, :removed)
    # An item that is still to buy has no removal.
    item!(account, meal, kept, :g, :pending)
    # A pair stored since the table exists is kept as it is.
    item!(account, meal, already, :g, :removed)
    :ok = Shopping.put_removals(account.id, [{meal.id, already.id}])

    # A manual item has no meal: removing it stores no removal.
    {:ok, _manual} =
      Shopping.create_shopping_item(%{
        account_id: account.id,
        source: :manual,
        name: "Manual #{suffix}",
        ingredient_id: kept.id,
        unit: :g,
        quantity_milli: 100,
        status: :removed
      })

    Repo.query!(migration.backfill_sql())

    assert removal_pairs(account) ==
             Enum.sort([{meal.id, removed.id}, {meal.id, two_units.id}, {meal.id, already.id}])
  end

  defp item!(account, meal, ingredient, unit, status) do
    {:ok, item} =
      Shopping.create_shopping_item(%{
        account_id: account.id,
        scheduled_meal_id: meal.id,
        planned_date: meal.date,
        ingredient_id: ingredient.id,
        unit: unit,
        quantity_milli: 100,
        status: status
      })

    item
  end

  defp removal_pairs(account) do
    from(r in ShoppingRemoval,
      where: r.account_id == ^account.id,
      select: {r.scheduled_meal_id, r.ingredient_id}
    )
    |> Repo.all()
    |> Enum.sort()
  end
end
