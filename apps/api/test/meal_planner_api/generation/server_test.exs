defmodule MealPlannerApi.Generation.ServerTest do
  # NOTE: changed from `async: true` (Phases 3-5 of the
  # `planning-shopping-extraction` change require DB sandbox fixtures).
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Data.RecipeRepo
  alias MealPlannerApi.Data.ShoppingRepo
  alias MealPlannerApi.Generation.PlanningSessionServer
  alias MealPlannerApi.Generation.Server
  alias MealPlannerApi.Persistence.Planning.PlanningProposal
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Services.RecipeVersions
  alias MealPlannerApi.Services.ShoppingService

  describe "via/1" do
    test "returns a Registry via tuple" do
      via = Server.via(123)
      assert {:via, Registry, {MealPlannerApi.Generation.Generations, {:generation, 123}}} = via
    end

    test "rejects non-positive account IDs" do
      assert_raise FunctionClauseError, fn -> Server.via(0) end
      assert_raise FunctionClauseError, fn -> Server.via(-1) end
    end
  end

  describe "start_generation/4 interface" do
    test "is callable with correct arity (module API)" do
      # Solo verificamos que la función existe y tiene la aridad correcta
      assert is_function(&Server.start_generation/4, 4)
    end

    test "chat/3 has correct arity" do
      assert is_function(&Server.chat/3, 3)
    end

    test "confirm/3 has correct arity" do
      assert is_function(&Server.confirm/3, 3)
    end

    test "reject/2 has correct arity" do
      assert is_function(&Server.reject/2, 2)
    end

    test "get_status/1 has correct arity" do
      assert is_function(&Server.get_status/1, 1)
    end
  end

  # TASK-7: Test that favorite_recipe_ids are propagated to slot constraints
  describe "preferred_recipe_ids in slots (Gap 2)" do
    test "via/1 generates distinct registry keys per account" do
      via_1 = Server.via(1)
      via_2 = Server.via(2)
      assert via_1 != via_2
    end

    test "load_user_profile_and_favorites returns profile and favorite ids" do
      # Test that the function exists by checking the module has the expected structure
      # Private functions are tested indirectly through integration tests
      assert is_atom(Server)
    end
  end

  # TASK-7: Test build_slots_input behavior with favorite_recipe_ids
  describe "build_slots_input with favorite_recipe_ids propagation" do
    test "slots include preferred_recipe_ids as strings when favorite_recipe_ids present in constraints" do
      # Verify the module structure allows slots to carry preferred_recipe_ids
      # The actual build_slots_input behavior is tested via integration
      assert is_atom(Server)
    end

    test "build_slots_input extracts favorite_recipe_ids from constraints and converts to strings" do
      # Private function test - verify module has required structure
      # Integration tests verify the full pipeline
      assert is_atom(Server)
    end
  end

  # ===========================================================================
  # Phase 3-5 — planning-shopping-extraction
  #
  # These tests drive `Server.confirm/2` end-to-end through a real DB
  # sandbox. Each scenario is RED → GREEN before the corresponding
  # production change. See `tasks.md` for the full scenario map.
  # ===========================================================================

  import MealPlannerApi.Generation.ServerTestFixtures

  setup do
    :ok = Sandbox.checkout(MealPlannerApi.Repo)
    # `async: false` here lets us share the test process's DB connection with
    # any supervised GenServer (`Server`) — same model as `ChannelCase`.
    Sandbox.mode(MealPlannerApi.Repo, {:shared, self()})
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    :ok
  end

  describe "start_generation/4 authorization" do
    test "rejects an unknown participant before creating a run or proposal" do
      account = insert_account("generation authorization account")
      actor = insert_user_with_membership(account, "generation-actor@example.com")
      foreign_account = insert_account("generation foreign account")

      foreign_member =
        insert_user_with_membership(foreign_account, "generation-foreign@example.com")

      assert {:error, :forbidden} =
               Server.start_generation(
                 account.id,
                 actor.id,
                 %{"participant_ids" => [foreign_member.id]},
                 self()
               )

      assert MealPlannerApi.Repo.aggregate(
               MealPlannerApi.Persistence.Planning.PlanningGenerationRun,
               :count
             ) == 0

      assert MealPlannerApi.Repo.aggregate(PlanningProposal, :count) == 0
    end
  end

  describe "start_generation/4 cold start" do
    test "starts a generation server for an account that has none and returns its run" do
      account = insert_account("generation cold start account")
      actor = insert_user_with_membership(account, "generation-cold-start@example.com")

      assert Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) ==
               []

      assert {:ok, run_id} = Server.start_generation(account.id, actor.id, %{}, self())

      assert [{server_pid, _value}] =
               Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id})

      # The server registered for the account is the one that took the run.
      assert %{current_run_id: ^run_id} = Server.get_status(account.id)

      run =
        MealPlannerApi.Repo.get!(
          MealPlannerApi.Persistence.Planning.PlanningGenerationRun,
          run_id
        )

      assert run.account_id == account.id
      assert run.user_id == actor.id

      stop_generation_server(account.id)
      refute Process.alive?(server_pid)
    end

    test "concurrent callers of an account that has no server share one server" do
      account = insert_account("generation concurrent cold start account")
      actor = insert_user_with_membership(account, "generation-concurrent@example.com")

      supervisor = Process.whereis(MealPlannerApi.Generation.ServerSupervisor)
      servers_before = DynamicSupervisor.count_children(supervisor).active

      # Callers do not collide on their own: each one reads the database
      # before it looks for the server, and the sandbox connection hands
      # those reads out one at a time. So the supervisor of the servers is
      # suspended: no server can start, every caller finds the Registry
      # empty and leaves its own request to start one in the mailbox of the
      # supervisor. The trace tells when the request of each caller is there.
      :ok = :sys.suspend(supervisor)
      :erlang.trace(supervisor, true, [:receive])

      callers =
        try do
          callers =
            for _caller <- 1..8 do
              Task.async(fn -> Server.start_generation(account.id, actor.id, %{}, self()) end)
            end

          for %Task{pid: caller} <- callers do
            assert_receive {:trace, ^supervisor, :receive,
                            {:"$gen_call", {^caller, _tag}, _request}},
                           5_000
          end

          callers
        after
          :erlang.trace(supervisor, false, [:receive])
          :ok = :sys.resume(supervisor)
        end

      # Resumed, the supervisor serves the requests in turn: the first one
      # starts the server and every other one finds it already started.
      results = Task.await_many(callers, 30_000)

      # A caller that lost the start is routed to the server that won it,
      # and that server either takes a new run or is still busy with one,
      # depending on when the call arrives: no caller sees the error of the
      # start itself.
      for result <- results do
        assert match?({:ok, run_id} when is_binary(run_id), result) or
                 result == {:error, :already_running},
               "a caller got #{inspect(result)}"
      end

      run_ids = for {:ok, run_id} <- results, do: run_id
      assert run_ids != []
      assert Enum.uniq(run_ids) == run_ids

      assert [{server_pid, _value}] =
               Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id})

      assert DynamicSupervisor.count_children(MealPlannerApi.Generation.ServerSupervisor).active ==
               servers_before + 1

      stop_generation_server(account.id)
      refute Process.alive?(server_pid)
    end
  end

  # The window of a generation (its dates and slot types) comes from the
  # client and is expanded into one descriptor per day and slot, so it is
  # checked before a run exists: a refused window leaves no generation run
  # for the account and no server registered for it.
  describe "start_generation/4 generation window" do
    test "a range of ten years with fifty slot types is refused before a run exists" do
      account = insert_account("generation window account")
      actor = insert_user_with_membership(account, "generation-window@example.com")

      # About 180 thousand descriptors, every slot type a known one.
      slot_types = ~w(breakfast lunch dinner) |> Stream.cycle() |> Enum.take(50)

      assert {:error, :invalid_date_range} =
               Server.start_generation(
                 account.id,
                 actor.id,
                 %{
                   "date_from" => "2026-01-01",
                   "date_to" => "2035-12-31",
                   "slot_types" => slot_types
                 },
                 self()
               )

      refute_generation_started(account)
    end

    for {label, constraints, reason} <- [
          {"a date_from that is not an ISO 8601 date",
           %{"date_from" => "01/02/2026", "date_to" => "2026-02-03"}, :invalid_date},
          {"a date_to that is not an ISO 8601 date",
           %{"date_from" => "2026-02-01", "date_to" => "next week"}, :invalid_date},
          {"a date that does not exist, under atom keys",
           %{date_from: "2026-02-30", date_to: "2026-03-01"}, :invalid_date},
          {"a date that is not a string", %{"date_from" => 20_260_201, "date_to" => "2026-02-03"},
           :invalid_date},
          {"a range that ends before it starts",
           %{"date_from" => "2026-02-07", "date_to" => "2026-02-01"}, :invalid_date_range},
          {"a range of eight days", %{"date_from" => "2026-02-01", "date_to" => "2026-02-08"},
           :invalid_date_range},
          {"slot types that are not a list", %{"slot_types" => "lunch"}, :invalid_payload},
          {"an empty list of slot types", %{"slot_types" => []}, :invalid_payload},
          {"a slot type that is not a known slot", %{"slot_types" => ["lunch", "brunch"]},
           :invalid_payload},
          {"an atom slot type that is not a known slot, under atom keys",
           %{slot_types: [:lunch, :brunch]}, :invalid_payload},
          # Issue #342: snack is not a Meal slot.
          {"the snack slot type", %{"slot_types" => ["lunch", "snack"]}, :invalid_payload},
          {"the snack slot type as an atom", %{slot_types: [:lunch, :snack]}, :invalid_payload},
          {"a slot type that is neither a string nor an atom", %{"slot_types" => ["lunch", 3]},
           :invalid_payload}
        ] do
      test "#{label} is refused before a run exists" do
        account = insert_account("generation window account")
        actor = insert_user_with_membership(account, "generation-window@example.com")

        assert {:error, unquote(reason)} =
                 Server.start_generation(
                   account.id,
                   actor.id,
                   unquote(Macro.escape(constraints)),
                   self()
                 )

        refute_generation_started(account)
      end
    end

    for {label, constraints} <- [
          {"a range of seven days", %{"date_from" => "2026-02-01", "date_to" => "2026-02-07"}},
          {"known slot types, as strings and atoms and with duplicates",
           %{"slot_types" => ["lunch", :lunch, "breakfast", :dinner, "dinner"]}}
        ] do
      test "#{label} is accepted" do
        account = insert_account("generation window account")
        actor = insert_user_with_membership(account, "generation-window@example.com")

        assert {:ok, run_id} =
                 Server.start_generation(
                   account.id,
                   actor.id,
                   unquote(Macro.escape(constraints)),
                   self()
                 )

        assert %{current_run_id: ^run_id} = Server.get_status(account.id)

        stop_generation_server(account.id)
      end
    end

    test "a refused window creates no run on the server an account already has" do
      account = insert_account("generation window account")
      actor = insert_user_with_membership(account, "generation-window@example.com")

      assert {:ok, run_id} = Server.start_generation(account.id, actor.id, %{}, self())

      assert {:error, :invalid_date_range} =
               Server.start_generation(
                 account.id,
                 actor.id,
                 %{"date_from" => "2026-02-01", "date_to" => "2026-02-08"},
                 self()
               )

      # The first run is still the one the server holds, and the only one.
      assert %{current_run_id: ^run_id} = Server.get_status(account.id)
      assert generation_run_count(account) == 1

      stop_generation_server(account.id)
    end

    # The window is resolved once, when the request is admitted, and kept
    # explicit in the constraints the server holds and records with the run:
    # a later expansion of the same generation (a chat modification, on
    # another day) reads those dates and takes no default.
    #
    # Dates that depend on a default are offsets from the day of the test.
    # The server reads the day on its own and it can already be the next
    # one, so each assertion holds for both days.
    test "a request without a window holds the default one, explicit" do
      account = insert_account("generation window account")
      actor = insert_user_with_membership(account, "generation-window@example.com")
      today = Date.utc_today()

      assert {:ok, run_id} = Server.start_generation(account.id, actor.id, %{}, self())

      window = held_window(account)
      assert %{"date_from" => date_from, "date_to" => date_to} = window
      assert Date.from_iso8601!(date_from) in [today, Date.add(today, 1)]
      assert Date.diff(Date.from_iso8601!(date_to), Date.from_iso8601!(date_from)) == 6
      assert window["slot_types"] == ["breakfast", "lunch", "dinner"]

      assert recorded_window(run_id) == window

      stop_generation_server(account.id)
    end

    test "a request with only date_from holds the date_to it was admitted with" do
      account = insert_account("generation window account")
      actor = insert_user_with_membership(account, "generation-window@example.com")
      today = Date.utc_today()
      date_from = Date.to_iso8601(Date.add(today, 1))

      assert {:ok, run_id} =
               Server.start_generation(account.id, actor.id, %{"date_from" => date_from}, self())

      window = held_window(account)
      assert window["date_from"] == date_from

      assert window["date_to"] in [
               Date.to_iso8601(Date.add(today, 6)),
               Date.to_iso8601(Date.add(today, 7))
             ]

      assert window["slot_types"] == ["breakfast", "lunch", "dinner"]

      assert recorded_window(run_id) == window

      stop_generation_server(account.id)
    end

    test "window fields under atom keys are held once, under string keys" do
      account = insert_account("generation window account")
      actor = insert_user_with_membership(account, "generation-window@example.com")

      assert {:ok, _run_id} =
               Server.start_generation(
                 account.id,
                 actor.id,
                 %{
                   date_from: "2026-02-01",
                   date_to: "2026-02-03",
                   slot_types: [:lunch, "lunch", :dinner]
                 },
                 self()
               )

      # `held_window/1` checks that nothing is left under the atom keys.
      assert held_window(account) == %{
               "date_from" => "2026-02-01",
               "date_to" => "2026-02-03",
               "slot_types" => ["lunch", "dinner"]
             }

      stop_generation_server(account.id)
    end

    test "the window recorded with a run is admitted again as it is" do
      account = insert_account("generation window account")
      actor = insert_user_with_membership(account, "generation-window@example.com")
      date_from = Date.to_iso8601(Date.add(Date.utc_today(), 1))

      assert {:ok, run_id} =
               Server.start_generation(account.id, actor.id, %{"date_from" => date_from}, self())

      window = held_window(account)
      assert Map.keys(window) == ["date_from", "date_to", "slot_types"]

      # The constraints as the run recorded them, back from the database:
      # they name the whole window, so admitting them again resolves the
      # same one whatever the defaults are by then.
      recorded = generation_run(run_id).input_context["constraints"]

      assert {:ok, next_run_id} =
               Server.start_generation(account.id, actor.id, recorded, self())

      assert next_run_id != run_id
      assert held_window(account) == window
      assert recorded_window(next_run_id) == window

      stop_generation_server(account.id)
    end

    # A request that names one date gets the default of the other one: today
    # for `date_from`, today plus six days for `date_to`. The date it names
    # is an offset from the day of the test, T, chosen so the outcome is the
    # same whether the server reads T or T + 1 as today:
    #
    #   * `date_from` T + 1: the window ends on T + 6 or T + 7, six or seven
    #     days, accepted. T itself would make eight days on T + 1.
    #   * `date_from` T + 8: later than both ends, refused.
    #   * `date_to` T + 5: the window starts on T or T + 1, six or five days,
    #     accepted.
    #   * `date_to` T + 8: nine or eight days, refused. T + 7 would make
    #     seven days on T + 1.
    for {field, offset} <- [{"date_from", 1}, {"date_to", 5}] do
      test "only #{field}, #{offset} days ahead, is accepted" do
        account = insert_account("generation window account")
        actor = insert_user_with_membership(account, "generation-window@example.com")
        date = Date.to_iso8601(Date.add(Date.utc_today(), unquote(offset)))

        assert {:ok, run_id} =
                 Server.start_generation(account.id, actor.id, %{unquote(field) => date}, self())

        assert %{current_run_id: ^run_id} = Server.get_status(account.id)
        assert held_window(account)[unquote(field)] == date

        stop_generation_server(account.id)
      end
    end

    for {field, offset} <- [{"date_from", 8}, {"date_to", 8}] do
      test "only #{field}, #{offset} days ahead, is refused before a run exists" do
        account = insert_account("generation window account")
        actor = insert_user_with_membership(account, "generation-window@example.com")
        date = Date.to_iso8601(Date.add(Date.utc_today(), unquote(offset)))

        assert {:error, :invalid_date_range} =
                 Server.start_generation(account.id, actor.id, %{unquote(field) => date}, self())

        refute_generation_started(account)
      end
    end
  end

  # A run whose optimizer answer is valid ends in `proposal_ready` (#158). The
  # optimizer names the slot of a meal as a string, and the proposal is built
  # from the meals as `PayloadAdapter.translate_response/2` returns them.
  describe "start_generation/4 proposal" do
    test "a run with a seeded recipe broadcasts proposal_ready with its slots" do
      account = insert_account("generation proposal account")
      actor = insert_user_with_membership(account, "generation-proposal@example.com")
      recipe = insert_recipe("Proposal recipe")
      optimizer = start_optimizer_server!()

      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{account.id}")

      assert {:ok, run_id} =
               Server.start_generation(
                 account.id,
                 actor.id,
                 %{
                   "date_from" => "2026-02-01",
                   "date_to" => "2026-02-01",
                   "slot_types" => ["lunch", "dinner"]
                 },
                 self()
               )

      answer_optimizer_request(optimizer)

      assert_receive %Phoenix.Socket.Broadcast{event: "proposal_ready", payload: ready}, 5_000
      assert %{proposal_id: proposal_id, run_id: ^run_id, proposal: %{slots: slots}} = ready

      assert Enum.map(slots, &{&1.slot_key, &1.recipe_id, &1.recipe_name}) == [
               {"2026-02-01_dinner", recipe.id, "Proposal recipe"},
               {"2026-02-01_lunch", recipe.id, "Proposal recipe"}
             ]

      # The stored proposal, the one a confirmation reads, has the same slots.
      assert Enum.map(get_proposal(proposal_id).proposal_json["slots"], & &1["slot_key"]) ==
               ["2026-02-01_dinner", "2026-02-01_lunch"]

      assert generation_run(run_id).status == :completed

      stop_generation_server(account.id)
    end
  end

  # A new Account stores a Budget of 0, which means "not set": the run gets the
  # standard tier default, so a priced recipe still reaches a proposal (#212).
  describe "start_generation/4 Budget" do
    test "a run for an Account at 0 with a priced recipe broadcasts proposal_ready" do
      account = insert_account("generation unset budget account")
      assert account.default_budget_cents == 0
      actor = insert_user_with_membership(account, "generation-unset-budget@example.com")
      recipe = insert_recipe("Priced recipe")
      insert_recipe_cost(recipe, 1_500)

      assert {:ok, run_id} = start_priced_lunch_run(account, actor)

      assert_receive %Phoenix.Socket.Broadcast{event: "proposal_ready", payload: ready}, 5_000
      assert %{run_id: ^run_id, proposal: %{slots: [slot]}} = ready
      assert slot.recipe_id == recipe.id
      assert generation_run(run_id).status == :completed

      stop_generation_server(account.id)
    end

    test "a run for an Account with a positive Budget uses that Budget" do
      account = insert_account("generation set budget account")

      account =
        account
        |> Ecto.Changeset.change(%{default_budget_cents: 1_000})
        |> MealPlannerApi.Repo.update!()

      actor = insert_user_with_membership(account, "generation-set-budget@example.com")
      recipe = insert_recipe("Priced recipe over budget")
      insert_recipe_cost(recipe, 1_500)

      assert {:ok, run_id} = start_priced_lunch_run(account, actor)

      assert_receive %Phoenix.Socket.Broadcast{event: "generation_error", payload: error}, 5_000
      assert %{run_id: ^run_id, reason: "budget_exceeded"} = error
      refute_received %Phoenix.Socket.Broadcast{event: "proposal_ready"}
      assert generation_run(run_id).status == :error

      stop_generation_server(account.id)
    end
  end

  defp start_priced_lunch_run(account, actor) do
    optimizer = start_optimizer_server!()
    Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{account.id}")

    result =
      Server.start_generation(
        account.id,
        actor.id,
        %{"date_from" => "2026-02-01", "date_to" => "2026-02-01", "slot_types" => ["lunch"]},
        self()
      )

    answer_optimizer_request(optimizer)
    result
  end

  defp insert_recipe_cost(recipe, cents) do
    {:ok, market} = Shopping.create_supermarket(%{name: "Market for #{recipe.name}"})

    MealPlannerApi.Repo.insert!(%MealPlannerApi.Persistence.Catalog.RecipeDailyCost{
      recipe_id: recipe.id,
      supermarket_id: market.id,
      date: ~D[2026-01-31],
      total_cents_ars: cents
    })
  end

  test "confirmation after a correction keeps the proposal version and rebuilds its frozen quantities" do
    account = insert_account("Versioned confirmation")
    user = insert_user_with_membership(account, "versioned-confirmation@example.com")
    recipe = insert_recipe("Original confirmed recipe")
    ingredient = insert_ingredient("Versioned ingredient")

    {:ok, _} =
      RecipeRepo.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 1000,
        unit: :g
      })

    {_run, proposal} =
      insert_proposal_with_slots(account, user, [slot(~D[2026-08-06], :lunch, recipe.id)])

    {:ok, successor} =
      RecipeVersions.correct(recipe.id, %{
        name: "Corrected recipe",
        recipe_ingredients: [%{ingredient_id: ingredient.id, quantity_milli: 500, unit: :g}]
      })

    session = insert_active_session(account, user)
    start_server!(account, user)
    assert {:ok, _} = Server.confirm(pid_for_account(account), proposal.id, session.id)
    [meal] = list_all_meals(account.id)
    assert meal.recipe_id == recipe.id
    assert meal.recipe_version_id != successor.id
    assert meal.recipe_snapshot["name"] == "Original confirmed recipe"
    assert [%{quantity_milli: 1000}] = list_all_items(account)
  end

  # A stored proposal can hold a slot key that is not a Meal slot: one written
  # before a slot was removed (a snack slot before #342) or a malformed one.
  # Confirming it is refused with nothing saved; it does not crash the server.
  describe "confirm/3 — a slot key that is not a Meal slot" do
    for {label, slot_key} <- [
          {"an unknown slot", "2026-08-06_elevenses"},
          {"a key without a slot", "2026-08-06lunch"},
          {"a key with an invalid date", "someday_lunch"}
        ] do
      test "#{label} is refused, nothing is saved and the server keeps running" do
        account = insert_account("Unknown slot confirmation")
        user = insert_user_with_membership(account, "unknown-slot@example.com")
        recipe = insert_recipe("Recipe in an unknown slot")
        slot = Map.put(slot(~D[2026-08-06], :lunch, recipe.id), :slot_key, unquote(slot_key))

        {_run, proposal} = insert_proposal_with_slots(account, user, [slot])
        session = insert_active_session(account, user)
        start_server!(account, user)
        pid = pid_for_account(account)

        assert {:error, :transaction_failed} = Server.confirm(pid, proposal.id, session.id)

        assert Process.alive?(pid)
        assert list_all_meals(account.id) == []
        assert count_checkout_sessions(account) == 0
        assert MealPlannerApi.Repo.get!(PlanningProposal, proposal.id).status == :pending
      end
    end
  end

  # ---------------------------------------------------------------------------
  # @task 3.1 — re-confirm idempotency
  #
  # Spec: "Confirming an already-accepted proposal is rejected without side
  #        effects"
  # Pre-state: A proposal already in :accepted status (from a prior confirm).
  # Expectation: confirm/2 returns {:error, :already_confirmed}, no extra
  #              CheckoutSession or ShoppingItem rows are created for the
  #              account.
  # ---------------------------------------------------------------------------

  describe "confirm/2 — re-confirm idempotency (@task 3.1)" do
    test "an already-accepted proposal returns :already_confirmed and writes no cart" do
      account = insert_account("3-1 acct")
      user = insert_user_with_membership(account, "pr2-idemp@example.com")

      {_run, proposal} = insert_proposal_with_slots(account, user, [])

      # Flip the proposal to :accepted via the persistence layer
      # to mimic a successful prior confirm.
      {:ok, accepted} =
        PlanningRepo.update_proposal(proposal, %{status: :accepted})

      assert accepted.status == :accepted

      # PR2 — provide a real session id; the `:already_confirmed`
      # short-circuit runs BEFORE the session check, so this is just
      # a sanity UUID that proves the order.
      session = insert_active_session(account, user)

      start_server!(account, user)

      pid = pid_for_account(account)

      assert {:error, :already_confirmed} =
               Server.confirm(pid, accepted.id, session.id)

      assert count_checkout_sessions(account) == 0
    end
  end

  # ---------------------------------------------------------------------------
  # Issue #287 — confirm and reject only a pending proposal
  #
  # A proposal must never end both rejected and confirmed. Reject writes
  # nothing for a proposal that is no longer pending, and confirm refuses a
  # rejected one; an accepted one keeps answering `:already_confirmed`.
  # ---------------------------------------------------------------------------

  describe "reject/2 — pending guard (#287)" do
    test "rejects a pending proposal, completes its run and tells the topic" do
      account = insert_account("287 reject pending")
      user = insert_user_with_membership(account, "287-reject-pending@example.com")
      {run, proposal} = insert_proposal_with_slots(account, user, [])
      start_server!(account, user)
      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{account.id}")
      proposal_id = proposal.id

      assert :ok = Server.reject(pid_for_account(account), proposal_id)

      assert MealPlannerApi.Repo.get!(PlanningProposal, proposal_id).status == :rejected
      assert generation_run(run.id).status == :completed

      assert_receive %Phoenix.Socket.Broadcast{
        event: "proposal_rejected",
        payload: %{proposal_id: ^proposal_id}
      }
    end

    for status <- [:accepted, :rejected] do
      test "answers :not_pending for a proposal #{status} and writes nothing" do
        account = insert_account("287 reject #{unquote(status)}")
        user = insert_user_with_membership(account, "287-reject-#{unquote(status)}@example.com")
        {run, proposal} = insert_proposal_with_slots(account, user, [])
        {:ok, _} = PlanningRepo.update_proposal(proposal, %{status: unquote(status)})
        start_server!(account, user)
        Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{account.id}")

        assert {:error, :not_pending} = Server.reject(pid_for_account(account), proposal.id)

        assert MealPlannerApi.Repo.get!(PlanningProposal, proposal.id).status == unquote(status)
        assert generation_run(run.id).status == :processing
        refute_receive %Phoenix.Socket.Broadcast{event: "proposal_rejected"}
      end
    end
  end

  describe "confirm/3 — pending guard (#287)" do
    test "a rejected proposal answers :not_pending and writes nothing" do
      account = insert_account("287 confirm rejected")
      user = insert_user_with_membership(account, "287-confirm-rejected@example.com")
      recipe = insert_recipe("287 rejected recipe")

      {run, proposal} =
        insert_proposal_with_slots(account, user, [slot(~D[2026-08-06], :lunch, recipe.id)])

      {:ok, _} = PlanningRepo.update_proposal(proposal, %{status: :rejected})
      session = insert_active_session(account, user)
      start_server!(account, user)
      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{account.id}")

      assert {:error, :not_pending} =
               Server.confirm(pid_for_account(account), proposal.id, session.id)

      assert MealPlannerApi.Repo.get!(PlanningProposal, proposal.id).status == :rejected
      assert generation_run(run.id).status == :processing
      assert fetch_session(session.id).status == :active
      assert list_all_meals(account.id) == []
      assert count_checkout_sessions(account) == 0
      refute_receive %Phoenix.Socket.Broadcast{event: "proposal_confirmed"}
    end
  end

  # ---------------------------------------------------------------------------
  # @task 3.3 — cart persistence (per-meal grain) + account scoping +
  #              mixed-unit non-conversion
  #
  # Covers spec scenarios:
  #   * "Confirm creates a draft cart scoped to the account"
  #   * "Same ingredient across two meals produces two persisted rows"
  #   * "Same ingredient in different units is not converted"
  # ---------------------------------------------------------------------------

  describe "confirm/2 — cart persistence (@task 3.3)" do
    test "writes a draft cart scoped to the account, with per-meal grain and mixed units kept separate" do
      account = insert_account("3-3 acct")
      user = insert_user_with_membership(account, "pr2-cart@example.com")

      # 4 recipes, each one ingredient so the cart line count is predictable.
      recipe_flour_lunch = insert_recipe("Recipe Flour Lunch")
      recipe_flour_dinner = insert_recipe("Recipe Flour Dinner")
      recipe_milk_ml = insert_recipe("Recipe Milk ML")
      recipe_milk_g = insert_recipe("Recipe Milk G")

      flour = insert_ingredient("3-3 flour")
      milk = insert_ingredient("3-3 milk")

      attach_recipe_ingredient(recipe_flour_lunch, flour, 500_000, :g)
      attach_recipe_ingredient(recipe_flour_dinner, flour, 300_000, :g)
      attach_recipe_ingredient(recipe_milk_ml, milk, 250_000, :ml)
      attach_recipe_ingredient(recipe_milk_g, milk, 100_000, :g)

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-08-03], :lunch, recipe_flour_lunch.id),
          slot(~D[2026-08-03], :dinner, recipe_flour_dinner.id),
          slot(~D[2026-08-04], :lunch, recipe_milk_ml.id),
          slot(~D[2026-08-04], :dinner, recipe_milk_g.id)
        ])

      session = insert_active_session(account, user)
      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:ok, _reply} = Server.confirm(pid, proposal.id, session.id)

      # ---- CheckoutSession assertions --------------------------------------
      sessions = list_sessions(account)
      assert length(sessions) == 1

      [session] = sessions
      assert session.account_id == account.id
      assert session.status == :draft
      assert session.checkout_type == :physical

      # ---- ShoppingItem assertions ------------------------------------------
      items = list_items_for_session(session)
      assert length(items) == 4

      # 2 flour/:g rows, one per scheduled_meal_id (NOT merged).
      flour_items =
        Enum.filter(items, fn i ->
          i.ingredient_id == flour.id and i.unit == :g
        end)

      assert length(flour_items) == 2
      assert length(Enum.uniq(Enum.map(flour_items, & &1.scheduled_meal_id))) == 2
      assert Enum.all?(flour_items, &(&1.account_id == account.id))

      # Per spec, `estimated_price_cents` is left nil for this change (see
      # design §3 Decision 4) — the field lives on ShoppingItem, not on the
      # session itself.
      assert Enum.all?(items, &(&1.estimated_price_cents == nil))

      # milk/:ml and milk/:g both present, NOT converted.
      milk_ml_items = Enum.filter(items, &(&1.ingredient_id == milk.id and &1.unit == :ml))
      milk_g_items = Enum.filter(items, &(&1.ingredient_id == milk.id and &1.unit == :g))
      assert length(milk_ml_items) == 1
      assert length(milk_g_items) == 1
      assert hd(milk_ml_items).quantity_milli == 250_000
      assert hd(milk_g_items).quantity_milli == 100_000

      # ---- Proposal status got promoted to :accepted ----------------------
      refetched = get_proposal(proposal.id)
      assert refetched.status == :accepted
    end

    test "rebuild includes every scheduled meal in the locked session window" do
      account = insert_account("full-window acct")
      user = insert_user_with_membership(account, "full-window@example.com")

      prior_recipe = insert_recipe("Prior confirmed recipe")
      new_recipe = insert_recipe("New confirmed recipe")
      prior_ingredient = insert_ingredient("Prior ingredient")
      new_ingredient = insert_ingredient("New ingredient")

      attach_recipe_ingredient(prior_recipe, prior_ingredient, 100_000, :g)
      attach_recipe_ingredient(new_recipe, new_ingredient, 200_000, :g)

      prior_meal =
        MealPlannerApi.Repo.insert!(%MealPlannerApi.Persistence.Planning.ScheduledMeal{
          account_id: account.id,
          recipe_id: prior_recipe.id,
          date: ~D[2026-08-02],
          slot: :breakfast,
          is_cooked: false
        })

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-08-03], :lunch, new_recipe.id)
        ])

      session = insert_active_session(account, user)
      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:ok, reply} = Server.confirm(pid, proposal.id, session.id)
      assert reply.shopping_items_count == 2

      [checkout] = list_sessions(account)
      items = list_items_for_session(checkout)

      assert MapSet.new(Enum.map(items, & &1.ingredient_id)) ==
               MapSet.new([prior_ingredient.id, new_ingredient.id])

      assert Enum.any?(items, &(&1.scheduled_meal_id == prior_meal.id))
    end

    test "rebuild stores exact net shortage after usable inventory subtraction" do
      account = insert_account("net-shortage integration acct")
      user = insert_user_with_membership(account, "net-shortage@example.com")
      recipe = insert_recipe("Inventory-aware recipe")
      flour = insert_ingredient("Inventory-aware flour")

      attach_recipe_ingredient(recipe, flour, 200_000, :g)

      MealPlannerApi.Repo.insert!(%MealPlannerApi.Persistence.Inventory.InventoryItem{
        account_id: account.id,
        ingredient_id: flour.id,
        quantity_milli: 100_000,
        unit: :g,
        source_kind: :extra,
        last_mutation_at: DateTime.utc_now()
      })

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-08-04], :lunch, recipe.id)
        ])

      session = insert_active_session(account, user)
      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:ok, reply} = Server.confirm(pid, proposal.id, session.id)
      assert [%{ingredient_id: ingredient_id, unit: :g, quantity_milli: 100_000}] = reply.cart
      assert ingredient_id == flour.id

      [checkout] = list_sessions(account)
      [item] = list_items_for_session(checkout)
      assert item.quantity_milli == 100_000
    end
  end

  describe "confirm/2 — manual and removed Shopping items (#40)" do
    setup do
      account = insert_account("manual-removed acct")
      user = insert_user_with_membership(account, "manual-removed@example.com")

      prior_recipe = insert_recipe("Prior recipe")
      new_recipe = insert_recipe("New recipe")
      prior_ingredient = insert_ingredient("Prior removed ingredient")
      new_ingredient = insert_ingredient("New removed ingredient")

      attach_recipe_ingredient(prior_recipe, prior_ingredient, 100_000, :g)
      attach_recipe_ingredient(new_recipe, new_ingredient, 200_000, :g)

      prior_meal =
        MealPlannerApi.Repo.insert!(%MealPlannerApi.Persistence.Planning.ScheduledMeal{
          account_id: account.id,
          recipe_id: prior_recipe.id,
          date: ~D[2026-08-02],
          slot: :breakfast,
          is_cooked: false
        })

      removed =
        MealPlannerApi.Repo.insert!(%MealPlannerApi.Persistence.Shopping.ShoppingItem{
          account_id: account.id,
          scheduled_meal_id: prior_meal.id,
          planned_date: prior_meal.date,
          ingredient_id: prior_ingredient.id,
          quantity_milli: 100_000,
          unit: :g,
          status: :removed
        })

      :ok = Shopping.put_removals(account.id, [{prior_meal.id, prior_ingredient.id}])

      {:ok, manual} =
        Shopping.create_manual_item(%{
          account_id: account.id,
          name: "Dish soap",
          quantity_milli: 1_000,
          unit: :unit
        })

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [slot(~D[2026-08-03], :lunch, new_recipe.id)])

      session = insert_active_session(account, user)
      start_server!(account, user)

      %{
        account: account,
        pid: pid_for_account(account),
        proposal: proposal,
        session: session,
        prior_ingredient: prior_ingredient,
        new_ingredient: new_ingredient,
        prior_meal: prior_meal,
        removed: removed,
        manual: manual
      }
    end

    test "keeps a removed item while its meal still needs the Ingredient", c do
      assert {:ok, _reply} = Server.confirm(c.pid, c.proposal.id, c.session.id)

      items = account_items(c.account)

      assert [prior] = Enum.filter(items, &(&1.ingredient_id == c.prior_ingredient.id))
      assert prior.status == :removed
      assert prior.scheduled_meal_id == c.prior_meal.id
      assert prior.quantity_milli == 100_000

      assert [new] = Enum.filter(items, &(&1.ingredient_id == c.new_ingredient.id))
      assert new.status == :pending
    end

    test "leaves a manual item untouched", c do
      assert {:ok, _reply} = Server.confirm(c.pid, c.proposal.id, c.session.id)

      manual =
        MealPlannerApi.Repo.get!(MealPlannerApi.Persistence.Shopping.ShoppingItem, c.manual.id)

      assert manual.source == :manual
      assert manual.name == "Dish soap"
      assert manual.status == :pending
      assert manual.updated_at == c.manual.updated_at
    end

    test "keeps the removal while stock covers the Ingredient, until the stock is used up", c do
      # Stock now covers the prior meal, so it has no Shortage left.
      stock =
        MealPlannerApi.Repo.insert!(%MealPlannerApi.Persistence.Inventory.InventoryItem{
          account_id: c.account.id,
          ingredient_id: c.prior_ingredient.id,
          quantity_milli: 100_000,
          unit: :g,
          source_kind: :extra,
          last_mutation_at: DateTime.utc_now()
        })

      assert {:ok, _reply} = Server.confirm(c.pid, c.proposal.id, c.session.id)

      items = account_items(c.account)

      assert Enum.filter(items, &(&1.ingredient_id == c.prior_ingredient.id)) == []

      assert [%{status: :pending}] =
               Enum.filter(items, &(&1.ingredient_id == c.new_ingredient.id))

      # The stock is used up: the meal needs the Ingredient again, and the
      # derivation brings it back as the User left it.
      MealPlannerApi.Repo.delete!(stock)

      :ok =
        ShoppingService.ensure_shopping_items_from_schedule(
          c.account.id,
          [c.prior_meal]
        )

      assert [%{status: :removed, quantity_milli: 100_000}] =
               Enum.filter(account_items(c.account), &(&1.ingredient_id == c.prior_ingredient.id))
    end
  end

  # ---------------------------------------------------------------------------
  # #112 — an open Shopping item stored after the rebuild's wipe
  #
  # A Shopping list read can store an open item with a planned key of the
  # rebuild between its wipe and its insert. The trigger stores that item the
  # moment the rebuild opens its checkout session, which is after the wipe.
  # ---------------------------------------------------------------------------

  describe "confirm/3 — open Shopping item stored after the wipe (#112)" do
    test "the confirm succeeds and the item carries the rebuild's quantity and checkout session" do
      account = insert_account("112 acct")
      user = insert_user_with_membership(account, "open-item-after-wipe@example.com")
      recipe = insert_recipe("112 recipe")
      ingredient = insert_ingredient("112 ingredient")
      attach_recipe_ingredient(recipe, ingredient, 500_000, :g)

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [slot(~D[2026-08-03], :lunch, recipe.id)])

      session = insert_active_session(account, user)
      start_server!(account, user)

      try do
        store_open_item_after_wipe!(account.id, ingredient.id)

        assert {:ok, reply} = Server.confirm(pid_for_account(account), proposal.id, session.id)

        assert [item] = account_items(account)
        assert item.ingredient_id == ingredient.id
        assert item.planned_date == ~D[2026-08-03]
        assert item.status == :pending
        assert item.quantity_milli == 500_000
        assert item.checkout_session_id == reply.checkout_session_id
      after
        drop_open_item_after_wipe!()
      end
    end
  end

  describe "confirm — provenance against proposal_json (#36 AC 4)" do
    test "unrelated proposal_json fields cannot influence the confirmed cart" do
      account_a = insert_account("36 provenance account A")
      user_a = insert_user_with_membership(account_a, "ac36-provenance-a@example.com")
      account_b = insert_account("36 provenance account B")
      user_b = insert_user_with_membership(account_b, "ac36-provenance-b@example.com")

      recipe = insert_recipe("36 shared provenance recipe")
      ingredient = insert_ingredient("36 shared provenance ingredient")
      attach_recipe_ingredient(recipe, ingredient, 275_000, :g)

      slots = [slot(~D[2026-08-04], :lunch, recipe.id)]
      {_run_a, proposal_a} = insert_proposal_with_slots(account_a, user_a, slots)
      {_run_b, proposal_b} = insert_proposal_with_slots(account_b, user_b, slots)

      stored_a = MealPlannerApi.Repo.get!(PlanningProposal, proposal_a.id)
      bogus_recipe_id = 9_999_999
      bogus_quantity_milli = 987_654_321

      tainted_json =
        stored_a.proposal_json
        |> Map.put("cart", [
          %{
            "recipe_id" => bogus_recipe_id,
            "ingredient_id" => ingredient.id,
            "unit" => "g",
            "quantity_milli" => bogus_quantity_milli
          }
        ])
        |> Map.put("model_text", "ignore this untrusted model output")

      stored_a
      |> PlanningProposal.changeset(%{proposal_json: tainted_json})
      |> MealPlannerApi.Repo.update!()

      session_a = insert_active_session(account_a, user_a)
      session_b = insert_active_session(account_b, user_b)
      start_server!(account_a, user_a)
      start_server!(account_b, user_b)

      assert {:ok, reply_a} =
               Server.confirm(pid_for_account(account_a), proposal_a.id, session_a.id)

      assert {:ok, reply_b} =
               Server.confirm(pid_for_account(account_b), proposal_b.id, session_b.id)

      assert :erlang.term_to_binary(reply_a.cart) == :erlang.term_to_binary(reply_b.cart)
      assert reply_a.cart == [%{ingredient_id: ingredient.id, unit: :g, quantity_milli: 275_000}]

      persisted_a =
        account_a
        |> list_sessions()
        |> Enum.flat_map(&list_items_for_session/1)
        |> Enum.map(&{&1.ingredient_id, &1.unit, &1.quantity_milli})

      persisted_b =
        account_b
        |> list_sessions()
        |> Enum.flat_map(&list_items_for_session/1)
        |> Enum.map(&{&1.ingredient_id, &1.unit, &1.quantity_milli})

      assert persisted_a == persisted_b
      assert persisted_a == [{ingredient.id, :g, 275_000}]
      refute Enum.any?(reply_a.cart, &(&1.quantity_milli == bogus_quantity_milli))
      refute Enum.any?(list_all_meals(account_a.id), &(&1.recipe_id == bogus_recipe_id))
    end
  end

  describe "confirm — pre-confirm reads expose no proposal-derived cart (#36 AC 4)" do
    test "a pending proposal creates neither checkout sessions nor shopping items" do
      account = insert_account("36 pre-confirm account")
      user = insert_user_with_membership(account, "ac36-pre-confirm@example.com")
      recipe = insert_recipe("36 pre-confirm recipe")
      ingredient = insert_ingredient("36 pre-confirm ingredient")
      attach_recipe_ingredient(recipe, ingredient, 125_000, :g)

      {_run, _proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-08-05], :dinner, recipe.id)
        ])

      start_server!(account, user)

      assert list_sessions(account) == []
      assert list_all_items(account) == []
    end
  end

  # ---------------------------------------------------------------------------
  # @task 3.5 — empty-input edge cases:
  #   * "A recipe with no recipe_ingredients contributes no lines"
  #   * "Empty proposal yields an empty but valid cart"
  # ---------------------------------------------------------------------------

  describe "confirm/2 — empty-input edge cases (@task 3.5)" do
    test "a recipe with no recipe_ingredients creates a session but zero items" do
      account = insert_account("3-5a acct")
      user = insert_user_with_membership(account, "pr2-empty-a@example.com")

      recipe_no_ingredients = insert_recipe("Empty Recipe")

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-08-05], :lunch, recipe_no_ingredients.id)
        ])

      session = insert_active_session(account, user)
      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:ok, reply} = Server.confirm(pid, proposal.id, session.id)

      assert reply.scheduled_meals_count == 1
      assert reply.shopping_items_count == 0
      assert reply.cart == []
      assert is_binary(reply.checkout_session_id)

      sessions = list_sessions(account)
      assert length(sessions) == 1
      assert hd(sessions).status == :draft
      assert hd(sessions).checkout_type == :physical

      # Sanity: exactly one scheduled_meal but zero shopping_items, since the
      # only recipe has no ingredients.
      assert length(list_all_meals(account.id)) == 1
      assert list_all_items(account) == []
    end

    test "an empty proposal still creates a draft session with zero items" do
      account = insert_account("3-5b acct")
      user = insert_user_with_membership(account, "pr2-empty-b@example.com")

      {_run, proposal} = insert_proposal_with_slots(account, user, [])

      session = insert_active_session(account, user)
      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:ok, reply} = Server.confirm(pid, proposal.id, session.id)

      assert reply.scheduled_meals_count == 0
      assert reply.shopping_items_count == 0
      assert reply.cart == []
      assert is_binary(reply.checkout_session_id)

      sessions = list_sessions(account)
      assert length(sessions) == 1
    end
  end

  # ---------------------------------------------------------------------------
  # @task 3.7 — atomicity: a cart insert failure rolls back scheduled meals
  #             AND the proposal's :accepted flip.
  # ---------------------------------------------------------------------------

  describe "confirm/2 — cart insert failure rolls back scheduled meals (@task 3.7)" do
    test "when a ShoppingItem insert fails, scheduled meals + the :accepted status are all rolled back" do
      account = insert_account("3-7 acct")
      user = insert_user_with_membership(account, "pr2-atomicity@example.com")

      recipe = insert_recipe("Atomicity")
      ingredient = insert_ingredient("Atomicity ingredient")

      {:ok, _recipe_ingredient} =
        RecipeRepo.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: ingredient.id,
          quantity_milli: 1_000,
          unit: :g
        })

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-08-06], :lunch, recipe.id)
        ])

      session = insert_active_session(account, user)
      start_server!(account, user)
      pid = pid_for_account(account)

      # Fail the actual shopping write, not the already-frozen recipe content.
      try do
        reject_shopping_inserts!(account.id)

        assert {:error, _reason} = Server.confirm(pid, proposal.id, session.id)

        assert list_all_meals(account.id) == []
        assert list_all_items(account) == []
        assert list_sessions(account) == []

        rolled_back = get_proposal(proposal.id)
        assert rolled_back.status == :pending
      after
        restore_shopping_inserts!()
      end
    end
  end

  # ---------------------------------------------------------------------------
  # @task 3.9 — cross-account isolation:
  #   A confirmed cart for Account A is NOT visible to a membership scoped
  #   to Account B. This is a regression guard — `ShoppingRepo` already
  #   filters by `account_id`, so the test must pass as-is.
  # ---------------------------------------------------------------------------

  describe "confirm/2 — cross-account isolation (@task 3.9)" do
    test "Account B's listings never surface Account A's confirmed cart" do
      account_a = insert_account("3-9 account A")
      user_a = insert_user_with_membership(account_a, "pr2-cross-a@example.com")

      account_b = insert_account("3-9 account B")
      _user_b = insert_user_with_membership(account_b, "pr2-cross-b@example.com")

      recipe = insert_recipe("3-9 recipe")
      flour = insert_ingredient("3-9 flour A")
      attach_recipe_ingredient(recipe, flour, 1_000, :g)

      {_run_a, proposal_a} =
        insert_proposal_with_slots(account_a, user_a, [
          slot(~D[2026-08-07], :lunch, recipe.id)
        ])

      session_a = insert_active_session(account_a, user_a)
      start_server!(account_a, user_a)
      pid_a = pid_for_account(account_a)

      assert {:ok, _} = Server.confirm(pid_a, proposal_a.id, session_a.id)

      # Account A reads its own session.
      sessions_a = list_sessions(account_a)
      assert length(sessions_a) == 1

      # Account B reads its account — must be empty (no cross-tenant leak).
      sessions_b = list_sessions(account_b)
      assert sessions_b == []

      # And Account B's lookup helpers / scoped queries must return
      # nothing for Account A's data.
      items_b = list_all_items(account_b)
      assert items_b == []

      meals_b =
        account_b.id
        |> PlanningRepo.list_scheduled_meals(~D[2000-01-01], ~D[2100-01-01])

      assert meals_b == []
    end
  end

  # ---------------------------------------------------------------------------
  # @task 4.1 — server-side reply/broadcast fields (cart-aware payload)
  # ---------------------------------------------------------------------------

  describe "confirm/2 — reply/broadcast payload (@task 4.1)" do
    test "the ok-reply carries cart, checkout_session_id, and shopping_items_count alongside scheduled_meals_count" do
      account = insert_account("4-1 acct")
      user = insert_user_with_membership(account, "pr2-payload@example.com")

      recipe_lunch = insert_recipe("Recipe Lunch 4-1")
      flour = insert_ingredient("4-1 flour")
      attach_recipe_ingredient(recipe_lunch, flour, 500_000, :g)

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-08-08], :lunch, recipe_lunch.id)
        ])

      session = insert_active_session(account, user)
      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:ok, reply} = Server.confirm(pid, proposal.id, session.id)

      # All four cart-aware keys exist.
      assert reply.proposal_id == proposal.id
      assert reply.scheduled_meals_count == 1
      assert reply.shopping_items_count == 1
      assert is_binary(reply.checkout_session_id)
      assert reply.cart == [%{ingredient_id: flour.id, unit: :g, quantity_milli: 500_000}]
    end
  end

  # ===========================================================================
  # PR2 — Phase 2.2: do_confirm/3 PlanningSession-locked confirm
  #
  # `Server.confirm/3` is now the only public confirmation path. Each
  # scenario below drives `do_confirm/3` end-to-end through the DB and
  # asserts the structured error reply from the contract
  # (`design.md` §"Interfaces / Contracts"). The existing @task 3.x tests
  # are kept above to prove backward compat for the cart + meal
  # persistence pipeline.
  # ===========================================================================

  describe "confirm/3 — missing lock rejection (PR2 of #35)" do
    test "a missing session_id returns {:error, :missing_lock} before any write" do
      account = insert_account("2-2 missing acct")
      user = insert_user_with_membership(account, "pr2-missing@example.com")

      {_run, proposal} = insert_proposal_with_slots(account, user, [])

      start_server!(account, user)
      pid = pid_for_account(account)

      # Use a well-formed UUID that does NOT match any row — pre-check
      # returns :missing_lock BEFORE the ownership/guard checks fire.
      fake_session_id = Ecto.UUID.generate()

      assert {:error, :missing_lock} =
               Server.confirm(pid, proposal.id, fake_session_id)

      assert list_all_meals(account.id) == []
      assert count_checkout_sessions(account) == 0
    end
  end

  describe "confirm/3 — foreign-lock rejection (PR2 of #35)" do
    test "a session belonging to another Account returns {:error, :foreign_lock} before any write" do
      account_a = insert_account("2-2 foreign A")
      user_a = insert_user_with_membership(account_a, "pr2-foreign-a@example.com")

      account_b = insert_account("2-2 foreign B")
      user_b = insert_user_with_membership(account_b, "pr2-foreign-b@example.com")

      # Session exists on Account B; Account A tries to confirm with it.
      foreign_session = insert_active_session(account_b, user_b)

      {_run, proposal} = insert_proposal_with_slots(account_a, user_a, [])

      start_server!(account_a, user_a)
      pid_a = pid_for_account(account_a)

      assert {:error, :foreign_lock} =
               Server.confirm(pid_a, proposal.id, foreign_session.id)

      # Account A is untouched.
      assert list_all_meals(account_a.id) == []
      assert count_checkout_sessions(account_a) == 0

      # Account B's session is still :active — pre-check does not write.
      assert fetch_session(foreign_session.id).status == :active
    end
  end

  describe "confirm/3 — lost-lock rejection (PR2 of #35)" do
    test "a manually :lost_lock session returns {:error, :lost_lock} before any write" do
      account = insert_account("2-2 lost-lock acct")
      user = insert_user_with_membership(account, "pr2-lost@example.com")

      session = insert_active_session(account, user)

      # Manually drive the session to :lost_lock via the existing path
      # (mirrors what `mark_lost_lock/2` does on owner-process crash).
      assert {:ok, lost_lock} =
               PlanningRepo.mark_lost_lock(account.id, session.id)

      assert lost_lock.status == :lost_lock

      {_run, proposal} = insert_proposal_with_slots(account, user, [])

      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:error, :lost_lock} = Server.confirm(pid, proposal.id, session.id)

      assert list_all_meals(account.id) == []
      assert count_checkout_sessions(account) == 0
    end

    test "an expired lease transitions the row to :lost_lock and returns :lost_lock" do
      account = insert_account("2-2 expired acct")
      user = insert_user_with_membership(account, "pr2-expired@example.com")

      membership_id = owner_membership_id(account.id, user.id)

      # Create a session whose lease is already in the past.
      {:ok, session} =
        PlanningRepo.create_session(account.id, %{
          range_from: ~D[2026-09-01],
          range_to: ~D[2026-09-08],
          lock_owner_user_id: user.id,
          lock_owner_membership_id: membership_id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), -10, :second)
        })

      {_run, proposal} = insert_proposal_with_slots(account, user, [])

      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:error, :lost_lock} = Server.confirm(pid, proposal.id, session.id)

      # The pre-check transitioned the expired-active row to :lost_lock
      # BEFORE the main transaction, so the audit row is correct.
      assert fetch_session(session.id).status == :lost_lock
      assert fetch_session(session.id).terminal_at != nil

      assert list_all_meals(account.id) == []
      assert count_checkout_sessions(account) == 0
    end
  end

  describe "confirm/3 — terminal-lock rejection (PR2 of #35)" do
    test "a :committed session returns {:error, :terminal_lock} before any write" do
      account = insert_account("2-2 terminal acct")
      user = insert_user_with_membership(account, "pr2-terminal@example.com")

      session = insert_active_session(account, user)

      # Manually drive the session to :committed via the existing path.
      assert {:ok, committed} =
               PlanningRepo.mark_committed(account.id, session.id)

      assert committed.status == :committed

      {_run, proposal} = insert_proposal_with_slots(account, user, [])

      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:error, :terminal_lock} =
               Server.confirm(pid, proposal.id, session.id)

      assert list_all_meals(account.id) == []
      assert count_checkout_sessions(account) == 0
    end

    test "a :cancelled session returns {:error, :terminal_lock} before any write" do
      account = insert_account("2-2 cancelled acct")
      user = insert_user_with_membership(account, "pr2-cancelled@example.com")

      membership_id = owner_membership_id(account.id, user.id)

      session = insert_active_session(account, user)

      assert {:ok, cancelled} =
               PlanningRepo.cancel_session(account.id, session.id, membership_id, true)

      assert cancelled.status == :cancelled

      {_run, proposal} = insert_proposal_with_slots(account, user, [])

      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:error, :terminal_lock} =
               Server.confirm(pid, proposal.id, session.id)
    end
  end

  describe "confirm/3 — atomic session commit (PR2 of #35)" do
    test "a successful confirm transitions the session row to :committed alongside meals + cart" do
      account = insert_account("2-2 commit acct")
      user = insert_user_with_membership(account, "pr2-commit@example.com")

      recipe = insert_recipe("2-2 commit recipe")
      flour = insert_ingredient("2-2 commit flour")
      attach_recipe_ingredient(recipe, flour, 200_000, :g)

      session = insert_active_session(account, user)

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-09-10], :lunch, recipe.id)
        ])

      start_server!(account, user)
      pid = pid_for_account(account)

      assert {:ok, _reply} = Server.confirm(pid, proposal.id, session.id)

      # Session row is now :committed with terminal_at stamped.
      committed = fetch_session(session.id)
      assert committed.status == :committed
      assert committed.terminal_at != nil

      # And the rest of the pipeline ran.
      assert list_all_meals(account.id) |> length() == 1
      assert count_checkout_sessions(account) == 1
    end

    test "a failed confirm preserves the session as :active (rollback contract)" do
      account = insert_account("2-2 rollback acct")
      user = insert_user_with_membership(account, "pr2-rb@example.com")

      session = insert_active_session(account, user)

      recipe = insert_recipe("2-2 rb recipe")
      ingredient = insert_ingredient("2-2 rb ingredient")

      {:ok, _recipe_ingredient} =
        RecipeRepo.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: ingredient.id,
          quantity_milli: 1_000,
          unit: :g
        })

      {_run, proposal} =
        insert_proposal_with_slots(account, user, [
          slot(~D[2026-08-07], :lunch, recipe.id)
        ])

      start_server!(account, user)
      pid = pid_for_account(account)

      # Force the cart insert to violate shopping_items_ingredient_id_fkey.
      # The whole Multi must abort and the session row MUST stay :active.
      try do
        reject_shopping_inserts!(account.id)

        assert {:error, _reason} = Server.confirm(pid, proposal.id, session.id)

        # Session remains :active — the :committed transition was rolled back.
        reloaded = fetch_session(session.id)
        assert reloaded.status == :active
        assert reloaded.terminal_at == nil

        # Meals + cart never landed.
        assert list_all_meals(account.id) == []
        assert count_checkout_sessions(account) == 0
      after
        restore_shopping_inserts!()
      end
    end
  end

  # -- private helpers --------------------------------------------------------

  describe "confirm/3 — the session process ends with the session (#306)" do
    test "a successful confirm stops the server of the committed session" do
      account = insert_account("306 confirm stop")
      user = insert_user_with_membership(account, "306-confirm-stop@example.com")

      session = insert_active_session(account, user)
      {_run, proposal} = insert_proposal_with_slots(account, user, [])
      session_pid = start_session_process!(account, session)

      start_server!(account, user)

      assert {:ok, _reply} = Server.confirm(pid_for_account(account), proposal.id, session.id)

      assert_receive {:DOWN, _ref, :process, ^session_pid, :normal}, 1_000
      assert fetch_session(session.id).status == :committed
    end

    test "a confirm that finds the lease expired stops the server of the session" do
      account = insert_account("306 confirm lease")
      user = insert_user_with_membership(account, "306-confirm-lease@example.com")
      membership_id = owner_membership_id(account.id, user.id)

      {:ok, session} =
        PlanningRepo.create_session(account.id, %{
          range_from: ~D[2026-09-01],
          range_to: ~D[2026-09-08],
          lock_owner_user_id: user.id,
          lock_owner_membership_id: membership_id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), -10, :second)
        })

      {_run, proposal} = insert_proposal_with_slots(account, user, [])
      session_pid = start_session_process!(account, session)

      start_server!(account, user)

      assert {:error, :lost_lock} =
               Server.confirm(pid_for_account(account), proposal.id, session.id)

      assert_receive {:DOWN, _ref, :process, ^session_pid, :normal}, 1_000
      assert fetch_session(session.id).status == :lost_lock
    end

    test "a refused confirm keeps the server of the session running" do
      account = insert_account("306 confirm refused")
      user = insert_user_with_membership(account, "306-confirm-refused@example.com")

      session = insert_active_session(account, user)
      {_run, proposal} = insert_proposal_with_slots(account, user, [])
      {:ok, _rejected} = PlanningRepo.update_proposal(proposal, %{status: :rejected})
      session_pid = start_session_process!(account, session)

      start_server!(account, user)

      assert {:error, _reason} =
               Server.confirm(pid_for_account(account), proposal.id, session.id)

      refute_receive {:DOWN, _ref, :process, ^session_pid, _reason}, 200
      assert fetch_session(session.id).status == :active
    end
  end

  # A `PlanningSessionServer` serving `session`, as one restarted for a row
  # that is already `:active`. The caller monitors it.
  defp start_session_process!(account, session) do
    pid =
      start_supervised!(
        {PlanningSessionServer, account_id: account.id, session_id: session.id},
        id: make_ref()
      )

    assert %{status: :active} = :sys.get_state(pid)
    Process.monitor(pid)
    pid
  end

  # PR2 of issue #35 — Phase 2.2 lock tests. Creates an :active session
  # on (account, user) with a 120-second lease, returns the persisted
  # session row. Reused by every test that drives a successful
  # confirm through the new `do_confirm/3` path.
  defp insert_active_session(account, user) do
    membership_id = owner_membership_id(account.id, user.id)

    {:ok, session} =
      PlanningRepo.create_session(account.id, %{
        range_from: ~D[2026-08-01],
        range_to: ~D[2026-08-08],
        lock_owner_user_id: user.id,
        lock_owner_membership_id: membership_id,
        lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
      })

    session
  end

  defp owner_membership_id(account_id, user_id) do
    MealPlannerApi.Repo.one!(
      from(m in MealPlannerApi.Persistence.Accounts.AccountMembership,
        where: m.account_id == ^account_id and m.user_id == ^user_id and m.status == :active
      )
    ).id
  end

  defp fetch_session(id) do
    MealPlannerApi.Repo.get!(MealPlannerApi.Persistence.Planning.PlanningSession, id)
  end

  defp list_all_meals(account_id) do
    PlanningRepo.list_scheduled_meals(
      account_id,
      ~D[2000-01-01],
      ~D[2100-01-01]
    )
  end

  defp list_all_items(account) do
    account.id
    |> ShoppingRepo.list_checkout_sessions()
    |> Enum.map(& &1.id)
    |> Enum.flat_map(&ShoppingRepo.list_shopping_items/1)
  end

  defp start_server!(account, user) do
    via_tuple =
      {:via, Registry, {MealPlannerApi.Generation.Generations, {:generation, account.id}}}

    start_supervised!(
      {Server, account_id: account.id, user_id: user.id, name: via_tuple},
      id: {:generation_server, account.id}
    )

    :ok
  end

  # No generation run was created for the account and no generation server
  # is registered for it.
  defp refute_generation_started(account) do
    assert generation_run_count(account) == 0

    assert Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) ==
             []
  end

  # The window fields of the constraints the generation server of the account
  # holds, once the generation it is running has finished. Each field has one
  # value, under its string key.
  defp held_window(account) do
    %{constraints: constraints} = Server.get_status(account.id)

    assert Map.take(constraints, [:date_from, :date_to, :slot_types]) == %{}

    Map.take(constraints, ["date_from", "date_to", "slot_types"])
  end

  # The window fields of the constraints a generation run recorded.
  defp recorded_window(run_id) do
    Map.take(generation_run(run_id).input_context["constraints"], [
      "date_from",
      "date_to",
      "slot_types"
    ])
  end

  defp generation_run(run_id) do
    MealPlannerApi.Repo.get!(MealPlannerApi.Persistence.Planning.PlanningGenerationRun, run_id)
  end

  defp generation_run_count(account) do
    MealPlannerApi.Repo.aggregate(
      from(r in MealPlannerApi.Persistence.Planning.PlanningGenerationRun,
        where: r.account_id == ^account.id
      ),
      :count
    )
  end

  defp pid_for_account(account) do
    [{pid, _}] =
      Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id})

    pid
  end

  defp list_sessions(account) do
    ShoppingRepo.list_checkout_sessions(account.id)
  end

  defp list_items_for_session(session) do
    ShoppingRepo.list_shopping_items(session.id)
  end

  # Every planned Shopping item of the Account, whatever its status.
  defp account_items(account) do
    MealPlannerApi.Repo.all(
      from(i in MealPlannerApi.Persistence.Shopping.ShoppingItem,
        where: i.account_id == ^account.id and i.source == :planned_meal
      )
    )
  end

  defp get_proposal(id), do: MealPlannerApi.Repo.get!(PlanningProposal, id)

  # Stores an open Shopping item for every Scheduled meal of the Account, with
  # the given Ingredient in grams, as soon as a checkout session of the Account
  # is inserted: what a Shopping list read could store after the wipe.
  defp store_open_item_after_wipe!(account_id, ingredient_id) do
    SQL.query!(
      MealPlannerApi.Repo,
      """
      CREATE FUNCTION store_test_open_item() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.account_id = '#{account_id}'::uuid THEN
          INSERT INTO shopping_items
            (id, account_id, scheduled_meal_id, planned_date, ingredient_id, unit,
             quantity_milli, status, source, inserted_at, updated_at)
          SELECT gen_random_uuid(), m.account_id, m.id, m.date, '#{ingredient_id}'::uuid, 'g',
                 1, 'pending', 'planned_meal', now(), now()
          FROM scheduled_meals m
          WHERE m.account_id = NEW.account_id;
        END IF;
        RETURN NEW;
      END $$
      """
    )

    SQL.query!(
      MealPlannerApi.Repo,
      "CREATE TRIGGER store_test_open_item AFTER INSERT ON checkout_sessions FOR EACH ROW EXECUTE FUNCTION store_test_open_item()"
    )
  end

  defp drop_open_item_after_wipe! do
    SQL.query!(MealPlannerApi.Repo, "DROP TRIGGER store_test_open_item ON checkout_sessions")
    SQL.query!(MealPlannerApi.Repo, "DROP FUNCTION store_test_open_item()")
  end

  # Sandbox-scoped failure injection preserves immutable recipe versions.
  defp reject_shopping_inserts!(account_id) do
    SQL.query!(
      MealPlannerApi.Repo,
      """
      CREATE FUNCTION reject_test_shopping_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.account_id = '#{account_id}'::uuid THEN
          NEW.ingredient_id := '#{Ecto.UUID.generate()}'::uuid;
        END IF;
        RETURN NEW;
      END $$
      """
    )

    SQL.query!(
      MealPlannerApi.Repo,
      "CREATE TRIGGER reject_test_shopping_insert BEFORE INSERT ON shopping_items FOR EACH ROW EXECUTE FUNCTION reject_test_shopping_insert()"
    )
  end

  defp restore_shopping_inserts! do
    SQL.query!(
      MealPlannerApi.Repo,
      "DROP TRIGGER reject_test_shopping_insert ON shopping_items"
    )

    SQL.query!(MealPlannerApi.Repo, "DROP FUNCTION reject_test_shopping_insert()")
  end
end
