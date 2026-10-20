defmodule MealPlannerApi.CartConcurrencyTest do
  use ExUnit.Case, async: false
  import MealPlannerApi.CartFixtures
  alias Ecto.Adapters.SQL
  alias MealPlannerApi.{Cart, Repo}
  alias MealPlannerApi.Persistence.Calendar.MealMove
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Persistence.Shopping.{CheckoutSession, ShoppingItem}
  alias MealPlannerApi.Services.{CookingService, ShoppingService}

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
    f = fixture()

    on_exit(fn ->
      Repo.put_dynamic_repo(repo)
      cleanup(f)
    end)

    {:ok, f}
  end

  test "two independent connections reserving the same lines have exactly one owner", f do
    ids = Enum.map(f.items, & &1.id)

    results =
      concurrent(f, [fn -> Cart.reserve(f.actor, ids) end, fn -> Cart.reserve(f.other, ids) end])

    assert Enum.count(results, &match?({:ok, _}, &1)) == 1
    assert {:error, :cart_locked} in results
    [{:ok, cart}] = Enum.filter(results, &match?({:ok, _}, &1))
    assert Enum.all?(lines(f), &(&1.checkout_session_id == cart.session_id))
  end

  test "concurrent duplicate purchase commits one set of lots, spend and movements", f do
    cart = reserve!(f)
    Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "shopping:#{f.account.id}")
    purchase = fn -> Cart.purchase(f.actor, cart.session_id, payload(cart)) end
    results = concurrent(f, [purchase, purchase])
    # The second confirm replays the result of the first.
    assert [{:ok, result}, {:ok, result}] = results
    assert length(stock(f)) == 1
    assert length(events(f)) == 1
    assert Repo.get!(CheckoutSession, cart.session_id).total_cents == 250
    assert_receive %Phoenix.Socket.Broadcast{event: "purchase_confirmed"}
    assert_receive %Phoenix.Socket.Broadcast{event: "inventory_changed"}
    refute_receive %Phoenix.Socket.Broadcast{event: "purchase_confirmed"}
  end

  test "concurrent delivery acknowledgements commit one set of lots and movements", f do
    cart = reserve!(f)
    assert {:ok, _} = Cart.purchase(f.actor, cart.session_id, payload(cart, 300, "online"))
    assert stock(f) == []
    Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "shopping:#{f.account.id}")

    results =
      concurrent(f, [
        fn -> Cart.delivery(f.actor, cart.session_id) end,
        fn -> Cart.delivery(f.other, cart.session_id) end
      ])

    # The second acknowledgement replays the result of the first.
    assert [{:ok, result}, {:ok, result}] = results
    assert result.status == "completed"
    assert length(stock(f)) == 1
    assert length(events(f)) == 1
    assert Repo.get!(CheckoutSession, cart.session_id).status == :completed
    assert_receive %Phoenix.Socket.Broadcast{event: "purchase_confirmed"}
    assert_receive %Phoenix.Socket.Broadcast{event: "inventory_changed"}
    refute_receive %Phoenix.Socket.Broadcast{event: "purchase_confirmed"}
  end

  test "different members purchasing separate reservations accumulate stock and separate audits",
       f do
    [first, second] = f.items
    {:ok, cart_a} = Cart.reserve(f.actor, [first.id])
    {:ok, cart_b} = Cart.reserve(f.other, [second.id])

    results =
      concurrent(f, [
        fn -> Cart.purchase(f.actor, cart_a.session_id, payload(cart_a)) end,
        fn -> Cart.purchase(f.other, cart_b.session_id, payload(cart_b)) end
      ])

    assert Enum.all?(results, &match?({:ok, _}, &1))
    assert Enum.sum(Enum.map(stock(f), & &1.quantity_milli)) == 600

    assert Enum.sort(Enum.map(events(f), & &1.source_user_id)) ==
             Enum.sort([f.owner.id, f.member.id])

    assert Repo.get!(CheckoutSession, cart_a.session_id).total_cents == 250
    assert Repo.get!(CheckoutSession, cart_b.session_id).total_cents == 250
  end

  test "cart migration down and up preserve preexisting rows and restore indexes", f do
    # Never drop populated lease metadata, even on the explicitly isolated database.
    assert %{rows: [[0]]} =
             Repo.query!("""
             SELECT count(*) FROM checkout_sessions
             WHERE reserved_by_user_id IS NOT NULL OR lease_expires_at IS NOT NULL OR purchase_result IS NOT NULL
             """)

    assert %{rows: [[0]]} =
             Repo.query!(
               "SELECT count(*) FROM shopping_items WHERE reservation_token IS NOT NULL"
             )

    Code.require_file(
      Path.expand("../../priv/repo/migrations/20261005000000_add_cart_leases.exs", __DIR__)
    )

    migration = MealPlannerApi.Repo.Migrations.AddCartLeases
    version = 20_261_005_000_000
    options = [log: false, dynamic_repo: f.repo]
    snapshot = migration_snapshot()
    indexes = cart_indexes()
    assert Enum.any?(indexes, fn [name, _] -> name == "one_active_member_cart" end)

    try do
      assert :ok = Ecto.Migrator.down(Repo, version, migration, options)
      assert migration_snapshot() == snapshot

      refute Enum.any?(cart_indexes(), fn [name, _] ->
               name in ["cart_expiry_lookup", "one_active_member_cart"]
             end)

      assert :ok = Ecto.Migrator.up(Repo, version, migration, options)
      assert migration_snapshot() == snapshot
      assert cart_indexes() == indexes
    after
      assert Ecto.Migrator.up(Repo, version, migration, options) in [:ok, :already_up]
    end
  end

  test "purchase versus cancellation never leaves partial stock or a live reservation", f do
    cart = reserve!(f)

    results =
      concurrent(f, [
        fn -> Cart.purchase(f.actor, cart.session_id, payload(cart)) end,
        fn -> Cart.cancel(f.actor, cart.session_id) end
      ])

    assert Enum.count(results, &match?({:ok, _}, &1)) == 1
    status = Repo.get!(CheckoutSession, cart.session_id).status

    if status == :completed do
      assert {:error, :stale_cart} in results
      assert length(stock(f)) == 1
      assert length(events(f)) == 1
    else
      assert {:error, :cart_expired} in results
      assert status == :abandoned
      assert stock(f) == []
      assert events(f) == []
      assert Enum.all?(lines(f), &(&1.status == :pending))
    end

    refute Enum.any?(lines(f), &(&1.status == :in_cart))
  end

  test "concurrent expiry sweepers release once and stale confirmation adds nothing", f do
    cart = reserve!(f)
    expire!(cart)
    Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "shopping:#{f.account.id}")

    results =
      concurrent(f, [
        fn -> Cart.expire_account(f.account.id) end,
        fn -> Cart.expire_account(f.account.id) end
      ])

    assert Enum.sort(results) == [{:ok, 0}, {:ok, 1}]
    assert_receive %Phoenix.Socket.Broadcast{event: "cart_expired"}
    refute_receive %Phoenix.Socket.Broadcast{event: "cart_expired"}
    assert {:error, :cart_expired} = Cart.purchase(f.actor, cart.session_id, payload(cart))
    assert stock(f) == []
    assert events(f) == []
  end

  test "a failed release rolls back every line and keeps the original cart lease", f do
    cart = reserve!(f)
    original = {lines(f), Repo.get!(CheckoutSession, cart.session_id)}
    last = List.last(lines(f))
    trigger = "cart_release_failure_" <> String.replace(Ecto.UUID.generate(), "-", "")

    Repo.query!("""
    CREATE FUNCTION #{trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id = '#{last.id}'::uuid AND NEW.status = 'pending' THEN
        NEW.account_id := '#{Ecto.UUID.generate()}'::uuid;
      END IF;
      RETURN NEW;
    END $$
    """)

    try do
      Repo.query!(
        "CREATE TRIGGER #{trigger} BEFORE UPDATE ON shopping_items FOR EACH ROW EXECUTE FUNCTION #{trigger}()"
      )

      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "shopping:#{f.account.id}")
      assert {:error, %Ecto.Changeset{}} = Cart.cancel(f.actor, cart.session_id)
      assert {lines(f), Repo.get!(CheckoutSession, cart.session_id)} == original
      refute_receive %Phoenix.Socket.Broadcast{event: "cart_released"}

      assert {:error, %Ecto.Changeset{}} =
               Cart.remove(f.actor, cart.session_id, reservations(cart))

      assert {lines(f), Repo.get!(CheckoutSession, cart.session_id)} == original
    after
      Repo.query!("DROP TRIGGER IF EXISTS #{trigger} ON shopping_items")
      Repo.query!("DROP FUNCTION IF EXISTS #{trigger}()")
    end
  end

  test "set-status waits for the Cart lock of the Account before it locks any item", f do
    parent = self()
    supervisor = start_supervised!(Task.Supervisor)

    holder =
      Task.Supervisor.async_nolink(supervisor, fn ->
        Repo.put_dynamic_repo(f.repo)

        Repo.transaction(fn ->
          Cart.lock_account!(f.account.id)
          send(parent, :cart_locked)

          receive do
            :release -> :ok
          after
            5000 -> raise "cart lock holder timed out"
          end
        end)
      end)

    assert_receive :cart_locked, 5000

    writer =
      Task.Supervisor.async_nolink(supervisor, fn ->
        Repo.put_dynamic_repo(f.repo)

        ShoppingService.set_item_status(f.actor, %{
          "item_ids" => [hd(f.items).id],
          "status" => "removed"
        })
      end)

    # Without the Cart lock first, set-status would lock the row and commit
    # while the Cart holds the Account.
    assert Task.yield(writer, 300) == nil

    send(holder.pid, :release)
    assert {:ok, {:ok, :ok}} = Task.yield(holder, 5000)
    assert {:ok, %{updated_rows: 1}} = Task.await(writer, 5000)
  end

  # Issue #190. A partial purchase stores the remainder of the bought item,
  # and the foreign key of that insert needs the item's Scheduled meal. A
  # finish locks the meal and then deletes its open Shopping items. Unless the
  # checkout locks the meal before the items, each waits for the other.
  test "a partial purchase and a finish of the meal it buys for both complete", f do
    {:ok, %{session_id: session_id}} = CookingService.start_session(f.actor, f.meal.id)
    cart = reserve!(f)
    supervisor = start_supervised!(Task.Supervisor)

    {checkout_result, finish_result} =
      with_purchase_gate(hd(f.items), fn holder, open_gate ->
        # 300 of the 1000 reserved for today's meal: the rest is a remainder.
        checkout =
          worker(supervisor, f, fn -> Cart.purchase(f.actor, cart.session_id, payload(cart)) end)

        wait_until_blocked_by(checkout.backend, holder)

        finish =
          worker(supervisor, f, fn -> CookingService.finish_session(f.actor, session_id) end)

        wait_until_blocked_by(finish.backend, checkout.backend)
        open_gate.()
        {Task.await(checkout.task, 12_000), Task.await(finish.task, 12_000)}
      end)

    refute {:aborted, :deadlock_detected} in [checkout_result, finish_result]
    assert {:ok, %{status: "completed", moved_to_inventory_count: 1}} = checkout_result
    assert {:ok, %{scheduled_meal: _}} = finish_result
    assert Repo.get!(ScheduledMeal, f.meal.id).is_cooked

    # The meal needs 1000 g, so cooking it used up the 300 g bought for it.
    assert Enum.sum(Enum.map(stock(f), & &1.quantity_milli)) == 0

    # The finish locked the meal after the checkout committed, so it deleted
    # the remainder too: the cooked meal keeps only what was bought.
    assert [%{status: :checked_out, quantity_milli: 300}] = meal_lines(f, f.meal)
  end

  # Issue #190. A move locks the meal and then moves its planned Shopping
  # items, so it meets a partial purchase the way a finish does.
  test "a partial purchase and a move of the meal it buys for both complete", f do
    cart = reserve!(f)
    to = Date.add(f.meal.date, 3)
    supervisor = start_supervised!(Task.Supervisor)

    {checkout_result, move_result} =
      with_purchase_gate(hd(f.items), fn holder, open_gate ->
        checkout =
          worker(supervisor, f, fn -> Cart.purchase(f.actor, cart.session_id, payload(cart)) end)

        wait_until_blocked_by(checkout.backend, holder)

        move =
          worker(supervisor, f, fn ->
            MealMove.move(f.account.id, f.meal.id, to, :lunch, Date.utc_today())
          end)

        wait_until_blocked_by(move.backend, checkout.backend)
        open_gate.()
        {Task.await(checkout.task, 12_000), Task.await(move.task, 12_000)}
      end)

    # The move answers a deadlock it lost as `:conflict`.
    refute {:aborted, :deadlock_detected} in [checkout_result, move_result]
    refute move_result == {:error, :conflict}
    assert {:ok, %{status: "completed", moved_to_inventory_count: 1}} = checkout_result
    assert {:ok, %{moved: %{date: ^to, slot: :lunch}}} = move_result
    assert %{date: ^to, slot: :lunch} = Repo.get!(ScheduledMeal, f.meal.id)

    # The move locked the meal after the checkout committed, so the remainder
    # moved with the bought item.
    assert [
             %{status: :checked_out, quantity_milli: 300, planned_date: ^to},
             %{status: :pending, quantity_milli: 700, planned_date: ^to}
           ] = Enum.sort_by(meal_lines(f, f.meal), & &1.quantity_milli)
  end

  # Issue #334. Removing an item stores a Shopping removal, and the foreign key
  # of that insert needs the item's Scheduled meal. A move locks the meal and
  # then moves its Shopping items. Unless set-status locks the meal before the
  # items, each waits for the other.
  test "a removal and a move of the meal it removes for both complete", f do
    item = hd(f.items)
    to = Date.add(f.meal.date, 3)
    supervisor = start_supervised!(Task.Supervisor)
    gate = "NEW.scheduled_meal_id = '#{item.scheduled_meal_id}'::uuid"

    {remove_result, move_result} =
      with_gate("INSERT", "shopping_removals", gate, fn holder, open_gate ->
        remove =
          worker(supervisor, f, fn ->
            ShoppingService.set_item_status(f.actor, %{
              "item_ids" => [item.id],
              "status" => "removed"
            })
          end)

        wait_until_blocked_by(remove.backend, holder)

        move =
          worker(supervisor, f, fn ->
            MealMove.move(f.account.id, f.meal.id, to, :lunch, Date.utc_today())
          end)

        wait_until_blocked_by(move.backend, remove.backend)
        open_gate.()
        {Task.await(remove.task, 12_000), Task.await(move.task, 12_000)}
      end)

    refute {:aborted, :deadlock_detected} in [remove_result, move_result]
    refute move_result == {:error, :conflict}
    assert {:ok, %{updated_rows: 1}} = remove_result
    assert {:ok, %{moved: %{date: ^to, slot: :lunch}}} = move_result
    assert %{status: :removed, planned_date: ^to} = Repo.get!(ShoppingItem, item.id)
  end

  # A replacement of a date range deletes its Scheduled meals. A confirm locks
  # the meals of its Cart in id order, so the replacement locks them in id
  # order too: deleting them in the order it finds them, it would hold one
  # meal while it waits for another that the confirm holds.
  test "a range replacement that meets a purchase of two of its meals does not deadlock", f do
    # The meal the replacement reaches first, the earlier and the first
    # stored, has the higher id.
    [low, high] = Enum.sort([Ecto.UUID.generate(), Ecto.UUID.generate()])
    first = meal!(f, high, Date.add(Date.utc_today(), 5))
    second = meal!(f, low, Date.add(Date.utc_today(), 6))
    items = Enum.map([first, second], &planned_item!(f, &1))
    {:ok, cart} = Cart.reserve(f.actor, Enum.map(items, & &1.id))
    supervisor = start_supervised!(Task.Supervisor)
    gate = "OLD.id = '#{first.id}'::uuid"

    {replace_result, checkout_result} =
      with_gate("DELETE", "scheduled_meals", gate, fn holder, open_gate ->
        replace =
          worker(supervisor, f, fn ->
            ShoppingService.replace_scheduled_meals_for_range(
              f.account.id,
              {first.date, second.date},
              []
            )
          end)

        # The replacement waits inside the delete of its first meal.
        wait_until_blocked_by(replace.backend, holder)

        checkout =
          worker(supervisor, f, fn ->
            Cart.purchase(f.actor, cart.session_id, payload(cart, nil))
          end)

        wait_until_blocked_by(checkout.backend, replace.backend)
        open_gate.()
        {Task.await(replace.task, 12_000), Task.await(checkout.task, 12_000)}
      end)

    # The replacement answers a deadlock it lost as `:persistence_error`.
    refute {:aborted, :deadlock_detected} in [replace_result, checkout_result]
    assert {:ok, %{replaced: 0}} = replace_result

    # The replacement went first: it deleted the meals and, with them, the
    # items of the Cart, so the confirm finds nothing left to buy.
    assert {:error, :validation_error} = checkout_result
    refute Repo.get(ScheduledMeal, first.id) || Repo.get(ScheduledMeal, second.id)
    assert stock(f) == []
  end

  # Issues #307 and #334. Marking the items of a Shopping removal as removed
  # updates the `:pending` items of its meals with no Cart lock. A reserve
  # that commits while the update waits for the row keeps its item in the Cart.
  test "marking removed items leaves an item reserved before the update in the Cart", f do
    item = hd(f.items)
    :ok = Shopping.put_removals(f.account.id, [{item.scheduled_meal_id, item.ingredient_id}])
    supervisor = start_supervised!(Task.Supervisor)
    gate = "NEW.id = '#{item.id}'::uuid AND NEW.status = 'in_cart'"

    {reserve_result, restored} =
      with_gate("UPDATE", "shopping_items", gate, fn holder, open_gate ->
        # The reserve holds the item's row lock and has not committed.
        reserve = worker(supervisor, f, fn -> Cart.reserve(f.actor, [item.id]) end)
        wait_until_blocked_by(reserve.backend, holder)

        # The update still reads the item as `:pending`, so it waits for the
        # row.
        restore =
          worker(supervisor, f, fn ->
            Shopping.mark_removed_items(f.account.id, [item.scheduled_meal_id])
          end)

        wait_until_blocked_by(restore.backend, reserve.backend)
        open_gate.()
        {Task.await(reserve.task, 12_000), Task.await(restore.task, 12_000)}
      end)

    assert {:ok, %{session_id: session_id, reservations: [%{reservation_token: token}]}} =
             reserve_result

    assert restored == 0

    assert %{status: :in_cart, checkout_session_id: ^session_id, reservation_token: ^token} =
             Repo.get!(ShoppingItem, item.id)

    assert [%{quantity_milli: 1000}] = Cart.lines(Repo.get!(CheckoutSession, session_id))
  end

  for table <- ["inventory_mutation_events", "shopping_items", "checkout_sessions"] do
    test "failure writing #{table} rolls back stock, audit, remainder and spend without a broadcast",
         f do
      table = unquote(table)
      cart = reserve!(f)
      original = {lines(f), Repo.get!(CheckoutSession, cart.session_id)}
      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "shopping:#{f.account.id}")
      trigger = "cart_failure_" <> String.replace(Ecto.UUID.generate(), "-", "")

      condition =
        case table do
          "inventory_mutation_events" ->
            "NEW.source_checkout_session_id = '#{cart.session_id}'::uuid"

          "shopping_items" ->
            "NEW.account_id = '#{f.account.id}'::uuid AND NEW.status = 'checked_out'"

          "checkout_sessions" ->
            "NEW.id = '#{cart.session_id}'::uuid AND NEW.status = 'completed'"
        end

      Repo.query!("""
      CREATE FUNCTION #{trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF #{condition} THEN NEW.account_id := '#{Ecto.UUID.generate()}'::uuid; END IF;
        RETURN NEW;
      END $$
      """)

      try do
        Repo.query!(
          "CREATE TRIGGER #{trigger} BEFORE INSERT OR UPDATE ON #{table} FOR EACH ROW EXECUTE FUNCTION #{trigger}()"
        )

        assert {:error, %Ecto.Changeset{}} =
                 Cart.purchase(f.actor, cart.session_id, payload(cart))

        assert stock(f) == []
        assert events(f) == []
        assert {lines(f), Repo.get!(CheckoutSession, cart.session_id)} == original
        refute_receive %Phoenix.Socket.Broadcast{event: "purchase_confirmed"}
        refute_receive %Phoenix.Socket.Broadcast{event: "inventory_changed"}
      after
        Repo.query!("DROP TRIGGER IF EXISTS #{trigger} ON #{table}")
        Repo.query!("DROP FUNCTION IF EXISTS #{trigger}()")
      end

      assert {:ok, _} = Cart.purchase(f.actor, cart.session_id, payload(cart))
    end
  end

  # Issue #277. A Shopping list read computes its Shortage lines before its
  # lock transaction. A purchase that commits in between buys an item those
  # lines still count as missing, and a bought item no longer answers for its
  # planned key, so the read must not store the bought quantity again as a
  # `pending` item.
  test "a purchase that commits during a Shopping list read leaves no duplicate pending item",
       f do
    [item, next_item] = f.items
    {:ok, cart} = Cart.reserve(f.other, [item.id])

    # A pending item whose quantity is not its Shortage sends the read
    # through its lock transaction.
    next_item |> Ecto.Changeset.change(quantity_milli: 400) |> Repo.update!()
    supervisor = start_supervised!(Task.Supervisor)

    # The read waits for tomorrow's meal inside its lock transaction, after it
    # computed its lines; the purchase only locks today's.
    holder = meal_lock_holder(supervisor, f, f.next_meal)
    read = worker(supervisor, f, fn -> ShoppingService.get_shopping_list(f.actor) end)
    wait_until_blocked_by(read.backend, holder.backend)

    checkout =
      worker(supervisor, f, fn ->
        Cart.purchase(f.other, cart.session_id, payload(cart, 1000))
      end)

    waited = done_or_blocked_by(checkout, read.backend)
    send(holder.task.pid, :release)
    checkout_result = with :blocked <- waited, do: {:ok, Task.await(checkout.task, 12_000)}

    assert {:ok, :ok} = Task.await(holder.task, 12_000)
    assert {:ok, _list} = Task.await(read.task, 12_000)
    assert {:ok, {:ok, %{status: "completed", moved_to_inventory_count: 1}}} = checkout_result

    # Today's meal keeps only what was bought for it; tomorrow's item takes
    # its Shortage.
    assert [%{status: :checked_out, quantity_milli: 1000}] = meal_lines(f, f.meal)
    assert [%{status: :pending, quantity_milli: 500}] = meal_lines(f, f.next_meal)
  end

  # Issue #277. A Cooking session finish locks its meal, deletes the meal's
  # open Shopping items and takes its Ingredients out of the Inventory. A read
  # that waits for that lock must not derive an item for the cooked meal from
  # the Inventory the finish left.
  test "a Shopping list read that waits for a cooking finish stores no item for the cooked meal",
       f do
    {:ok, %{session_id: session_id}} = CookingService.start_session(f.actor, f.meal.id)
    [item, _next_item] = f.items

    # The stock covers today's dinner, so the read finds today's item stale and
    # goes through its lock transaction.
    stock!(f, 1000)
    supervisor = start_supervised!(Task.Supervisor)

    {finish_result, read_result} =
      with_gate("DELETE", "shopping_items", "OLD.id = '#{item.id}'::uuid", fn holder, open_gate ->
        # The finish holds today's meal while it waits to delete the item.
        finish =
          worker(supervisor, f, fn -> CookingService.finish_session(f.actor, session_id) end)

        wait_until_blocked_by(finish.backend, holder)
        read = worker(supervisor, f, fn -> ShoppingService.get_shopping_list(f.actor) end)
        wait_until_blocked_by(read.backend, finish.backend)
        open_gate.()
        {Task.await(finish.task, 12_000), Task.await(read.task, 12_000)}
      end)

    assert {:ok, %{scheduled_meal: _}} = finish_result
    assert {:ok, _list} = read_result
    assert Repo.get!(ScheduledMeal, f.meal.id).is_cooked
    assert stock(f) |> Enum.map(& &1.quantity_milli) |> Enum.sum() == 0

    # The cooked meal keeps no item; tomorrow's keeps its Shortage.
    assert meal_lines(f, f.meal) == []
    assert [%{status: :pending, quantity_milli: 500}] = meal_lines(f, f.next_meal)
  end

  # Issue #366 (Jorge CD-C on PR #364). A Shopping list read holds its meals
  # `FOR KEY SHARE` until it has stored their items. A calendar mark as cooked
  # has to wait for it, then delete what it stored. A new item has no row the
  # mark could wait for, so a mark that did not lock the meal `FOR UPDATE`
  # went past the read, and the read then stored a `pending` item for the
  # cooked meal.
  test "a calendar mark as cooked waits for a Shopping list read and leaves no item for the meal",
       f do
    [item, _next_item] = f.items

    # Today's meal has no item, so the read stores a new one in its lock
    # transaction.
    Repo.delete!(item)
    supervisor = start_supervised!(Task.Supervisor)

    {read_result, mark_result, waited} =
      with_gate(
        "INSERT",
        "shopping_items",
        "NEW.scheduled_meal_id = '#{f.meal.id}'::uuid",
        fn holder, open_gate ->
          # The read holds today's meal while it waits to store its item.
          read = worker(supervisor, f, fn -> ShoppingService.get_shopping_list(f.actor) end)
          wait_until_blocked_by(read.backend, holder)

          mark =
            worker(supervisor, f, fn ->
              CookingService.set_meal_cooked(f.actor, f.meal.id, true)
            end)

          waited = done_or_blocked_by(mark, read.backend)
          open_gate.()
          mark_result = with :blocked <- waited, do: {:ok, Task.await(mark.task, 12_000)}
          {Task.await(read.task, 12_000), mark_result, waited}
        end
      )

    assert waited == :blocked
    assert {:ok, _list} = read_result
    assert {:ok, {:ok, %ScheduledMeal{is_cooked: true}}} = mark_result
    assert Repo.get!(ScheduledMeal, f.meal.id).is_cooked

    # The cooked meal keeps no item; tomorrow's keeps its Shortage.
    assert meal_lines(f, f.meal) == []
    assert [%{status: :pending, quantity_milli: 500}] = meal_lines(f, f.next_meal)
  end

  # Issue #366. A calendar mark as cooked locks its meal, deletes the meal's
  # open Shopping items and takes its Ingredients out of the Inventory, as a
  # Cooking session finish does. A read that waits for it stores no item for
  # the cooked meal.
  test "a Shopping list read that waits for a calendar mark as cooked stores no item for the meal",
       f do
    [item, _next_item] = f.items

    # The stock covers today's dinner, so the read finds today's item stale and
    # goes through its lock transaction.
    stock!(f, 1000)
    supervisor = start_supervised!(Task.Supervisor)

    {mark_result, read_result} =
      with_gate("DELETE", "shopping_items", "OLD.id = '#{item.id}'::uuid", fn holder, open_gate ->
        # The mark holds today's meal while it waits to delete the item.
        mark =
          worker(supervisor, f, fn ->
            CookingService.set_meal_cooked(f.actor, f.meal.id, true)
          end)

        wait_until_blocked_by(mark.backend, holder)
        read = worker(supervisor, f, fn -> ShoppingService.get_shopping_list(f.actor) end)
        wait_until_blocked_by(read.backend, mark.backend)
        open_gate.()
        {Task.await(mark.task, 12_000), Task.await(read.task, 12_000)}
      end)

    assert {:ok, %ScheduledMeal{is_cooked: true}} = mark_result
    assert {:ok, _list} = read_result

    # The cooked quantity came out once.
    assert stock(f) |> Enum.map(& &1.quantity_milli) |> Enum.sum() == 0
    assert [%{trigger_type: :cooking, quantity_delta_milli: -1000}] = events(f)

    assert meal_lines(f, f.meal) == []
    assert [%{status: :pending, quantity_milli: 500}] = meal_lines(f, f.next_meal)
  end

  # Issue #145. A past meal is answered once: two confirmations of it as
  # cooked, from two devices, take the meal row lock in turn, and the second
  # sees the meal cooked and consumes nothing.
  test "two concurrent confirmations of a past meal as cooked consume it once", f do
    past = meal!(f, Ecto.UUID.generate(), Date.add(Date.utc_today(), -2))
    item = planned_item!(f, past)
    stock!(f, 1000)
    supervisor = start_supervised!(Task.Supervisor)
    confirm = fn -> CookingService.confirm_meal(f.actor, past.id, true) end

    {first_result, second_result} =
      with_gate("DELETE", "shopping_items", "OLD.id = '#{item.id}'::uuid", fn holder, open_gate ->
        # The first confirmation holds the meal while it waits to delete the item.
        first = worker(supervisor, f, confirm)
        wait_until_blocked_by(first.backend, holder)
        second = worker(supervisor, f, confirm)
        wait_until_blocked_by(second.backend, first.backend)
        open_gate.()
        {Task.await(first.task, 12_000), Task.await(second.task, 12_000)}
      end)

    assert {:ok, %{scheduled_meal: %{is_cooked: true}}} = first_result
    assert {:error, :meal_already_confirmed} = second_result
    assert Repo.get!(ScheduledMeal, past.id).is_cooked

    # The recipe came out of the stock once, by one event.
    assert [%{trigger_type: :cooking, quantity_delta_milli: -500}] = events(f)
    assert stock(f) |> Enum.map(& &1.quantity_milli) |> Enum.sum() == 500
    assert meal_lines(f, past) == []
  end

  # Issue #398. A "cooked" and a "not cooked" answer to one past meal take the
  # meal row lock in turn: the second sees the meal answered, so the meal is
  # answered once and its recipe comes out of the stock at most once.
  test "a cooked and a not cooked confirmation of a past meal answer it once", f do
    past = meal!(f, Ecto.UUID.generate(), Date.add(Date.utc_today(), -2))
    item = planned_item!(f, past)
    stock!(f, 1000)
    supervisor = start_supervised!(Task.Supervisor)

    {cooked_result, not_cooked_result} =
      with_gate("DELETE", "shopping_items", "OLD.id = '#{item.id}'::uuid", fn holder, open_gate ->
        # The "cooked" answer holds the meal while it waits to delete the item.
        cooked =
          worker(supervisor, f, fn -> CookingService.confirm_meal(f.actor, past.id, true) end)

        wait_until_blocked_by(cooked.backend, holder)

        not_cooked =
          worker(supervisor, f, fn -> CookingService.confirm_meal(f.actor, past.id, false) end)

        wait_until_blocked_by(not_cooked.backend, cooked.backend)
        open_gate.()
        {Task.await(cooked.task, 12_000), Task.await(not_cooked.task, 12_000)}
      end)

    assert {:ok, %{scheduled_meal: %{is_cooked: true}}} = cooked_result
    assert {:error, :meal_already_confirmed} = not_cooked_result

    answered = Repo.get!(ScheduledMeal, past.id)
    assert answered.is_cooked
    assert is_nil(answered.not_cooked_at)

    # The recipe came out of the stock once, by one event.
    assert [%{trigger_type: :cooking, quantity_delta_milli: -500}] = events(f)
    assert stock(f) |> Enum.map(& &1.quantity_milli) |> Enum.sum() == 500
    assert meal_lines(f, past) == []
  end

  # Issue #398. A confirmation of a past meal as cooked and a calendar mark of
  # it as cooked take the meal row lock in turn: the mark sees the meal cooked
  # and consumes nothing again.
  test "a confirmation as cooked and a calendar mark of a past meal consume it once", f do
    past = meal!(f, Ecto.UUID.generate(), Date.add(Date.utc_today(), -2))
    item = planned_item!(f, past)
    stock!(f, 1000)
    supervisor = start_supervised!(Task.Supervisor)

    {confirm_result, mark_result} =
      with_gate("DELETE", "shopping_items", "OLD.id = '#{item.id}'::uuid", fn holder, open_gate ->
        # The confirmation holds the meal while it waits to delete the item.
        confirm =
          worker(supervisor, f, fn -> CookingService.confirm_meal(f.actor, past.id, true) end)

        wait_until_blocked_by(confirm.backend, holder)

        mark =
          worker(supervisor, f, fn -> CookingService.set_meal_cooked(f.actor, past.id, true) end)

        wait_until_blocked_by(mark.backend, confirm.backend)
        open_gate.()
        {Task.await(confirm.task, 12_000), Task.await(mark.task, 12_000)}
      end)

    assert {:ok, %{scheduled_meal: %{is_cooked: true}}} = confirm_result
    assert {:ok, %ScheduledMeal{is_cooked: true}} = mark_result
    assert Repo.get!(ScheduledMeal, past.id).is_cooked

    # The recipe came out of the stock once, by one event.
    assert [%{trigger_type: :cooking, quantity_delta_milli: -500}] = events(f)
    assert stock(f) |> Enum.map(& &1.quantity_milli) |> Enum.sum() == 500
    assert meal_lines(f, past) == []
  end

  defp concurrent(f, commands) do
    parent = self()
    supervisor = start_supervised!(Task.Supervisor)

    tasks =
      Enum.map(commands, fn command ->
        Task.Supervisor.async_nolink(supervisor, fn -> run_behind_barrier(f, parent, command) end)
      end)

    ready =
      for _ <- tasks do
        assert_receive {:ready, worker, pid}, 5000
        {worker, pid}
      end

    assert length(Enum.uniq(Enum.map(ready, &elem(&1, 1)))) == 2
    Enum.each(ready, fn {worker, _} -> send(worker, :go) end)
    Enum.map(tasks, &Task.await(&1, 12_000))
  end

  # Runs in the worker task: it reports its connection, then waits for `:go`.
  defp run_behind_barrier(f, parent, command) do
    Repo.put_dynamic_repo(f.repo)

    Repo.checkout(fn ->
      %{rows: [[pid]]} = Repo.query!("SELECT pg_backend_pid()")
      send(parent, {:ready, self(), pid})

      receive do
        :go -> command.()
      after
        5000 -> raise "cart concurrency barrier timed out"
      end
    end)
  end

  # The Shopping items of `meal`, in every status.
  defp meal_lines(f, meal), do: Enum.filter(lines(f), &(&1.scheduled_meal_id == meal.id))

  # A Scheduled meal of the Account with the id `id`, at dinner on `date`.
  defp meal!(f, id, date) do
    %ScheduledMeal{id: id}
    |> ScheduledMeal.changeset(%{
      account_id: f.account.id,
      recipe_id: f.recipe.id,
      date: date,
      slot: :dinner
    })
    |> Repo.insert!()
  end

  # An open planned Shopping item of `meal`, 500 g of the fixture Ingredient.
  defp planned_item!(f, meal) do
    %ShoppingItem{}
    |> ShoppingItem.changeset(%{
      account_id: f.account.id,
      scheduled_meal_id: meal.id,
      planned_date: meal.date,
      ingredient_id: f.ingredient.id,
      unit: :g,
      quantity_milli: 500,
      status: :pending
    })
    |> Repo.insert!()
  end

  # `quantity_milli` grams of the fixture Ingredient in the Account's
  # Inventory.
  defp stock!(f, quantity_milli) do
    Repo.insert!(%MealPlannerApi.Persistence.Inventory.InventoryItem{
      account_id: f.account.id,
      ingredient_id: f.ingredient.id,
      quantity_milli: quantity_milli,
      unit: :g,
      source_kind: :planned,
      acquired_at: DateTime.utc_now(),
      last_mutation_at: DateTime.utc_now()
    })
  end

  # Pauses the real `Cart.purchase/3` inside the update that closes `item` as
  # bought, before it stores the item's remainder.
  defp with_purchase_gate(item, fun) do
    with_gate(
      "UPDATE",
      "shopping_items",
      "NEW.id = '#{item.id}'::uuid AND NEW.status = 'checked_out'",
      fun
    )
  end

  # A trigger before each `event` on `table` makes the rows that meet
  # `condition` wait for an advisory lock this connection holds until
  # `open_gate` is called.
  defp with_gate(event, table, condition, fun) do
    # Above every `hashtext/1` key (an int4), so it is no Cart or Inventory key.
    gate = 0x1_0000_0000 + System.unique_integer([:positive])
    trigger = "cart_test_gate_" <> String.replace(Ecto.UUID.generate(), "-", "")

    Repo.checkout(fn ->
      %{rows: [[holder]]} = Repo.query!("SELECT pg_backend_pid()")
      Repo.query!("SELECT pg_advisory_lock($1)", [gate])

      Repo.query!("""
      CREATE FUNCTION #{trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF #{condition} THEN
          PERFORM pg_advisory_xact_lock(#{gate});
        END IF;
        RETURN COALESCE(NEW, OLD);
      END $$
      """)

      try do
        Repo.query!(
          "CREATE TRIGGER #{trigger} BEFORE #{event} ON #{table} FOR EACH ROW EXECUTE FUNCTION #{trigger}()"
        )

        fun.(holder, fn -> Repo.query!("SELECT pg_advisory_unlock($1)", [gate]) end)
      after
        # Open the gate first, so a paused writer ends and the DDL can run.
        Repo.query!("SELECT pg_advisory_unlock_all()")
        Repo.query!("DROP TRIGGER IF EXISTS #{trigger} ON #{table}")
        Repo.query!("DROP FUNCTION IF EXISTS #{trigger}()")
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

  # Holds a `FOR UPDATE` lock on `meal` from a connection of its own until
  # its task receives `:release`.
  defp meal_lock_holder(supervisor, f, meal) do
    parent = self()

    holder =
      worker(supervisor, f, fn ->
        Repo.transaction(fn ->
          Repo.query!("SELECT id FROM scheduled_meals WHERE id = $1 FOR UPDATE", [
            Ecto.UUID.dump!(meal.id)
          ])

          send(parent, :meal_locked)

          receive do
            :release -> :ok
          after
            10_000 -> raise "meal lock holder timed out"
          end
        end)
      end)

    assert_receive :meal_locked, 5_000
    holder
  end

  # The reply of `worker` once it ends (as `Task.yield/2` gives it), or
  # `:blocked` once it waits for a lock that `blocker` holds; gives up after
  # about two seconds.
  defp done_or_blocked_by(worker, blocker, attempts \\ 200)

  defp done_or_blocked_by(worker, blocker, 0),
    do: flunk("backend #{worker.backend} neither ended nor waited for backend #{blocker}")

  defp done_or_blocked_by(%{task: task, backend: backend} = worker, blocker, attempts) do
    case Task.yield(task, 10) do
      nil ->
        %{rows: [[blocking]]} = Repo.query!("SELECT pg_blocking_pids($1)", [backend])

        if blocker in blocking,
          do: :blocked,
          else: done_or_blocked_by(worker, blocker, attempts - 1)

      reply ->
        reply
    end
  end

  defp migration_snapshot do
    for table <- [
          "shopping_items",
          "checkout_sessions",
          "inventory_items",
          "inventory_mutation_events"
        ] do
      result =
        Repo.query!("""
        SELECT to_jsonb(t) - 'reserved_by_user_id' - 'lease_expires_at' - 'purchase_result' - 'reservation_token'
        FROM #{table} t ORDER BY id
        """)

      {table, result.rows}
    end
  end

  defp cart_indexes do
    Repo.query!(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('shopping_items', 'checkout_sessions') ORDER BY indexname"
    ).rows
  end
end
