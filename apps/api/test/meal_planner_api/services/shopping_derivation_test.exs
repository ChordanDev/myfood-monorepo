defmodule MealPlannerApi.Services.ShoppingDerivationTest do
  @moduledoc """
  Reading the Shopping list derives the Shopping items the Scheduled meals
  still need. Any number of reads, one after another or at the same time,
  stores each of them once, and a derivation that fails is logged and
  degrades the read to the items already stored.

  `async: false`: one test installs a trigger on `shopping_items` and another
  one commits rows on real connections.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import ExUnit.CaptureLog

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Catalog.Ingredient
  alias MealPlannerApi.Persistence.Catalog.Recipe
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.ShoppingService
  alias MealPlannerApi.SubscriptionPlanFixtures

  @ingredient_count 3
  @meal_count 2
  @planned_item_count @ingredient_count * @meal_count

  describe "get_shopping_list/3 read one after another" do
    setup do
      :ok = Sandbox.checkout(Repo)
      :ok = SubscriptionPlanFixtures.ensure_plans!()
      {:ok, schedule_fixture()}
    end

    test "derives each planned Shopping item once and a second read adds none", f do
      assert {:ok, first} = ShoppingService.get_shopping_list(f.actor)
      assert length(listed_item_ids(first)) == @planned_item_count
      stored = stored_items(f)

      assert {:ok, second} = ShoppingService.get_shopping_list(f.actor)
      assert length(listed_item_ids(second)) == @planned_item_count
      assert stored_items(f) == stored
      assert_one_item_per_planned_key(f)
    end

    test "still answers with the stored Shopping items when the derivation fails", f do
      reject_shopping_inserts!(f.account.id)

      log =
        capture_log(fn ->
          assert {:ok, list} = ShoppingService.get_shopping_list(f.actor)
          assert list.planned == []
          assert list.totals.needed == 0
        end)

      assert log =~ "shopping item derivation failed"
      assert log =~ "account_id=#{f.account.id}"
      assert log =~ "shopping insert rejected by test"
      assert stored_items(f) == []
    end
  end

  # Runs on real connections, one per reader: a sandboxed connection is a
  # single transaction that never commits, so two readers on it could never
  # race for the same planned key. Every row is committed and has to be
  # deleted by hand.
  describe "get_shopping_list/3 read at the same time" do
    setup do
      :ok = Sandbox.checkout(Repo, sandbox: false)
      :ok = SubscriptionPlanFixtures.ensure_committed_plan!("family_4")
      suffix = Ecto.UUID.generate()
      on_exit(fn -> delete_committed_fixture(suffix) end)

      {:ok, schedule_fixture(suffix)}
    end

    test "stores each planned Shopping item once", f do
      readers = 6
      parent = self()
      supervisor = start_supervised!(Task.Supervisor)

      tasks =
        for _ <- 1..readers do
          Task.Supervisor.async(supervisor, fn ->
            :ok = Sandbox.checkout(Repo, sandbox: false)

            try do
              %{rows: [[backend]]} = Repo.query!("SELECT pg_backend_pid()")
              send(parent, {:ready, self(), backend})

              receive do
                :go -> ShoppingService.get_shopping_list(f.actor)
              after
                5_000 -> raise "shopping derivation barrier timed out"
              end
            after
              Sandbox.checkin(Repo)
            end
          end)
        end

      ready =
        for _ <- tasks do
          assert_receive {:ready, reader, backend}, 5_000
          {reader, backend}
        end

      assert ready |> Enum.map(&elem(&1, 1)) |> Enum.uniq() |> length() == readers
      Enum.each(ready, fn {reader, _backend} -> send(reader, :go) end)
      results = Task.await_many(tasks, 15_000)

      assert Enum.all?(results, &match?({:ok, _}, &1))
      assert_one_item_per_planned_key(f)

      # A read that starts after the race sees every item, none of them twice.
      assert {:ok, list} = ShoppingService.get_shopping_list(f.actor)
      assert length(listed_item_ids(list)) == @planned_item_count
    end
  end

  # The Shopping items a read lists: each allocation of a planned line is one
  # of them.
  defp listed_item_ids(list) do
    list.planned |> Enum.flat_map(& &1.allocations) |> Enum.map(& &1.item_id)
  end

  defp assert_one_item_per_planned_key(f) do
    keys =
      Enum.map(
        stored_items(f),
        &{&1.scheduled_meal_id, &1.planned_date, &1.ingredient_id, &1.unit}
      )

    expected =
      for meal <- f.meals, ingredient <- f.ingredients do
        {meal.id, meal.date, ingredient.id, :g}
      end

    assert Enum.sort(keys) == Enum.sort(expected)
  end

  defp stored_items(f) do
    Repo.all(from(i in ShoppingItem, where: i.account_id == ^f.account.id, order_by: i.id))
  end

  # An Account with a member and a recipe of several Ingredients scheduled on
  # consecutive days, starting today: a Shopping list read without
  # `until_date` covers every Scheduled meal, and an empty Inventory makes
  # each Ingredient a Shortage.
  defp schedule_fixture(suffix \\ Ecto.UUID.generate()) do
    account = Fixtures.insert_account("Shopping derivation #{suffix}")
    user = Fixtures.insert_user_with_membership(account, "derivation-#{suffix}@example.com")

    recipe =
      Fixtures.insert_recipe("Shopping derivation recipe #{suffix}", account_id: account.id)

    ingredients =
      for number <- 1..@ingredient_count do
        ingredient = Fixtures.insert_ingredient("Shopping derivation #{number} #{suffix}")
        Fixtures.attach_recipe_ingredient(recipe, ingredient, 250, :g)
        ingredient
      end

    meals =
      for days_ahead <- 0..(@meal_count - 1) do
        {:ok, meal} =
          Planning.schedule_meal(%{
            account_id: account.id,
            recipe_id: recipe.id,
            date: Date.add(Date.utc_today(), days_ahead),
            slot: :dinner
          })

        meal
      end

    %{
      account: account,
      actor: %{id: user.id, account_id: account.id},
      ingredients: ingredients,
      meals: meals
    }
  end

  # Finds the rows by the suffix in their names, so it also removes what a
  # setup that failed halfway left behind.
  defp delete_committed_fixture(suffix) do
    :ok = Sandbox.checkout(Repo, sandbox: false)
    account_ids = ids_named(Account, suffix)
    user_ids = ids_named(User, suffix)

    {:ok, _} =
      Repo.transaction(fn ->
        Repo.delete_all(from(i in ShoppingItem, where: i.account_id in ^account_ids))
        Repo.delete_all(from(m in ScheduledMeal, where: m.account_id in ^account_ids))

        # Scheduling a meal freezes a recipe version, and recipe versions
        # cannot be deleted. This one belongs to a recipe only this test
        # used, so the guard is lifted for this transaction alone.
        Repo.query!("ALTER TABLE recipe_versions DISABLE TRIGGER immutable_recipe_version_delete")
        Repo.delete_all(from(r in Recipe, where: r.account_id in ^account_ids))
        Repo.query!("ALTER TABLE recipe_versions ENABLE TRIGGER immutable_recipe_version_delete")

        Repo.delete_all(from(i in Ingredient, where: like(i.name, ^"%#{suffix}")))
        Repo.delete_all(from(m in AccountMembership, where: m.account_id in ^account_ids))
        Repo.delete_all(from(u in User, where: u.id in ^user_ids))
        Repo.delete_all(from(a in Account, where: a.id in ^account_ids))
      end)

    Sandbox.checkin(Repo)
  end

  defp ids_named(schema, suffix) do
    Repo.all(from(row in schema, where: like(row.name, ^"%#{suffix}%"), select: row.id))
  end

  # Sandbox-scoped failure injection: the trigger and its function are rolled
  # back with the transaction of the test.
  defp reject_shopping_inserts!(account_id) do
    Repo.query!("""
    CREATE FUNCTION reject_derived_shopping_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.account_id = '#{account_id}'::uuid THEN
        RAISE EXCEPTION 'shopping insert rejected by test';
      END IF;
      RETURN NEW;
    END $$
    """)

    Repo.query!(
      "CREATE TRIGGER reject_derived_shopping_insert BEFORE INSERT ON shopping_items FOR EACH ROW EXECUTE FUNCTION reject_derived_shopping_insert()"
    )
  end
end
