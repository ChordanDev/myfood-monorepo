defmodule MealPlannerApi.Persistence.Calendar.MealMoveConcurrencyTest do
  @moduledoc """
  A Scheduled meal move while other connections write: a write that takes the
  destination, a Shopping list derivation of the same meal, and a second swap
  that parks on the same key.

  Runs on real connections, one per writer: a sandboxed connection is a
  single transaction that never commits, so no writer could wait for another
  on it. Every row is committed and deleted by hand, hence `async: false`.
  A transaction that holds a row lock pauses each writer at a known step.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import ExUnit.CaptureLog
  import Phoenix.ConnTest
  import Plug.Conn

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.FactoryHelpers
  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership, User}
  alias MealPlannerApi.Persistence.Calendar.MealMove
  alias MealPlannerApi.Persistence.Catalog.{Ingredient, Recipe, SlotFavorite}
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.ShoppingService
  alias MealPlannerApi.SubscriptionPlanFixtures

  @endpoint MealPlannerApiWeb.Endpoint
  @ingredient_count 2

  setup do
    :ok = Sandbox.checkout(Repo, sandbox: false)
    :ok = SubscriptionPlanFixtures.ensure_committed_plan!("family_4")
    suffix = Ecto.UUID.generate()
    on_exit(fn -> delete_committed_fixture(suffix) end)

    {:ok, fixture(suffix)}
  end

  test "a write that takes the destination meanwhile answers 409 calendar_conflict", f do
    source = meal!(f, 2, :dinner)
    destination = day(f, 1)
    # The meal it inserts is not visible to the move until it commits, so the
    # move finds the destination empty and waits on its key.
    gate = hold(fn -> meal!(f, 1, :lunch) end)

    log =
      capture_log(fn ->
        {request, backend} = on_own_connection(fn -> move_over_http(f, source, destination) end)
        wait_until_blocked_by(backend, gate.backend)
        release(gate, :commit)

        conn = Task.await(request, 10_000)

        assert %{"error" => %{"code" => "calendar_conflict", "message" => message}} =
                 json_response(conn, 409)

        assert message =~ "changed"
      end)

    assert log =~ "calendar meal move conflict"
    assert log =~ "constraint=scheduled_meals_account_id_date_slot_index"
    assert position(source) == {day(f, 2), :dinner}
  end

  test "a move that starts while a Shopping list derivation holds its locks waits for it and takes the new items along",
       f do
    meal = meal!(f, 1, :dinner)
    loaded = loaded_meals(f)
    new_date = day(f, 3)

    # The foreign key check of the derivation's insert takes a lock on each
    # Ingredient, so holding one pauses the derivation after it took its meal
    # locks. The gate does not touch the meal.
    gate = hold(fn -> lock_ingredient!(hd(f.ingredients)) end)

    {derivation, derivation_backend} =
      on_own_connection(fn ->
        ShoppingService.ensure_shopping_items_from_schedule(f.account.id, loaded)
      end)

    wait_until_blocked_by(derivation_backend, gate.backend)

    {move, move_backend} =
      on_own_connection(fn ->
        MealMove.move(f.account.id, meal.id, new_date, :dinner, f.today)
      end)

    wait_until_blocked_by(move_backend, derivation_backend)
    release(gate, :rollback)

    assert :ok = Task.await(derivation, 10_000)
    assert {:ok, _} = Task.await(move, 10_000)
    assert planned_keys(f) == expected_keys(f, meal, new_date)
  end

  test "a Shopping list derivation that starts while a move holds its locks waits for it and stores nothing for the date the meal left",
       f do
    meal = meal!(f, 1, :dinner)
    favorite = slot_favorite!(f, meal)
    loaded = loaded_meals(f)
    new_date = day(f, 3)

    # The move exchanges the Slot favorites after the meals, so holding the
    # favorite pauses it with the meal moved and locked.
    gate = hold(fn -> lock_slot_favorite!(favorite) end)

    {move, move_backend} =
      on_own_connection(fn ->
        MealMove.move(f.account.id, meal.id, new_date, :dinner, f.today)
      end)

    wait_until_blocked_by(move_backend, gate.backend)

    {derivation, derivation_backend} =
      on_own_connection(fn ->
        ShoppingService.ensure_shopping_items_from_schedule(f.account.id, loaded)
      end)

    wait_until_blocked_by(derivation_backend, move_backend)
    release(gate, :rollback)

    assert {:ok, _} = Task.await(move, 10_000)
    assert :ok = Task.await(derivation, 10_000)
    assert planned_keys(f) == []

    # The next read loads the meal where it is now and derives it there.
    assert :ok =
             ShoppingService.ensure_shopping_items_from_schedule(f.account.id, loaded_meals(f))

    assert planned_keys(f) == expected_keys(f, meal, new_date)
  end

  test "two swaps that park on the same key run one after the other", f do
    first_source = meal!(f, 1, :dinner)
    first_target = meal!(f, 2, :lunch)
    second_source = meal!(f, 3, :dinner)
    second_target = meal!(f, 4, :lunch)
    favorite = slot_favorite!(f, first_source)

    # The first swap has parked its source and moved both meals when it waits
    # on the favorite; the second one parks its source on the same key.
    gate = hold(fn -> lock_slot_favorite!(favorite) end)

    {first, first_backend} =
      on_own_connection(fn ->
        MealMove.move(f.account.id, first_source.id, day(f, 2), :lunch, f.today)
      end)

    wait_until_blocked_by(first_backend, gate.backend)

    {second, second_backend} =
      on_own_connection(fn ->
        MealMove.move(f.account.id, second_source.id, day(f, 4), :lunch, f.today)
      end)

    wait_until_blocked_by(second_backend, first_backend)
    release(gate, :rollback)

    assert {:ok, _} = Task.await(first, 10_000)
    assert {:ok, _} = Task.await(second, 10_000)
    assert position(first_source) == {day(f, 2), :lunch}
    assert position(first_target) == {day(f, 1), :dinner}
    assert position(second_source) == {day(f, 4), :lunch}
    assert position(second_target) == {day(f, 3), :dinner}
    assert Repo.get!(SlotFavorite, favorite.id).date == day(f, 2)
  end

  # Runs `fun` on a connection of its own and returns the task with that
  # connection's backend pid.
  defp on_own_connection(fun) do
    parent = self()

    task =
      Task.async(fn ->
        :ok = Sandbox.checkout(Repo, sandbox: false)

        try do
          %{rows: [[backend]]} = Repo.query!("SELECT pg_backend_pid()")
          send(parent, {:backend, self(), backend})
          fun.()
        after
          Sandbox.checkin(Repo)
        end
      end)

    worker = task.pid
    assert_receive {:backend, ^worker, backend}, 5_000
    {task, backend}
  end

  # Runs `fun` in a transaction of its own connection and keeps the
  # transaction open, with its locks, until `release/2`.
  defp hold(fun) do
    parent = self()

    {task, backend} =
      on_own_connection(fn ->
        Repo.transaction(fn ->
          fun.()
          send(parent, {:holding, self()})

          receive do
            {:release, ^parent, :commit} -> :committed
            {:release, ^parent, :rollback} -> Repo.rollback(:released)
          after
            10_000 -> Repo.rollback(:gate_timeout)
          end
        end)
      end)

    holder = task.pid
    assert_receive {:holding, ^holder}, 5_000
    %{task: task, backend: backend}
  end

  defp release(gate, how) do
    send(gate.task.pid, {:release, self(), how})
    Task.await(gate.task, 5_000)
  end

  # Returns once `blocked` waits for a lock that `blocker` holds, as the lock
  # table shows it; gives up after about two seconds.
  defp wait_until_blocked_by(blocked, blocker, attempts \\ 200)

  defp wait_until_blocked_by(blocked, blocker, 0),
    do: flunk("backend #{blocked} never waited for a lock of backend #{blocker}")

  defp wait_until_blocked_by(blocked, blocker, attempts) do
    %{rows: [[blocking]]} = Repo.query!("SELECT pg_blocking_pids($1)", [blocked])

    if blocker in blocking do
      :ok
    else
      Process.sleep(10)
      wait_until_blocked_by(blocked, blocker, attempts - 1)
    end
  end

  defp move_over_http(f, meal, date) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> f.token)
    |> post("/api/calendar/meals/#{meal.id}/move", %{
      "date" => Date.to_iso8601(date),
      "slot" => "lunch"
    })
  end

  # An Account with a member and a recipe of several Ingredients. An empty
  # Inventory makes each Ingredient a Shortage of every meal of the recipe.
  defp fixture(suffix) do
    account = Fixtures.insert_account("Meal move #{suffix}")
    user = Fixtures.insert_user_with_membership(account, "meal-move-#{suffix}@example.com")
    membership = Repo.get_by!(AccountMembership, user_id: user.id) |> Repo.preload(:account)
    recipe = Fixtures.insert_recipe("Meal move recipe #{suffix}", account_id: account.id)

    ingredients =
      for number <- 1..@ingredient_count do
        ingredient = Fixtures.insert_ingredient("Meal move #{number} #{suffix}")
        Fixtures.attach_recipe_ingredient(recipe, ingredient, 250, :g)
        ingredient
      end

    %{
      account: account,
      user: user,
      token: FactoryHelpers.issue_access_v2_token(user, membership),
      recipe: recipe,
      ingredients: ingredients,
      today: MealPlannerApi.AccountClock.today(account.id)
    }
  end

  defp day(f, days_ahead), do: Date.add(f.today, days_ahead)

  defp meal!(f, days_ahead, slot) do
    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: f.account.id,
        recipe_id: f.recipe.id,
        date: day(f, days_ahead),
        slot: slot
      })

    meal
  end

  defp slot_favorite!(f, meal) do
    %SlotFavorite{}
    |> SlotFavorite.changeset(%{
      account_id: f.account.id,
      user_id: f.user.id,
      date: meal.date,
      slot: Atom.to_string(meal.slot),
      scheduled_meal_id: meal.id,
      recipe_id: f.recipe.id
    })
    |> Repo.insert!()
  end

  defp lock_slot_favorite!(favorite) do
    Repo.one!(from(s in SlotFavorite, where: s.id == ^favorite.id, lock: "FOR UPDATE"))
  end

  defp lock_ingredient!(ingredient) do
    Repo.one!(from(i in Ingredient, where: i.id == ^ingredient.id, lock: "FOR UPDATE"))
  end

  defp loaded_meals(f) do
    Repo.all(from(m in ScheduledMeal, where: m.account_id == ^f.account.id, order_by: m.id))
  end

  defp position(meal) do
    stored = Repo.get!(ScheduledMeal, meal.id)
    {stored.date, stored.slot}
  end

  defp planned_keys(f) do
    from(i in ShoppingItem,
      where: i.account_id == ^f.account.id,
      select: {i.scheduled_meal_id, i.planned_date, i.ingredient_id, i.status}
    )
    |> Repo.all()
    |> Enum.sort()
  end

  defp expected_keys(f, meal, date) do
    Enum.sort(for ingredient <- f.ingredients, do: {meal.id, date, ingredient.id, :pending})
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
        Repo.delete_all(from(s in SlotFavorite, where: s.account_id in ^account_ids))
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
end
