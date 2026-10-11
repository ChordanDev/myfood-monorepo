defmodule MealPlannerApi.Services.CookingAtomicityTest do
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL
  alias MealPlannerApi.Cart
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory.{InventoryItem, InventoryMutationEvent}
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.{CookingSession, ScheduledMeal}
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Persistence.Shopping.{CheckoutSession, ShoppingItem}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.CookingService

  @moduletag :runtime_db_concurrency
  unless MealPlannerApi.Issue38Database.enabled?() do
    @moduletag skip: "requires test/support/issue38_concurrency_runner.exs and a fresh database"
  end

  setup_all do
    database = MealPlannerApi.Issue38Database.database!()

    repo =
      start_supervised!(
        {Repo,
         name: nil,
         database: database,
         pool: DBConnection.ConnectionPool,
         pool_size: 4,
         timeout: 10_000,
         parameters: [lock_timeout: "3000", statement_timeout: "8000"]}
      )

    assert %{rows: [[^database]]} =
             SQL.query!(repo, "SELECT current_database()", [])

    {:ok, repo: repo}
  end

  setup %{repo: repo} do
    Repo.put_dynamic_repo(repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    fixture = fixture()

    # UUID-scoped committed fixtures remain in this fresh database. Recipe versions
    # are immutable, so deleting their recipe/account roots is not valid cleanup.
    {:ok, fixture}
  end

  test "completion consumes FEFO lots once, audits the actor, and excludes expired and extra stock",
       f do
    first = hd(f.ingredients)
    later = hd(f.lots)
    now = DateTime.utc_now()
    early = lot!(f, first, %{quantity_milli: 100, expired_at: DateTime.add(now, 86_400)})
    expired = lot!(f, first, %{expired_at: DateTime.add(now, -86_400)})
    extra = lot!(f, first, %{source_kind: :extra})

    assert {:ok, %{inventory_mutations: mutations}} = finish(f)
    assert length(mutations) == 3
    assert Repo.get!(InventoryItem, early.id).quantity_milli == 0
    assert Repo.get!(InventoryItem, later.id).quantity_milli == 900
    assert Repo.get!(InventoryItem, expired.id).quantity_milli == 1000
    assert Repo.get!(InventoryItem, extra.id).quantity_milli == 1000
    assert Repo.get!(ScheduledMeal, f.meal.id).is_cooked
    completed = Repo.get!(CookingSession, f.session.id)
    assert completed.status == :completed
    assert completed.completed_at

    events = events(f)
    assert length(events) == 3
    assert Enum.sum(Enum.map(events, & &1.quantity_delta_milli)) == -400

    for event <- events do
      assert event.account_id == f.account.id
      assert event.source_user_id == f.user.id
      assert event.source_cooking_session_id == f.session.id
      assert event.trigger_type == :cooking

      assert event.quantity_before_milli + event.quantity_delta_milli ==
               event.quantity_after_milli
    end

    assert {:error, :cooking_already_finished} = finish(f)
    assert events(f) == events
    assert Repo.get!(CookingSession, f.session.id) == completed
  end

  test "another account cannot finish the session or consume its stock", f do
    foreign = fixture()

    assert {:error, :session_not_found} =
             CookingService.finish_session(foreign.actor, f.session.id)

    assert_unchanged(f)
    assert_unchanged(foreign)
  end

  for {table, field} <- [
        {"inventory_mutation_events", "source_user_id"},
        {"scheduled_meals", "ai_generation_id"},
        {"cooking_sessions", "account_id"}
      ] do
    test "failure writing #{table} rolls back session, meal, all lots and audit events", f do
      table = unquote(table)
      field = unquote(field)
      last_lot = List.last(f.lots)

      condition =
        if table == "inventory_mutation_events",
          do: "NEW.inventory_item_id = '#{last_lot.id}'::uuid",
          else:
            "NEW.id = '#{if table == "scheduled_meals", do: f.meal.id, else: f.session.id}'::uuid"

      # Fail a declared FK through the real persistence seam, after earlier deductions.
      # Both DDL objects are removed even if a behavioral assertion fails.
      Repo.query!("""
      CREATE FUNCTION cooking_atomicity_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF #{condition} THEN
          IF NOT EXISTS (SELECT 1 FROM inventory_mutation_events
                         WHERE source_cooking_session_id = '#{f.session.id}'::uuid) THEN
            RAISE EXCEPTION 'failure injection must follow an earlier audit write';
          END IF;
          NEW.#{field} := '00000000-0000-0000-0000-000000000000'::uuid;
        END IF;
        RETURN NEW;
      END $$
      """)

      try do
        Repo.query!("""
        CREATE TRIGGER cooking_atomicity_failure BEFORE INSERT OR UPDATE ON #{table}
        FOR EACH ROW EXECUTE FUNCTION cooking_atomicity_failure()
        """)

        assert {:error, _reason} = finish(f)
        assert_unchanged(f)
      after
        Repo.query!("DROP TRIGGER IF EXISTS cooking_atomicity_failure ON #{table}")
        Repo.query!("DROP FUNCTION cooking_atomicity_failure()")
      end

      assert {:ok, %{inventory_mutations: [_, _]}} = finish(f)
      assert length(events(f)) == 2
    end
  end

  for separate_session? <- [false, true] do
    test "concurrent completion deducts once with separate_session=#{separate_session?}", f do
      other =
        if unquote(separate_session?), do: session!(f.account.id, f.meal.id), else: f.session

      results = concurrent_finish(f, [f.session.id, other.id])

      # The loser waits on the meal lock and then sees the meal already cooked.
      assert [{:error, :cooking_already_finished}, {:ok, %{inventory_mutations: [_, _]}}] =
               Enum.sort_by(results, &elem(&1, 0))

      assert length(events(f)) == 2
      assert Enum.all?(f.lots, &(Repo.get!(InventoryItem, &1.id).quantity_milli == 800))

      completed =
        [f.session.id, other.id]
        |> Enum.uniq()
        |> Enum.count(&(Repo.get!(CookingSession, &1).status == :completed))

      assert completed == 1
      assert Repo.get!(ScheduledMeal, f.meal.id).is_cooked
    end
  end

  test "distinct meals sharing ingredients serialize their deductions without losing stock", f do
    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: f.account.id,
        recipe_id: f.recipe.id,
        date: Date.add(Date.utc_today(), 1),
        slot: :dinner
      })

    other = session!(f.account.id, meal.id)
    results = concurrent_finish(f, [f.session.id, other.id])

    assert [{:ok, %{inventory_mutations: [_, _]}}, {:ok, %{inventory_mutations: [_, _]}}] =
             results

    assert length(events(f)) == 4
    assert Enum.all?(f.lots, &(Repo.get!(InventoryItem, &1.id).quantity_milli == 600))
  end

  test "concurrent starts of one meal share a single Cooking session", f do
    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: f.account.id,
        recipe_id: f.recipe.id,
        date: MealPlannerApi.AccountClock.today(f.account.id),
        slot: :lunch
      })

    parent = self()
    supervisor = start_supervised!(Task.Supervisor)

    workers =
      for _ <- 1..2 do
        Task.Supervisor.async_nolink(supervisor, fn ->
          start_behind_barrier(f, parent, meal.id)
        end)
      end

    ready =
      for _ <- workers do
        assert_receive {:ready, worker, pid}, 5_000
        {worker, pid}
      end

    assert length(Enum.uniq(Enum.map(ready, &elem(&1, 1)))) == 2
    Enum.each(ready, fn {worker, _pid} -> send(worker, :start) end)

    # The second start waits on the meal lock and then finds the first one's session.
    assert [{:ok, {:ok, first}}, {:ok, {:ok, second}}] = Task.await_many(workers, 12_000)
    assert first.session_id == second.session_id

    assert Repo.aggregate(
             from(s in CookingSession, where: s.scheduled_meal_id == ^meal.id),
             :count
           ) == 1
  end

  # Issue #147. A checkout locks its Shopping items and then takes the
  # Inventory key. A finish that takes the Inventory key before the meal's
  # Shopping rows waits for the checkout while the checkout waits for it.
  test "a checkout holding the meal's in-cart Shopping item and a finish of that meal both complete",
       f do
    ingredient = hd(f.ingredients)
    on_exit(fn -> delete_cart_state(f) end)
    {item, cart} = in_cart_item!(f, ingredient, 500)
    supervisor = start_supervised!(Task.Supervisor)

    {checkout_result, finish_result} =
      with_checkout_gate(item, fn holder, open_gate ->
        # An unlisted line is bought at its reserved quantity.
        checkout =
          worker(supervisor, f, fn ->
            Cart.purchase(f.actor, cart.session_id, %{"checkout_type" => "physical"})
          end)

        # The checkout waits inside the update that closes the item: it holds
        # the item row and, of the advisory keys, only the Cart one.
        wait_until_blocked_by(checkout.backend, holder)

        assert %{rows: [[1]]} =
                 Repo.query!(
                   "SELECT count(*) FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND granted",
                   [checkout.backend]
                 )

        finish = worker(supervisor, f, fn -> finish(f) end)
        wait_until_blocked_by(finish.backend, checkout.backend)

        # The checkout goes on to the Inventory key.
        open_gate.()
        {Task.await(checkout.task, 12_000), Task.await(finish.task, 12_000)}
      end)

    refute {:aborted, :deadlock_detected} in [checkout_result, finish_result]
    assert {:ok, %{status: "completed", moved_to_inventory_count: 1}} = checkout_result
    assert {:ok, %{inventory_mutations: [_, _], shortages: []}} = finish_result

    assert Repo.get!(CookingSession, f.session.id).status == :completed
    assert Repo.get!(ScheduledMeal, f.meal.id).is_cooked

    # The finish waited for the item row, so it read it as the checkout left
    # it: bought, no longer open, and therefore kept.
    assert %{status: :checked_out, quantity_milli: 500} = Repo.get!(ShoppingItem, item.id)

    # The bought lot went in and the cooked quantity came out, once each.
    assert Repo.aggregate(
             from(i in InventoryItem,
               where: i.account_id == ^f.account.id and i.ingredient_id == ^ingredient.id
             ),
             :sum,
             :quantity_milli
           ) == 1300

    assert Enum.frequencies_by(events(f), & &1.trigger_type) == %{purchase: 1, cooking: 2}
  end

  # A planned Shopping item of the fixture's meal, reserved in the actor's Cart.
  defp in_cart_item!(f, ingredient, quantity_milli) do
    {:ok, item} =
      Shopping.create_shopping_item(%{
        account_id: f.account.id,
        scheduled_meal_id: f.meal.id,
        planned_date: f.meal.date,
        ingredient_id: ingredient.id,
        unit: :g,
        quantity_milli: quantity_milli,
        status: :pending
      })

    {:ok, cart} = Cart.reserve(f.actor, [item.id])
    {item, cart}
  end

  # The Cart migration round-trip of `cart_concurrency_test.exs` runs on this
  # database and requires that no reservation or purchase is left in it.
  defp delete_cart_state(f) do
    Repo.put_dynamic_repo(f.repo)
    Repo.delete_all(from(i in ShoppingItem, where: i.account_id == ^f.account.id))
    Repo.delete_all(from(c in CheckoutSession, where: c.account_id == ^f.account.id))
  end

  # Pauses the real `Cart.purchase/3` between its Shopping row locks and the
  # Inventory key, a point where `cart.ex` has no seam: a trigger makes the
  # update that closes `item` wait for an advisory lock this connection holds
  # until `open_gate` is called. Every other lock is the checkout's own.
  defp with_checkout_gate(item, fun) do
    # Above every `hashtext/1` key (an int4), so it is no Cart or Inventory key.
    gate = 0x1_0000_0000 + System.unique_integer([:positive])

    Repo.checkout(fn ->
      %{rows: [[holder]]} = Repo.query!("SELECT pg_backend_pid()")
      Repo.query!("SELECT pg_advisory_lock($1)", [gate])

      Repo.query!("""
      CREATE FUNCTION cooking_checkout_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = '#{item.id}'::uuid AND NEW.status = 'checked_out' THEN
          PERFORM pg_advisory_xact_lock(#{gate});
        END IF;
        RETURN NEW;
      END $$
      """)

      try do
        Repo.query!("""
        CREATE TRIGGER cooking_checkout_gate BEFORE UPDATE ON shopping_items
        FOR EACH ROW EXECUTE FUNCTION cooking_checkout_gate()
        """)

        fun.(holder, fn -> Repo.query!("SELECT pg_advisory_unlock($1)", [gate]) end)
      after
        # Open the gate first, so a paused checkout ends and the DDL can run.
        Repo.query!("SELECT pg_advisory_unlock_all()")
        Repo.query!("DROP TRIGGER IF EXISTS cooking_checkout_gate ON shopping_items")
        Repo.query!("DROP FUNCTION cooking_checkout_gate()")
      end
    end)
  end

  # Starts `command` on a connection of its own and returns the task with
  # that connection's backend pid.
  defp worker(supervisor, f, command) do
    parent = self()

    task =
      Task.Supervisor.async_nolink(supervisor, fn ->
        Repo.put_dynamic_repo(f.repo)

        Repo.checkout(fn ->
          %{rows: [[backend]]} = Repo.query!("SELECT pg_backend_pid()")
          send(parent, {:backend, self(), backend})
          outcome(command)
        end)
      end)

    worker = task.pid
    assert_receive {:backend, ^worker, backend}, 5_000
    %{task: task, backend: backend}
  end

  # The result of `command`, or `{:aborted, code}` when Postgres aborted one
  # of its statements, whether the caller raised or returned the error.
  defp outcome(command) do
    case command.() do
      {:error, %Postgrex.Error{postgres: %{code: code}}} -> {:aborted, code}
      result -> result
    end
  rescue
    error in Postgrex.Error -> {:aborted, error.postgres.code}
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

  # Runs in the worker task: it reports its connection, then waits for `:start`
  # inside the barrier transaction.
  defp start_behind_barrier(f, parent, meal_id) do
    Repo.put_dynamic_repo(f.repo)

    Repo.transaction(fn ->
      %{rows: [[pid]]} = Repo.query!("SELECT pg_backend_pid()")
      send(parent, {:ready, self(), pid})

      receive do
        :start -> CookingService.start_session(f.actor, meal_id)
      after
        5_000 -> Repo.rollback(:barrier_timeout)
      end
    end)
  end

  defp concurrent_finish(f, session_ids) do
    parent = self()
    supervisor = start_supervised!(Task.Supervisor)

    workers =
      Enum.map(session_ids, fn session_id ->
        Task.Supervisor.async_nolink(supervisor, fn ->
          finish_behind_barrier(f, parent, session_id)
        end)
      end)

    ready =
      for _ <- workers do
        assert_receive {:ready, worker, pid}, 5_000
        {worker, pid}
      end

    assert length(Enum.uniq(Enum.map(ready, &elem(&1, 1)))) == 2
    Enum.each(ready, fn {worker, _pid} -> send(worker, :finish) end)

    # A refused finish rolls its nested transaction back, which also rolls the
    # barrier transaction back; the service result is what the test asserts.
    results =
      for _ <- workers do
        assert_receive {:finished, _worker, result}, 12_000
        result
      end

    Enum.each(workers, &Task.await(&1, 12_000))
    results
  end

  # Runs in the worker task: it reports its connection, then waits for
  # `:finish` inside the barrier transaction.
  defp finish_behind_barrier(f, parent, session_id) do
    Repo.put_dynamic_repo(f.repo)

    Repo.transaction(fn ->
      %{rows: [[pid]]} = Repo.query!("SELECT pg_backend_pid()")
      send(parent, {:ready, self(), pid})

      receive do
        :finish -> finish_and_report(f, parent, session_id)
      after
        5_000 -> Repo.rollback(:barrier_timeout)
      end
    end)
  end

  defp finish_and_report(f, parent, session_id) do
    result = CookingService.finish_session(f.actor, session_id)
    send(parent, {:finished, self(), result})

    if match?({:ok, %{inventory_mutations: [_, _]}}, result) do
      assert %{rows: [[2]]} =
               Repo.query!("""
               SELECT count(*) FROM pg_locks
               WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted
               """)
    end

    result
  end

  defp finish(f), do: CookingService.finish_session(f.actor, f.session.id)

  defp events(f) do
    Repo.all(
      from(e in InventoryMutationEvent, where: e.account_id == ^f.account.id, order_by: e.id)
    )
  end

  defp assert_unchanged(f) do
    assert Repo.get!(CookingSession, f.session.id) == f.session
    assert Repo.get!(ScheduledMeal, f.meal.id) == f.meal
    for lot <- f.lots, do: assert(Repo.get!(InventoryItem, lot.id) == lot)
    assert events(f) == []
  end

  defp fixture do
    {:ok, fixture} = Repo.transaction(&build_fixture/0)
    fixture
  end

  defp build_fixture do
    suffix = Ecto.UUID.generate()

    %{user: user, account: account} = insert_identity!(plan: :family_4)

    account = MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(account, :eligible)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Atomic cooking #{suffix}",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    ingredients =
      for n <- 1..2 do
        {:ok, ingredient} =
          Catalog.upsert_ingredient_by_name(%{name: "Atomic #{suffix} #{n}", category: :otros})

        ingredient
      end
      |> Enum.sort_by(& &1.id)

    # Deliberately insert in reverse logical-key order.
    for ingredient <- Enum.reverse(ingredients) do
      {:ok, _} =
        Catalog.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: ingredient.id,
          quantity_milli: 200,
          unit: :g
        })
    end

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account.id,
        recipe_id: recipe.id,
        date: Date.utc_today(),
        slot: :dinner
      })

    f = %{
      user: user,
      account: account,
      recipe: recipe,
      ingredients: ingredients,
      meal: meal,
      session: session!(account.id, meal.id),
      actor: %{id: user.id, account_id: account.id, plan: :family_4}
    }

    Map.put(f, :lots, Enum.map(ingredients, &lot!(f, &1, %{})))
  end

  defp session!(account_id, meal_id) do
    {:ok, session} =
      Planning.create_cooking_session(%{
        account_id: account_id,
        scheduled_meal_id: meal_id,
        status: :active
      })

    session
  end

  defp lot!(f, ingredient, attrs) do
    %InventoryItem{}
    |> InventoryItem.changeset(
      Map.merge(
        %{
          account_id: f.account.id,
          ingredient_id: ingredient.id,
          quantity_milli: 1000,
          unit: :g,
          source_kind: :planned,
          last_mutation_at: DateTime.utc_now(),
          expired_at: DateTime.add(DateTime.utc_now(), 5 * 86_400)
        },
        attrs
      )
    )
    |> Repo.insert!()
  end
end
