defmodule MealPlannerApi.Services.ShoppingDerivationTest do
  @moduledoc """
  Reading the Shopping list derives the Shopping items the Scheduled meals
  still need. Any number of reads, one after another or at the same time,
  stores each of them once, and a derivation that fails is logged and
  degrades the read to the items already stored.

  A read also brings every `pending` planned item in line with the Shortage
  it computes (issue #277): it takes the new quantity, or goes when the
  Shortage is zero. Items in a Cart, removed, bought or added by hand are
  never changed by a read.

  `async: false`: one test installs a trigger on `shopping_items` and another
  one commits rows on real connections.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import ExUnit.CaptureLog

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Generation.Server
  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Catalog.Ingredient
  alias MealPlannerApi.Persistence.Catalog.Recipe
  alias MealPlannerApi.Persistence.Inventory.InventoryItem
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Persistence.Shopping
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

  describe "get_shopping_list/3 against stored items with another quantity (#277)" do
    setup do
      :ok = Sandbox.checkout(Repo)
      :ok = SubscriptionPlanFixtures.ensure_plans!()
      f = schedule_fixture()
      assert {:ok, _list} = ShoppingService.get_shopping_list(f.actor)
      [first_meal, second_meal] = f.meals
      [ingredient | _] = f.ingredients

      {:ok,
       Map.merge(f, %{first_meal: first_meal, second_meal: second_meal, ingredient: ingredient})}
    end

    test "inventory that grows after the derivation shrinks the pending quantity", f do
      insert_stock!(f, f.ingredient, 100)

      assert {:ok, _list} = ShoppingService.get_shopping_list(f.actor)

      # The stock goes to the first meal, the one cooked first.
      assert %{status: :pending, quantity_milli: 150} = item(f, f.first_meal, f.ingredient)
      assert %{status: :pending, quantity_milli: 250} = item(f, f.second_meal, f.ingredient)
    end

    test "a pending item stored with a smaller quantity grows to the Shortage", f do
      stale = item(f, f.first_meal, f.ingredient)
      Repo.update!(Ecto.Changeset.change(stale, quantity_milli: 40))

      assert {:ok, list} = ShoppingService.get_shopping_list(f.actor)

      assert %{id: id, quantity_milli: 250} = item(f, f.first_meal, f.ingredient)
      assert id == stale.id
      assert line_quantity(list, f.ingredient) == 500
    end

    test "inventory that covers it deletes the pending item, and a later Shortage brings it back",
         f do
      stock = insert_stock!(f, f.ingredient, 250)
      covered = item(f, f.first_meal, f.ingredient)

      assert {:ok, list} = ShoppingService.get_shopping_list(f.actor)

      assert Repo.get(ShoppingItem, covered.id) == nil
      assert %{quantity_milli: 250} = item(f, f.second_meal, f.ingredient)
      assert line_quantity(list, f.ingredient) == 250

      Repo.delete!(stock)
      assert {:ok, _list} = ShoppingService.get_shopping_list(f.actor)
      assert %{status: :pending, quantity_milli: 250} = item(f, f.first_meal, f.ingredient)
    end

    test "never changes an item in a Cart, removed, bought or added by hand", f do
      [_first, second_ingredient, third_ingredient] = f.ingredients
      reserved = item(f, f.first_meal, f.ingredient)
      assert {:ok, _cart} = MealPlannerApi.Cart.reserve(f.actor, [reserved.id])
      in_cart = Repo.get!(ShoppingItem, reserved.id)
      assert in_cart.status == :in_cart

      bought =
        Repo.update!(
          Ecto.Changeset.change(item(f, f.second_meal, f.ingredient), status: :checked_out)
        )

      removed = item(f, f.first_meal, second_ingredient)

      assert {:ok, _} =
               ShoppingService.set_item_status(f.actor, %{
                 "item_id" => removed.id,
                 "status" => "removed"
               })

      {:ok, manual} =
        Shopping.create_manual_item(%{
          account_id: f.account.id,
          name: "Dish soap",
          ingredient_id: third_ingredient.id,
          quantity_milli: 1_000,
          unit: :g
        })

      # Enough stock to cover every meal: each pending item would go.
      for ingredient <- f.ingredients, do: insert_stock!(f, ingredient, 10_000)

      assert {:ok, _list} = ShoppingService.get_shopping_list(f.actor)

      for kept <- [in_cart, bought, manual] do
        assert %{status: status, quantity_milli: quantity} = Repo.get!(ShoppingItem, kept.id)
        assert {status, quantity} == {kept.status, kept.quantity_milli}
      end

      assert %{status: :removed, quantity_milli: 250} = Repo.get!(ShoppingItem, removed.id)

      # The pending items of the other Ingredients are covered and gone.
      assert item(f, f.second_meal, second_ingredient) == nil
      assert item(f, f.first_meal, third_ingredient) == nil
    end

    test "a restored item the stock covers is not listed", f do
      removed = item(f, f.first_meal, f.ingredient)

      assert {:ok, _} =
               ShoppingService.set_item_status(f.actor, %{
                 "item_id" => removed.id,
                 "status" => "removed"
               })

      insert_stock!(f, f.ingredient, 250)

      assert {:ok, _} =
               ShoppingService.set_item_status(f.actor, %{
                 "item_id" => removed.id,
                 "status" => "needed"
               })

      assert {:ok, list} = ShoppingService.get_shopping_list(f.actor)
      assert Repo.get(ShoppingItem, removed.id) == nil
      refute removed.id in listed_item_ids(list)
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

  # Real connections, as above. The plan confirm runs in the Generation
  # server, on the connection of the test; the read and the holder of the row
  # lock have one each.
  describe "get_shopping_list/3 at the same time as a plan confirm rebuild" do
    setup do
      :ok = Sandbox.checkout(Repo, sandbox: false)
      :ok = SubscriptionPlanFixtures.ensure_committed_plan!("family_4")
      suffix = Ecto.UUID.generate()
      on_exit(fn -> delete_committed_fixture(suffix) end)

      {:ok, schedule_fixture(suffix)}
    end

    test "a read that meets the rebuild's wipe leaves one item per planned key", f do
      [first_meal, _second_meal] = f.meals
      [ingredient | _] = f.ingredients
      assert {:ok, _list} = ShoppingService.get_shopping_list(f.actor)

      # A stale quantity, so the read has a pending item to correct.
      stale = item(f, first_meal, ingredient)
      Repo.update!(Ecto.Changeset.change(stale, quantity_milli: 40))

      {pid, proposal, session} = start_confirmable_plan!(f)
      supervisor = start_supervised!(Task.Supervisor)
      parent = self()

      # Holds the stale item's row lock, so the rebuild stops in its wipe.
      holder =
        Task.Supervisor.async(supervisor, fn ->
          on_real_connection(fn ->
            Repo.transaction(fn ->
              Repo.one!(from(i in ShoppingItem, where: i.id == ^stale.id, lock: "FOR UPDATE"))
              send(parent, {:holding, backend_pid()})

              receive do
                :release -> :ok
              after
                10_000 -> raise "row lock holder timed out"
              end
            end)
          end)
        end)

      assert_receive {:holding, holder_backend}, 5_000

      confirm =
        Task.Supervisor.async(supervisor, fn -> Server.confirm(pid, proposal.id, session.id) end)

      wait_until_waiting(holder_backend, :blocks)

      reader =
        Task.Supervisor.async(supervisor, fn ->
          on_real_connection(fn ->
            send(parent, {:reading, backend_pid()})
            ShoppingService.get_shopping_list(f.actor)
          end)
        end)

      # The read waits for the stale item behind the rebuild.
      assert_receive {:reading, reader_backend}, 5_000
      wait_until_waiting(reader_backend)
      send(holder.pid, :release)

      assert {:ok, _} = Task.await(holder, 10_000)
      assert {:ok, _reply} = Task.await(confirm, 15_000)
      assert {:ok, _list} = Task.await(reader, 15_000)

      # The confirm added a third meal.
      meals = Repo.all(from(m in ScheduledMeal, where: m.account_id == ^f.account.id))
      assert length(meals) == @meal_count + 1
      assert_one_item_per_planned_key(%{f | meals: meals})
      assert Enum.all?(stored_items(f), &(&1.status == :pending and &1.quantity_milli == 250))
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
    Repo.all(
      from(i in ShoppingItem,
        where: i.account_id == ^f.account.id and i.source == :planned_meal,
        order_by: i.id
      )
    )
  end

  defp item(f, meal, ingredient) do
    Repo.one(
      from(i in ShoppingItem,
        where:
          i.account_id == ^f.account.id and i.scheduled_meal_id == ^meal.id and
            i.ingredient_id == ^ingredient.id
      )
    )
  end

  defp line_quantity(list, ingredient) do
    list.planned
    |> Enum.filter(&(&1.ingredient_id == ingredient.id and &1.status == "needed"))
    |> Enum.map(& &1.quantity_milli)
    |> Enum.sum()
  end

  defp insert_stock!(f, ingredient, quantity_milli) do
    Repo.insert!(%InventoryItem{
      account_id: f.account.id,
      ingredient_id: ingredient.id,
      quantity_milli: quantity_milli,
      unit: :g,
      source_kind: :extra,
      last_mutation_at: DateTime.utc_now()
    })
  end

  # A proposal for a third day of the fixture's recipe and an active planning
  # session whose window holds every meal, with the Generation server of the
  # Account allowed on the test's connection.
  defp start_confirmable_plan!(f) do
    today = Date.utc_today()
    owner = Repo.get_by!(AccountMembership, account_id: f.account.id)
    recipe_id = hd(f.meals).recipe_id

    {_run, proposal} =
      Fixtures.insert_proposal_with_slots(
        f.account,
        %{id: owner.user_id},
        [Fixtures.slot(Date.add(today, 2), :dinner, recipe_id)]
      )

    {:ok, session} =
      PlanningRepo.create_session(f.account.id, %{
        range_from: today,
        range_to: Date.add(today, 6),
        lock_owner_user_id: owner.user_id,
        lock_owner_membership_id: owner.id,
        lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
      })

    via = {:via, Registry, {MealPlannerApi.Generation.Generations, {:generation, f.account.id}}}

    pid =
      start_supervised!(
        {Server, account_id: f.account.id, user_id: owner.user_id, name: via},
        id: {:generation_server, f.account.id}
      )

    Sandbox.allow(Repo, self(), pid)
    {pid, proposal, session}
  end

  defp on_real_connection(fun) do
    :ok = Sandbox.checkout(Repo, sandbox: false)

    try do
      fun.()
    after
      Sandbox.checkin(Repo)
    end
  end

  defp backend_pid do
    %{rows: [[backend]]} = Repo.query!("SELECT pg_backend_pid()")
    backend
  end

  # Waits until the connection `backend` waits for a lock (`:waits`), or
  # until another connection waits for one it holds (`:blocks`). It asks on a
  # connection of its own: the test's one runs the confirm.
  defp wait_until_waiting(backend, role \\ :waits) do
    fn -> on_real_connection(fn -> poll_waiting(backend, role, 100) end) end
    |> Task.async()
    |> Task.await(10_000)
  end

  defp poll_waiting(_backend, _role, 0), do: flunk("no connection waited for a lock")

  defp poll_waiting(backend, role, attempts) do
    sql =
      case role do
        :waits ->
          "SELECT cardinality(pg_blocking_pids($1)) > 0"

        :blocks ->
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))"
      end

    case Repo.query!(sql, [backend]) do
      %{rows: [[true]]} ->
        :ok

      _not_yet ->
        Process.sleep(50)
        poll_waiting(backend, role, attempts - 1)
    end
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
