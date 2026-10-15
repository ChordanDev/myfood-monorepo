defmodule MealPlannerApi.Generation.Server do
  @moduledoc """
  OTP GenServer que orquesta el pipeline completo de generación de menús.

  Un proceso por `account_id` via Registry. El PlanningChannel lo usa para
  coordinar el flujo completo:

  1. Recibe `start_generation` → crea GenerationRun + Proposal (`:pending`)
  2. Construye los descriptores de slots y pide los candidatos a PlanningCandidateBuilder
   3. Llama a OptimizerServer.select_weekly_menu()
  4. Actualiza proposal_json con slots resueltos
  5. hace broadcast `proposal_ready` al canal
  6. Chat/modificación → re-optimiza slots específicos
  7. Confirm/Reject → persiste ScheduledMeals, limpia estado

  States: `:idle` → `:generating` → `:completed` → `:idle` (o `:error`)
  """

  use GenServer, restart: :temporary

  alias MealPlannerApi.Data.{
    PlanningRepo,
    ShoppingRepo
  }

  alias MealPlannerApi.Optimization.OptimizerServer
  alias MealPlannerApi.Optimization.PayloadAdapter
  alias MealPlannerApi.Persistence.Planning.PlanningSession
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.BudgetService
  alias MealPlannerApi.Services.GenerationService
  alias MealPlannerApi.Services.{PlanningCandidateBuilder, PlanningRequestValidator}
  alias MealPlannerApi.Services.ShoppingRebuilder
  alias Phoenix.Channel.Server, as: ChannelServer

  # -------------------------------------------------------------------------
  # Types
  # -------------------------------------------------------------------------

  @type state :: %{
          account_id: Ecto.UUID.t(),
          user_id: Ecto.UUID.t(),
          channel_pid: pid() | nil,
          phase: :idle | :generating | :completed | :error,
          current_run_id: Ecto.UUID.t() | nil,
          current_proposal_id: Ecto.UUID.t() | nil,
          proposal_json: map() | nil,
          constraints: map() | nil
        }

  @type reason :: :already_running | :not_found | :forbidden | :optimization_failed | term()

  # The longest window a generation covers, in days. Seven is the default
  # window of this pipeline (today plus six days) and the highest `max_days`
  # of `MealPlannerApi.Planning.weekly_plan_for/2` (7 for premium, 5
  # otherwise). The limit of each tier is not applied here.
  @max_window_days 7

  # The slots a meal can be planned for, by name: the vocabulary of
  # `ScheduledMeal.slot` and of `Recipe.suitable_for_slots`.
  @known_slots ~w(breakfast lunch snack dinner)

  @default_slot_types ~w(breakfast lunch dinner)

  # -------------------------------------------------------------------------
  # Via constructor
  # -------------------------------------------------------------------------

  @doc "Construye el registro `{:via, Registry, {Generations, key}}` para este account."
  @spec via(pos_integer() | binary()) :: GenServer.name()
  def via(account_id) when is_integer(account_id) and account_id > 0 do
    key = {:generation, account_id}
    {:via, Registry, {MealPlannerApi.Generation.Generations, key}}
  end

  def via(account_id) when is_binary(account_id) and account_id != "" do
    # Compatibility shim: Phase A — Tenancy Refactor migrated the
    # `accounts.id` column from `:id` (integer) to `:binary_id` (UUID)
    # without updating this guard. Production `PlanningChannel`
    # passes `membership.account_id` (UUID) into `start_generation/4`,
    # which on a cold start hits this `via/1` and would otherwise
    # crash with `FunctionClauseError`. See planning-shopping-extraction
    # design §2 + tasks.md @task 3.2.
    key = {:generation, account_id}
    {:via, Registry, {MealPlannerApi.Generation.Generations, key}}
  end

  # -------------------------------------------------------------------------
  # Client API
  # -------------------------------------------------------------------------

  @spec start_link(account_id: Ecto.UUID.t(), user_id: Ecto.UUID.t()) :: GenServer.on_start()
  def start_link(opts) do
    account_id = Keyword.fetch!(opts, :account_id)
    name = via(account_id)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @spec start_generation(Ecto.UUID.t(), Ecto.UUID.t(), map(), pid()) ::
          {:ok, run_id :: Ecto.UUID.t()} | {:error, reason()}
  def start_generation(account_id, user_id, constraints, channel_pid) do
    with {:ok, validated_constraints, _context} <-
           PlanningRequestValidator.validate_request(constraints, account_id, user_id),
         {:ok, window} <- generation_window(validated_constraints) do
      constraints = put_window(validated_constraints, window)
      dispatch_start_generation(account_id, user_id, constraints, channel_pid)
    end
  end

  defp dispatch_start_generation(account_id, user_id, constraints, channel_pid) do
    case Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account_id}) do
      [{pid, _}] ->
        GenServer.call(pid, {:start_generation, user_id, constraints, channel_pid})

      [] ->
        start_and_call(account_id, user_id, constraints, channel_pid)
    end
  end

  @spec chat(pid(), proposal_id :: Ecto.UUID.t(), message :: String.t()) :: :ok
  def chat(pid, proposal_id, message) when is_pid(pid) do
    GenServer.cast(pid, {:chat, proposal_id, message})
  end

  @spec confirm(pid(), proposal_id :: Ecto.UUID.t(), session_id :: Ecto.UUID.t()) ::
          {:ok, map()} | {:error, reason()}
  def confirm(pid, proposal_id, session_id) when is_pid(pid) do
    GenServer.call(pid, {:confirm, proposal_id, session_id})
  end

  @spec reject(pid(), proposal_id :: Ecto.UUID.t()) :: :ok
  def reject(pid, proposal_id) when is_pid(pid) do
    GenServer.cast(pid, {:reject, proposal_id})
  end

  @spec get_status(Ecto.UUID.t()) :: state() | nil
  def get_status(account_id) do
    case Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account_id}) do
      [{pid, _}] -> GenServer.call(pid, :get_status)
      [] -> nil
    end
  end

  # -------------------------------------------------------------------------
  # Callbacks
  # -------------------------------------------------------------------------

  @impl true
  def init(opts) do
    account_id = Keyword.fetch!(opts, :account_id)
    user_id = Keyword.get(opts, :user_id)
    # Optional pre-population for tests (channel-layer end-to-end coverage
    # at @task 4.3 in `planning-shopping-extraction`). Production callers
    # (`PlanningChannel.handle_in("start_planning", ...)`) set this via
    # the `:start_generation` call flow; the test path registers the
    # server directly with the test process as `channel_pid`.
    initial_channel_pid = Keyword.get(opts, :channel_pid)

    {:ok,
     %{
       account_id: account_id,
       user_id: user_id,
       channel_pid: initial_channel_pid,
       phase: :idle,
       current_run_id: nil,
       current_proposal_id: nil,
       proposal_json: nil,
       constraints: nil
     }}
  end

  @impl true
  def handle_call({:start_generation, user_id, constraints, channel_pid}, _from, state) do
    if state.phase == :generating do
      {:reply, {:error, :already_running}, state}
    else
      case PlanningRequestValidator.validate_request(constraints, state.account_id, user_id) do
        {:ok, validated_constraints, _context} ->
          {:ok, run} = create_run(state.account_id, user_id, validated_constraints)
          {:ok, proposal} = create_proposal(run.id)

          new_state =
            %{
              state
              | channel_pid: channel_pid,
                user_id: user_id,
                phase: :generating,
                current_run_id: run.id,
                current_proposal_id: proposal.id,
                proposal_json: %{slots: []},
                constraints: validated_constraints
            }

          send(self(), :run_optimization)
          {:reply, {:ok, run.id}, new_state}

        {:error, reason} ->
          {:reply, {:error, reason}, state}
      end
    end
  end

  @impl true
  def handle_call(:get_status, _from, state) do
    {:reply, state, state}
  end

  @impl true
  def handle_call({:confirm, proposal_id, session_id}, _from, state) do
    reply = do_confirm(state, proposal_id, session_id)
    {:reply, reply, state}
  end

  @impl true
  def handle_cast({:chat, proposal_id, message}, state) do
    handle_chat(state, proposal_id, message)
    {:noreply, state}
  end

  @impl true
  def handle_cast({:reject, proposal_id}, state) do
    handle_reject(state, proposal_id)
    {:noreply, state}
  end

  @impl true
  def handle_info(:run_optimization, state) do
    new_state = run_pipeline(state)
    {:noreply, new_state}
  end

  # -------------------------------------------------------------------------
  # Pipeline
  # -------------------------------------------------------------------------

  # The servers live under the `DynamicSupervisor` that
  # `MealPlannerApi.Generation.Supervisor` starts, not under that module,
  # which is a plain `Supervisor` and answers `:invalid_child_spec`.
  defp start_and_call(account_id, user_id, constraints, channel_pid) do
    case DynamicSupervisor.start_child(
           MealPlannerApi.Generation.ServerSupervisor,
           {__MODULE__, [account_id: account_id, user_id: user_id]}
         ) do
      {:ok, pid} ->
        GenServer.call(pid, {:start_generation, user_id, constraints, channel_pid})

      {:error, {:already_started, pid}} ->
        GenServer.call(pid, {:start_generation, user_id, constraints, channel_pid})

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp run_pipeline(state) do
    case PlanningRequestValidator.validate_request(
           state.constraints || %{},
           state.account_id,
           state.user_id
         ) do
      {:ok, _constraints, _context} ->
        run_authorized_pipeline(state)

      {:error, reason} ->
        broadcast(state, "generation_error", %{reason: Atom.to_string(reason)})
        %{state | phase: :error}
    end
  end

  defp run_authorized_pipeline(state) do
    %{
      account_id: account_id,
      user_id: user_id,
      current_run_id: run_id,
      constraints: constraints
    } = state

    # The candidate builder is the only recipe source. Client/AI payloads may
    # describe preferences, but never recipe IDs or account scope.
    descriptors = build_slot_descriptors(constraints)
    participant_ids = constraints["participant_ids"] || constraints[:participant_ids] || [user_id]

    case PlanningCandidateBuilder.build_candidate_set(account_id, descriptors, participant_ids) do
      {:ok, %{slots: canonical_slots}} ->
        optimizer_payload = build_canonical_optimizer_payload(canonical_slots, account_id)
        recipe_data = recipe_data_from_candidates(canonical_slots)

        case OptimizerServer.select_weekly_menu(optimizer_payload) do
          {:ok, optimizer_result} ->
            validation_context = %{
              slots: canonical_slots,
              account_id: account_id,
              constraints: optimizer_payload["constraints"]
            }

            validate_and_persist_proposal(
              optimizer_result,
              validation_context,
              recipe_data,
              state
            )

          {:error, reason} ->
            handle_optimization_error(run_id, reason, state)
        end

      {:error, reason, _details} ->
        handle_optimization_error(run_id, reason, state)
    end
  rescue
    _ ->
      broadcast(state, "generation_error", %{reason: "pipeline_error"})
      %{state | phase: :error}
  end

  defp validate_and_persist_proposal(optimizer_result, validation_context, recipe_data, state) do
    %{current_run_id: run_id, current_proposal_id: proposal_id} = state

    with :ok <-
           GenerationService.validate_optimizer_response(
             optimizer_result,
             validation_context
           ),
         {:ok, optimized_slots} <-
           PayloadAdapter.translate_response({:ok, optimizer_result}, recipe_data) do
      proposal_json = GenerationService.build_proposal_json(optimized_slots)
      persist_proposal_result(proposal_id, run_id, proposal_json, state)
    else
      {:error, reason, _details} -> handle_optimization_error(run_id, reason, state)
      {:error, reason} -> handle_optimization_error(run_id, reason, state)
    end
  end

  # -------------------------------------------------------------------------
  # Confirm / reject
  # -------------------------------------------------------------------------

  defp do_confirm(state, proposal_id, session_id) do
    with :ok <- PlanningRequestValidator.validate_actor(state.account_id, state.user_id),
         :ok <- verify_ownership(proposal_id, state.account_id),
         {:ok, proposal, run} <- fetch_proposal_with_run(proposal_id),
         :ok <- guard_not_already_confirmed(proposal),
         :ok <- verify_session_lock(state.account_id, session_id),
         {:ok, summary} <-
           run_confirm_transaction(state, proposal, run, session_id) do
      PlanningRepo.update_generation_run(run, %{
        status: :completed,
        completed_at: DateTime.utc_now()
      })

      broadcast(state, "proposal_confirmed", summary)

      reset_state(state)
      {:ok, summary}
    else
      {:error, _} = error -> error
    end
  end

  # PR2 of issue #35 — PlanningSession lock pre-check. The session MUST
  # exist, belong to this Account, be `:active`, and have an unexpired
  # lease. Any other state is rejected before any write. The session
  # transition to `:committed` happens later, INSIDE the same Multi as
  # the meals + cart writes, via `PlanningRepo.mark_committed/3`.
  defp verify_session_lock(account_id, session_id) do
    with {:ok, uuid} <- cast_session_id(session_id),
         {:ok, session} <- fetch_session_for_confirm(account_id, uuid) do
      classify_session_for_confirm(session)
    end
  end

  defp cast_session_id(session_id) when is_binary(session_id) do
    case Ecto.UUID.cast(session_id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :missing_lock}
    end
  end

  defp cast_session_id(_), do: {:error, :missing_lock}

  defp fetch_session_for_confirm(account_id, session_id) do
    case Repo.get(PlanningSession, session_id) do
      nil -> {:error, :missing_lock}
      %PlanningSession{account_id: ^account_id} = session -> {:ok, session}
      %PlanningSession{} -> {:error, :foreign_lock}
    end
  end

  defp classify_session_for_confirm(%PlanningSession{status: :active} = session) do
    if lease_active?(session.lease_expires_at) do
      :ok
    else
      # Lease expired — flip to :lost_lock OUTSIDE the main Multi so the
      # audit row is correct even if the transaction later aborts.
      PlanningRepo.mark_lost_lock(session.account_id, session.id)
      {:error, :lost_lock}
    end
  end

  defp classify_session_for_confirm(%PlanningSession{status: :lost_lock}),
    do: {:error, :lost_lock}

  defp classify_session_for_confirm(%PlanningSession{status: status})
       when status in [:committed, :cancelled, :expired],
       do: {:error, :terminal_lock}

  # Half-open lease window (matches `AccountAccess.trial_active?/2`).
  # A `nil` lease is treated as expired.
  defp lease_active?(%DateTime{} = lease),
    do: DateTime.compare(lease, DateTime.utc_now()) == :gt

  defp lease_active?(_), do: false

  # Wraps the scheduled-meals + cart writes in a single DB transaction so
  # either both persist or neither does. PR2 of issue #35 converted this
  # to one `Ecto.Multi` — the first step (`PlanningRepo.mark_committed/3`)
  # row-locks the session via `SELECT ... FOR UPDATE` and transitions
  # `:active` → `:committed` inside the same transaction as the meals,
  # cart, and proposal writes. The pre-check in `verify_session_lock/2`
  # has already classified the session; if it passes, the Multi step is
  # guaranteed to find an `:active` row.
  defp run_confirm_transaction(state, proposal, _run, session_id) do
    multi =
      Ecto.Multi.new()
      |> PlanningRepo.mark_committed(state.account_id, session_id)
      |> Ecto.Multi.run(:accept_proposal, fn _repo, _changes ->
        PlanningRepo.update_proposal(proposal, %{status: :accepted})
      end)
      |> Ecto.Multi.run(:scheduled_meals, fn _repo, _changes ->
        persist_scheduled_meals(proposal, state)
      end)
      |> Ecto.Multi.run(:shopping_cart, fn _repo, %{mark_committed: session} ->
        rebuild_shopping_cart(session, state)
      end)

    case Repo.transaction(multi) do
      {:ok, %{scheduled_meals: scheduled, shopping_cart: cart_summary}} ->
        {:ok,
         %{
           proposal_id: proposal.id,
           scheduled_meals_count: length(scheduled),
           cart: cart_summary.cart,
           shopping_items_count: cart_summary.lines_count,
           checkout_session_id: cart_summary.checkout_session_id
         }}

      {:error, _step, _reason, _changes} ->
        {:error, :transaction_failed}
    end
  rescue
    error in Postgrex.Error ->
      case error.postgres do
        %{code: :raise_exception, message: "recipe does not belong to Account"} ->
          {:error, :transaction_failed}

        _ ->
          reraise error, __STACKTRACE__
      end
  end

  # Re-confirm idempotency guard (planning-shopping-extraction design §3 Decision 5).
  # A proposal already in :accepted status must NOT trigger any write — no
  # second `CheckoutSession` and no extra `ShoppingItem` rows. Concurrency:
  # `update_proposal(:accepted)` in the next call serializes on the row,
  # so a race between two confirms still terminates with at most one cart.
  defp guard_not_already_confirmed(%{status: :accepted}), do: {:error, :already_confirmed}
  defp guard_not_already_confirmed(_proposal), do: :ok

  defp handle_reject(state, proposal_id) do
    with :ok <- verify_ownership(proposal_id, state.account_id),
         {:ok, proposal, run} <- fetch_proposal_with_run(proposal_id),
         {:ok, _} <- PlanningRepo.update_proposal(proposal, %{status: :rejected}) do
      PlanningRepo.update_generation_run(run, %{
        status: :completed,
        completed_at: DateTime.utc_now()
      })

      broadcast(state, "proposal_rejected", %{proposal_id: proposal_id})
    end
  end

  # -------------------------------------------------------------------------
  # Chat / modificación
  # -------------------------------------------------------------------------

  defp handle_chat(state, _proposal_id, msg) do
    case GenerationService.parse_modification(msg) do
      {:ok, parsed} ->
        new_state = apply_modification_to_state(state, parsed)

        broadcast(new_state, "proposal_update", %{
          change_type: parsed.change_type,
          new_value: parsed.new_value
        })

        {:noreply, new_state}

      {:error, _} ->
        broadcast(state, "generation_error", %{reason: "invalid_modification"})
        {:noreply, state}
    end
  end

  defp apply_modification_to_state(state, %{
         change_type: :remove_ingredient,
         new_value: ingredient
       }) do
    current = state.constraints || %{}
    exclusions = Map.get(current, :excluded_ingredients, [])

    updated = %{
      state
      | constraints: Map.put(current, :excluded_ingredients, exclusions ++ [ingredient])
    }

    send(self(), :run_optimization)
    updated
  end

  defp apply_modification_to_state(state, %{change_type: :lower_price}) do
    current = state.constraints || %{}
    budget = Map.get(current, :budget_cents, 10_000)
    updated = %{state | constraints: Map.put(current, :budget_cents, div(budget * 80, 100))}
    send(self(), :run_optimization)
    updated
  end

  defp apply_modification_to_state(state, %{change_type: :higher_protein}) do
    current = state.constraints || %{}
    protein = Map.get(current, :protein_g_per_meal, 25)
    updated = %{state | constraints: Map.put(current, :protein_g_per_meal, protein + 10)}
    send(self(), :run_optimization)
    updated
  end

  defp apply_modification_to_state(state, %{change_type: :change_recipe, slot_key: _sk}) do
    send(self(), :run_optimization)
    state
  end

  # -------------------------------------------------------------------------
  # Helpers
  # -------------------------------------------------------------------------

  defp create_run(account_id, user_id, constraints) do
    PlanningRepo.create_generation_run(%{
      account_id: account_id,
      user_id: user_id,
      status: :processing,
      started_at: DateTime.utc_now(),
      input_context: %{
        constraints: constraints,
        generated_by: "generation_server_v2"
      }
    })
  end

  defp create_proposal(run_id) do
    PlanningRepo.create_proposal(%{
      generation_run_id: run_id,
      proposal_json: %{slots: []},
      status: :pending
    })
  end

  defp build_slot_descriptors(constraints) do
    case generation_window(constraints) do
      {:ok, %{from: from, to: to, slot_types: slot_types}} ->
        for date <- Date.range(from, to), slot <- slot_types, do: %{date: date, slot: slot}

      {:error, _reason} ->
        []
    end
  end

  # The window of a generation: the days and the slot types it is expanded
  # into, one descriptor per day and slot. Both come from the constraints of
  # the client, so this is the only place that reads them:
  # `start_generation/4` refuses the request with the reason returned here
  # before a run exists, and `build_slot_descriptors/1` expands nothing but a
  # window that passed.
  #
  # The defaults depend on the day, so a window is resolved once: an admitted
  # request gets it written into its constraints (`put_window/2`), and what
  # `build_slot_descriptors/1` reads afterwards is that explicit window.
  #
  #   * `date_from` and `date_to` default to today and today plus six days.
  #     A value that is not an ISO 8601 date string is `:invalid_date`; a
  #     range that ends before it starts or covers more than
  #     `@max_window_days` days is `:invalid_date_range`.
  #   * `slot_types` defaults to `@default_slot_types`. Anything but a
  #     non-empty list of known slots is `:invalid_payload`.
  #
  # A key is read as a string and then as an atom, and a `nil` value counts
  # as an omitted key.
  defp generation_window(constraints) do
    today = Date.utc_today()

    with {:ok, from} <- window_date(constraint(constraints, :date_from), today),
         {:ok, to} <- window_date(constraint(constraints, :date_to), Date.add(today, 6)),
         :ok <- window_length(from, to),
         {:ok, slot_types} <- window_slot_types(constraint(constraints, :slot_types)) do
      {:ok, %{from: from, to: to, slot_types: slot_types}}
    end
  end

  defp constraint(constraints, key) do
    case Map.get(constraints, Atom.to_string(key)) do
      nil -> Map.get(constraints, key)
      value -> value
    end
  end

  # Writes the window a request was admitted with into its constraints. The
  # constraints are what the server keeps in its state, records with the run
  # and reads again each time it expands the generation, after a chat
  # modification included: with the window explicit in them, a later reading
  # resolves the same window whatever the day is by then.
  #
  # Each field ends with one value, under its string key: the key
  # `constraint/2` reads first, the one a client sends and the one the run
  # gets back from the database. The dates are ISO 8601 strings and the slot
  # types are names, so the recorded run holds what the state holds.
  defp put_window(constraints, %{from: from, to: to, slot_types: slot_types}) do
    constraints
    |> Map.drop([:date_from, :date_to, :slot_types])
    |> Map.merge(%{
      "date_from" => Date.to_iso8601(from),
      "date_to" => Date.to_iso8601(to),
      "slot_types" => slot_types
    })
  end

  defp window_date(nil, default), do: {:ok, default}

  defp window_date(value, _default) when is_binary(value) do
    case Date.from_iso8601(value) do
      {:ok, date} -> {:ok, date}
      {:error, _reason} -> {:error, :invalid_date}
    end
  end

  defp window_date(_value, _default), do: {:error, :invalid_date}

  defp window_length(from, to) do
    days = Date.diff(to, from) + 1

    if days in 1..@max_window_days, do: :ok, else: {:error, :invalid_date_range}
  end

  defp window_slot_types(nil), do: {:ok, @default_slot_types}

  # The slot types of a window are names: a slot the caller passed as an atom
  # is written as its name, and no atom is made out of a string. A slot named
  # twice is kept once.
  defp window_slot_types([_ | _] = slot_types) do
    if Enum.all?(slot_types, &known_slot?/1) do
      {:ok, slot_types |> Enum.map(&to_string/1) |> Enum.uniq()}
    else
      {:error, :invalid_payload}
    end
  end

  defp window_slot_types(_slot_types), do: {:error, :invalid_payload}

  defp known_slot?(slot) when is_atom(slot) or is_binary(slot),
    do: to_string(slot) in @known_slots

  defp known_slot?(_slot), do: false

  defp build_canonical_optimizer_payload(canonical_slots, account_id) do
    candidates_by_slot =
      canonical_slots
      |> Enum.group_by(& &1.slot)
      |> Map.new(fn {slot, slots} -> {slot, slots |> hd() |> Map.fetch!(:candidates)} end)

    %{
      "days" => canonical_slots |> Enum.map(& &1.date) |> Enum.uniq(),
      "slots" => canonical_slots |> Enum.map(& &1.slot) |> Enum.uniq(),
      "constraints" => %{
        "weekly_budget_cents" => server_owned_budget(account_id),
        "inventory_weight" =>
          Application.get_env(:meal_planner_api, :optimizer_inventory_weight, 100),
        "macro_bounds" => %{
          "protein_g" => %{"min" => 0, "max" => 1_000_000},
          "carbs_g" => %{"min" => 0, "max" => 1_000_000},
          "fat_g" => %{"min" => 0, "max" => 1_000_000},
          "calories" => %{"min" => 0, "max" => 1_000_000}
        }
      },
      "candidates_by_slot" => candidates_by_slot
    }
  end

  defp server_owned_budget(account_id), do: BudgetService.weekly_limit_cents(account_id)

  defp recipe_data_from_candidates(canonical_slots) do
    canonical_slots
    |> Enum.flat_map(& &1.candidates)
    |> Map.new(fn candidate ->
      {candidate["recipe_id"],
       %{
         name: candidate["label"],
         price_cents: candidate["estimated_cost_cents"],
         protein_g: candidate["protein_g_per_serving"],
         calories: candidate["calories_per_serving"],
         carbs_g: candidate["carbs_g_per_serving"]
       }}
    end)
  end

  defp persist_proposal_result(proposal_id, run_id, proposal_json, state) do
    proposal = Repo.get!(MealPlannerApi.Persistence.Planning.PlanningProposal, proposal_id)
    PlanningRepo.update_proposal(proposal, %{proposal_json: proposal_json})

    run = Repo.get!(MealPlannerApi.Persistence.Planning.PlanningGenerationRun, run_id)

    PlanningRepo.update_generation_run(run, %{
      status: :completed,
      completed_at: DateTime.utc_now()
    })

    broadcast(state, "proposal_ready", %{
      proposal_id: proposal_id,
      run_id: run_id,
      proposal: proposal_json
    })

    %{state | phase: :completed, proposal_json: proposal_json}
  end

  defp handle_optimization_error(run_id, reason, state) do
    run = Repo.get!(MealPlannerApi.Persistence.Planning.PlanningGenerationRun, run_id)
    PlanningRepo.update_generation_run(run, %{status: :error, completed_at: DateTime.utc_now()})

    {reason, details} = normalize_optimization_error(reason)
    broadcast(state, "generation_error", %{run_id: run_id, reason: reason, details: details})
    %{state | phase: :error}
  end

  defp normalize_optimization_error({reason, details}) when is_atom(reason) and is_map(details),
    do: {Atom.to_string(reason), details}

  defp normalize_optimization_error(reason) when is_atom(reason),
    do: {Atom.to_string(reason), %{}}

  defp normalize_optimization_error(reason) when is_binary(reason), do: {reason, %{}}
  defp normalize_optimization_error(_), do: {"optimization_failed", %{}}

  defp broadcast(state, event, payload) do
    # Compatibility fix (planning-shopping-extraction @task 4.3):
    # `Phoenix.Channel.broadcast!/3` accepts a Socket struct only and
    # calls `assert_joined!/1` on the first argument. The pre-existing
    # call passed `state.channel_pid` (a pid), which crashes with
    # `FunctionClauseError`. Switch to `Phoenix.Channel.Server.broadcast!/4`
    # which takes `(pubsub_server, topic, event, payload)` and dispatches
    # on topic directly — no Socket required, no need to track the
    # channel pid at all.
    with true <- state.account_id != nil,
         :ok <-
           ChannelServer.broadcast!(
             MealPlannerApi.PubSub,
             "planning:#{state.account_id}",
             event,
             payload
           ) do
      :ok
    else
      _ -> :ok
    end
  end

  defp fetch_proposal(id) do
    Repo.get!(MealPlannerApi.Persistence.Planning.PlanningProposal, id)
  end

  defp fetch_proposal_with_run(proposal_id) do
    proposal = fetch_proposal(proposal_id)

    run =
      Repo.get!(
        MealPlannerApi.Persistence.Planning.PlanningGenerationRun,
        proposal.generation_run_id
      )

    {:ok, proposal, run}
  end

  defp verify_ownership(proposal_id, account_id) do
    case fetch_proposal_with_run(proposal_id) do
      {:ok, _proposal, run} ->
        if run.account_id == account_id, do: :ok, else: {:error, :forbidden}
    end
  rescue
    Ecto.NoResultsError -> {:error, :not_found}
  end

  defp persist_scheduled_meals(proposal, state) do
    slots = get_in(proposal.proposal_json, [:slots]) || []
    slots = if slots == [], do: get_in(proposal.proposal_json, ["slots"]) || [], else: slots

    result =
      Enum.reduce_while(slots, [], fn slot, acc ->
        [date, slot_name] = split_slot_key(slot)

        attrs = %{
          account_id: state.account_id,
          user_id: state.user_id,
          generation_run_id: proposal.generation_run_id,
          planning_proposal_id: proposal.id,
          date: Date.from_iso8601!(date),
          slot: String.to_existing_atom(slot_name),
          recipe_id: parse_recipe_id(Map.get(slot, :recipe_id) || Map.get(slot, "recipe_id")),
          selected_quantity:
            Map.get(slot, :selected_quantity, Map.get(slot, "selected_quantity", 1)),
          is_cooked: false
        }

        case PlanningRepo.schedule_meal(attrs) do
          {:ok, meal} -> {:cont, [meal | acc]}
          {:error, _} = err -> {:halt, err}
        end
      end)

    case result do
      {:error, _} = err -> err
      meals -> {:ok, Enum.reverse(meals)}
    end
  end

  # `build_proposal_json/1` writes slots with atom keys (`slot_key:`,
  # `recipe_id:`); legacy callers / tests may store string keys. Accept
  # both shapes so the existing on-wire proposal format (atom-keyed from
  # `build_proposal_json`) and the same shape expressed as a string map
  # both flow through the confirm pipeline.
  defp split_slot_key(%{slot_key: sk}) when is_binary(sk), do: String.split(sk, "_", parts: 2)
  defp split_slot_key(%{"slot_key" => sk}) when is_binary(sk), do: String.split(sk, "_", parts: 2)

  # Will fail loudly in `Date.from_iso8601!/1` / `String.to_existing_atom/1` rather than silently filter.
  defp split_slot_key(_), do: [nil, nil]

  # Rebuilds the shopping cart from the FULL confirmed window.
  #
  # Unlike the prior `persist_shopping_cart/2` (which used only the current
  # proposal's slots), this reads ALL `scheduled_meals` in the session's
  # `[range_from, range_to]` window, subtracts usable inventory via
  # `ShoppingRebuilder.compute_net_shortages/2`, wipes prior pending/in_cart
  # rows, and inserts per-meal net-shortage rows.
  #
  # Runs inside the same `Ecto.Multi` as `mark_committed/3` — atomic.
  # Returns `{:ok, %{cart, lines_count, checkout_session_id}}`.
  defp rebuild_shopping_cart(session, state) do
    range_from = session.range_from
    range_to = session.range_to

    # 1. Load ALL scheduled meals in the window (not just this proposal's)
    all_meals =
      PlanningRepo.list_scheduled_meals(state.account_id, range_from, range_to)
      |> MealPlannerApi.Repo.preload(recipe: :recipe_ingredients)

    # 2. Build the usable inventory pool
    pool =
      MealPlannerApi.Inventory.available_for(
        %{account_id: state.account_id},
        %{exclude_range: {range_from, range_to}}
      )
      |> Enum.into(%{}, fn item -> {{item.ingredient_id, item.unit}, item.quantity_milli} end)

    # 3. Compute net shortages (pure)
    lines = ShoppingRebuilder.compute_net_shortages(all_meals, pool)

    # 4. Wipe existing pending/in_cart/removed planned items in the window,
    #    remembering the removed ones: the User's removals survive a rebuild
    #    while a meal still needs the Ingredient. Manual items are not touched.
    removed_keys = Shopping.removed_item_keys(state.account_id, range_from, range_to)
    ShoppingRepo.delete_pending_for_window(state.account_id, range_from, range_to)

    # 5. Create checkout session and insert net-shortage rows
    with {:ok, checkout} <-
           ShoppingRepo.create_checkout_session(%{
             account_id: state.account_id,
             status: :draft,
             checkout_type: :physical
           }),
         :ok <- insert_cart_items(lines, state.account_id, checkout.id) do
      Shopping.restore_removed_items(state.account_id, removed_keys, range_from, range_to)

      {:ok,
       %{
         cart: GenerationService.summarize_cart(lines),
         lines_count: length(lines),
         checkout_session_id: checkout.id
       }}
    end
  end

  defp insert_cart_items(lines, account_id, session_id) do
    Enum.reduce_while(lines, :ok, fn line, :ok ->
      attrs = %{
        account_id: account_id,
        scheduled_meal_id: line.scheduled_meal_id,
        planned_date: line.planned_date,
        ingredient_id: line.ingredient_id,
        unit: line.unit,
        quantity_milli: line.quantity_milli,
        checkout_session_id: session_id,
        status: :pending
      }

      # An upsert, not an insert: a Shopping list read may have stored an open
      # item with this planned key after the wipe above, and the rebuild wins.
      case ShoppingRepo.upsert_open_shopping_item(attrs) do
        {:ok, _} -> {:cont, :ok}
        {:error, _} = err -> {:halt, err}
      end
    end)
  end

  defp reset_state(state) do
    %{
      state
      | channel_pid: nil,
        phase: :idle,
        current_run_id: nil,
        current_proposal_id: nil,
        proposal_json: nil,
        constraints: nil
    }
  end

  defp parse_recipe_id(nil), do: nil
  defp parse_recipe_id(id) when is_integer(id), do: id

  defp parse_recipe_id(id) when is_binary(id) do
    case Integer.parse(id) do
      {int, ""} -> int
      _ -> id
    end
  end

  defp parse_recipe_id(_), do: nil
end
