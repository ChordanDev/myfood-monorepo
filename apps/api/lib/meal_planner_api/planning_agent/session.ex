defmodule MealPlannerApi.PlanningAgent.Session do
  @moduledoc """
  The planning agent session (issue #423, ported from myfood@d9b965a): one
  supervised process per active agent Planning session, owning the agent
  loop, the workspace, the limits, the consent gate and the confirmation.
  Its interface is transport-agnostic: the `planning:<account_id>` channel
  and the terminal chat (`mix planning.chat`) are thin adapters over it.

  ## Interface

    * `start/2` — opens a Planning session for a range of 1 to
      `max_range_days` days (31 by default) starting today or later in the
      Account's timezone, with no Scheduled meal yet. Only an eligible
      Account starts one (`AccountAccess.eligible?/1`, issue #397), whatever
      `REVENUECAT_ACCESS_ENFORCEMENT` says. One agent session per Account; it
      holds the range lock of `planning_sessions` (marked `agent`), so it
      also excludes a legacy session over the same days.
    * `record_consent/2` — the session User's AI-processing consent. Asked
      once per User and stored (`MealPlannerApi.PlanningAgent.Consent`).
    * `send_message/2` — a Member message; runs one agent turn.
    * `stop/2` — halts the running turn; the session stays open.
    * `confirm/3` — saves the Proposal on display as Scheduled meals,
      idempotently (`MealPlannerApi.PlanningAgent.Confirmation`), and ends
      the session.
    * `confirmation_status/2` — whether a Proposal was confirmed, also after
      the session ended.
    * `cancel/2` — ends the session (its Member or the Account owner).
    * `whereis/1` — the running session of an Account, if any.

  Only breakfast, lunch and dinner are planned.

  ## Events

  Subscribers receive `{:planning_agent_event, session_id, event}`; every
  event passes the allowlist of `event_fields/0`, so raw tool output and
  model reasoning never reach a subscriber.

  ## Limits

  Each Member message gets `max_iterations` model calls (default 15) and a
  global deadline (default 5 minutes), after which the running turn is
  killed and its late results are discarded. The whole session never makes
  more than 60 model calls (`MealPlannerApi.PlanningAgent.Allowance`), and
  its paid calls are bounded by the model adapter's spend caps.

  The session renews its lease every minute up to the 30-minute cap of
  `PlanningRepo.renew_session_lease/4`; a lost lease ends it. It also ends
  when its last subscriber leaves. Absence grace, idle expiry and restart
  recovery belong to #432.
  """

  use GenServer, restart: :temporary

  require Logger

  alias MealPlannerApi.AccountAccess
  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Data.PlanningRepo

  alias MealPlannerApi.PlanningAgent.{
    Allowance,
    CallBounds,
    Confirmation,
    Consent,
    HouseholdContext,
    Loop,
    Proposal,
    ProposalValidator
  }

  @registry MealPlannerApi.PlanningAgent.Registry
  @supervisor MealPlannerApi.PlanningAgent.SessionSupervisor
  @task_supervisor MealPlannerApi.PlanningAgent.TaskSupervisor

  @slots ~w(breakfast lunch dinner)
  @default_max_iterations 15
  @default_deadline_ms 5 * 60 * 1000
  @default_max_range_days 31
  @lease_seconds 120
  @lease_renew_ms 60_000
  @confirm_call_timeout 30_000
  # Bounds what a Member message adds to the transcript, which is re-sent on
  # every model call.
  @max_message_bytes 4_000

  @type attrs :: %{
          account_id: Ecto.UUID.t(),
          user_id: Ecto.UUID.t(),
          membership_id: Ecto.UUID.t(),
          range: {Date.t(), Date.t()}
        }

  # ===========================================================================
  # Public API
  # ===========================================================================

  @doc """
  Starts a Planning session. Returns its id and whether the User must still
  give AI-processing consent.

  ## Options

    * `:model` — `{adapter, opts}` implementing `MealPlannerApi.PlanningAgent.Model`
      (default from `config :meal_planner_api, :planning_agent`)
    * `:optimizer` — a module implementing `MealPlannerApi.Optimization.OptimizerPort`
      (default `:planning_optimizer_client`)
    * `:recipe_search` — `{module, opts}` replacing the recipe search (tests)
    * `:subscriber` — pid receiving events (more can join with `subscribe/2`)
    * `:max_iterations`, `:deadline_ms`, `:call_policies` — limits
  """
  @spec start(attrs(), keyword()) ::
          {:ok, %{session_id: Ecto.UUID.t(), pid: pid(), consent_required: boolean()}}
          | {:error,
             :subscription_required
             | :invalid_range
             | {:slot_occupied, [{Date.t(), atom()}]}
             | :session_already_active
             | :overlapping_range
             | :agent_unavailable}
  def start(attrs, opts \\ []) do
    {model, model_opts} = Keyword.get_lazy(opts, :model, fn -> config(:model) end)

    with :ok <- check_eligible(attrs.account_id),
         {:ok, {from_date, to_date}} <- validate_range(attrs.account_id, attrs.range),
         :ok <- ensure_unplanned(attrs.account_id, from_date, to_date),
         :ok <- ensure_none_running(attrs.account_id),
         {:ok, model_state} <- init_model(model, model_opts),
         {:ok, row} <- lock(attrs, from_date, to_date) do
      init_args = %{
        attrs: attrs,
        session_id: row.id,
        model: model,
        model_state: seal(model_state),
        optimizer: Keyword.get(opts, :optimizer),
        recipe_search: Keyword.get(opts, :recipe_search),
        subscriber: Keyword.get(opts, :subscriber),
        max_iterations: Keyword.get(opts, :max_iterations, @default_max_iterations),
        deadline_ms: Keyword.get(opts, :deadline_ms, @default_deadline_ms),
        call_policies: Keyword.get(opts, :call_policies, %{})
      }

      case DynamicSupervisor.start_child(@supervisor, {__MODULE__, init_args}) do
        {:ok, pid} ->
          {:ok,
           %{session_id: row.id, pid: pid, consent_required: not Consent.granted?(attrs.user_id)}}

        # A concurrent start registered first; init/1 released the row.
        :ignore ->
          {:error, :session_already_active}

        {:error, _reason} ->
          _ = PlanningRepo.expire_session(attrs.account_id, row.id)
          {:error, :agent_unavailable}
      end
    end
  end

  @doc false
  def start_link(init_args), do: GenServer.start_link(__MODULE__, init_args)

  @doc "Records the AI-processing consent of the session's User, `user_id`."
  @spec record_consent(GenServer.server(), Ecto.UUID.t()) :: :ok | {:error, :forbidden | term()}
  def record_consent(session, user_id), do: GenServer.call(session, {:record_consent, user_id})

  @doc """
  Sends a Member message and starts one agent turn. Refuses with
  `:consent_required` (no model call) until consent is recorded, and with
  `:busy` while a turn is running. A text over `max_message_bytes/0` is
  refused with `:message_too_long` and never stored.
  """
  @spec send_message(GenServer.server(), String.t()) ::
          :ok | {:error, :consent_required | :busy | :invalid_message | :message_too_long}
  def send_message(session, text), do: GenServer.call(session, {:send_message, text})

  @doc "The largest Member message, in bytes, a session accepts."
  @spec max_message_bytes() :: pos_integer()
  def max_message_bytes, do: @max_message_bytes

  @doc "The meal slots a session plans."
  @spec slots() :: [String.t()]
  def slots, do: @slots

  @doc """
  Halts the running turn of the session's Member `membership_id`. The
  session, its conversation and the Proposal on display stay.
  """
  @spec stop(GenServer.server(), Ecto.UUID.t()) :: :ok | {:error, :forbidden}
  def stop(session, membership_id), do: GenServer.call(session, {:stop, membership_id})

  @doc "Adds an event subscriber."
  @spec subscribe(GenServer.server(), pid()) :: :ok
  def subscribe(session, pid), do: GenServer.call(session, {:subscribe, pid})

  @doc """
  Cancels the session, discarding its workspace and releasing the range.
  Allowed for the session's Member and the Account owner.
  """
  @spec cancel(GenServer.server(), %{membership_id: Ecto.UUID.t(), owner?: boolean()}) ::
          :ok | {:error, :forbidden}
  def cancel(session, actor), do: GenServer.call(session, {:cancel, actor})

  @doc """
  The session Member's confirmation of the Proposal `proposal_id` in the
  Account `account_id`. Data are read again first: a Proposal that is no
  longer valid is refused and withdrawn, one whose content changed is shown
  again as a new Proposal. Idempotent: a confirmed Proposal answers its
  summary again, also after the session ended. Refuses with:

    * `:forbidden` — not the session's Member
    * `:busy` — the agent is working; the shown Proposal may be replaced
    * `:stale_proposal` — not the Proposal on display, or its content
      changed; the Member is shown the current one
    * `:approval_required` — the Proposal is over the budget (approvals
      arrive with #430)
    * `:proposal_invalid` — it is no longer valid; nothing was saved
    * `:scheduled_meal_cooked`, `:meal_already_confirmed` — a final meal
      holds one of its days and slots
    * `:no_active_session` — no session runs and the Proposal was never
      confirmed
    * `:unresolved` — the outcome is not known yet; ask
      `confirmation_status/2`
  """
  @spec confirm(Ecto.UUID.t(), Ecto.UUID.t(), String.t()) ::
          {:ok, Confirmation.summary()} | {:error, atom()}
  def confirm(account_id, membership_id, proposal_id) do
    case whereis(account_id) do
      nil ->
        replayed(account_id, proposal_id)

      pid ->
        try do
          GenServer.call(pid, {:confirm, membership_id, proposal_id}, @confirm_call_timeout)
        catch
          :exit, {:timeout, _} -> {:error, :unresolved}
          # The session ended meanwhile: the stored confirmation decides.
          :exit, _reason -> replayed(account_id, proposal_id)
        end
    end
  end

  @doc "The confirmation of `proposal_id` in the Account, or `:not_found`."
  @spec confirmation_status(Ecto.UUID.t(), String.t()) ::
          {:confirmed, Confirmation.summary()} | :not_found
  def confirmation_status(account_id, proposal_id),
    do: Confirmation.status(account_id, proposal_id)

  @doc "The session id, range and owning User and Membership of a running session."
  @spec info(GenServer.server()) :: map()
  def info(session), do: GenServer.call(session, :info)

  @doc "The running session process of an Account, or `nil`."
  @spec whereis(Ecto.UUID.t()) :: pid() | nil
  def whereis(account_id) do
    case Registry.lookup(@registry, {:account, account_id}) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end

  # ===========================================================================
  # GenServer
  # ===========================================================================

  @impl true
  def init(args) do
    # Trap exits so a supervisor or application shutdown runs terminate/2,
    # which releases the range lock instead of waiting for the lease to
    # lapse. Turns run under async_nolink, so no turn exit reaches here.
    Process.flag(:trap_exit, true)
    %{attrs: attrs} = args

    case Registry.register(@registry, {:account, attrs.account_id}, args.session_id) do
      {:ok, _owner} ->
        {:ok, initial_state(args)}

      {:error, {:already_registered, _pid}} ->
        _ = PlanningRepo.expire_session(attrs.account_id, args.session_id)
        :ignore
    end
  end

  defp initial_state(%{attrs: attrs} = args) do
    household = HouseholdContext.load(attrs.account_id, attrs.user_id)

    state = %{
      session_id: args.session_id,
      account_id: attrs.account_id,
      user_id: attrs.user_id,
      membership_id: attrs.membership_id,
      range: attrs.range,
      household: household,
      consent?: household.consent?,
      instructions: HouseholdContext.instructions(household, attrs.range, @slots),
      model: args.model,
      model_state: args.model_state,
      optimizer: args.optimizer,
      recipe_search: args.recipe_search,
      messages: [],
      workspace: %{draft: nil, proposal: nil},
      allowance: Allowance.new(args.max_iterations),
      subscribers: %{},
      task: nil,
      deadline_ref: nil,
      deadline_ms: args.deadline_ms,
      call_policies: args.call_policies
    }

    state = if args.subscriber, do: add_subscriber(state, args.subscriber), else: state
    schedule_lease_renewal()
    state
  end

  @impl true
  def handle_call({:record_consent, user_id}, _from, %{user_id: user_id} = state) do
    case Consent.record(user_id) do
      :ok -> {:reply, :ok, %{state | consent?: true}}
      error -> {:reply, error, state}
    end
  end

  def handle_call({:record_consent, _user_id}, _from, state),
    do: {:reply, {:error, :forbidden}, state}

  def handle_call({:send_message, text}, _from, state) do
    cond do
      not is_binary(text) or String.trim(text) == "" ->
        {:reply, {:error, :invalid_message}, state}

      byte_size(text) > @max_message_bytes ->
        {:reply, {:error, :message_too_long}, state}

      not state.consent? ->
        emit(state, consent_required())
        {:reply, {:error, :consent_required}, state}

      state.task != nil ->
        {:reply, {:error, :busy}, state}

      true ->
        state = %{
          state
          | messages: state.messages ++ [%{role: :user, content: text}],
            allowance: Allowance.start_message(state.allowance)
        }

        {:reply, :ok, start_turn(state)}
    end
  end

  def handle_call({:stop, membership_id}, _from, %{membership_id: membership_id} = state) do
    if state.task, do: emit(state, %{"type" => "stopped"})
    {:reply, :ok, stop_turn(state)}
  end

  def handle_call({:stop, _membership_id}, _from, state),
    do: {:reply, {:error, :forbidden}, state}

  def handle_call({:subscribe, pid}, _from, state), do: {:reply, :ok, add_subscriber(state, pid)}

  def handle_call(:info, _from, state) do
    {:reply,
     %{
       session_id: state.session_id,
       range: state.range,
       user_id: state.user_id,
       membership_id: state.membership_id
     }, state}
  end

  def handle_call({:cancel, %{membership_id: actor, owner?: owner?}}, _from, state) do
    if actor == state.membership_id or owner? == true do
      state = stop_turn(state)

      # When the store refuses the cancel, session_id is kept so terminate/2
      # falls back to expire_session and the range is not left locked until
      # the lease lapses.
      session_id =
        case PlanningRepo.cancel_session(state.account_id, state.session_id, actor, owner?) do
          {:ok, _} ->
            nil

          {:error, reason} ->
            Logger.warning("planning agent cancel: #{inspect(reason)}")
            state.session_id
        end

      emit(state, %{"type" => "session_cancelled"})
      {:stop, :normal, :ok, %{state | session_id: session_id}}
    else
      {:reply, {:error, :forbidden}, state}
    end
  end

  def handle_call({:confirm, membership_id, _proposal_id}, _from, state)
      when membership_id != state.membership_id,
      do: {:reply, {:error, :forbidden}, state}

  def handle_call({:confirm, _membership_id, proposal_id}, _from, state) do
    case Confirmation.status(state.account_id, proposal_id) do
      {:confirmed, summary} -> {:reply, {:ok, summary}, state}
      :not_found -> confirm_current(state, proposal_id)
    end
  end

  @impl true
  def handle_info({:agent_event, ref, event}, %{task: %Task{ref: ref}} = state) do
    emit(state, event)
    {:noreply, state}
  end

  # Events of a killed turn arrive late: they are discarded.
  def handle_info({:agent_event, _stale_ref, _event}, state), do: {:noreply, state}

  # Model state checkpoints carry paid usage (spend ledger), so the session
  # keeps it even when the turn is later killed or crashes.
  def handle_info({:model_state, ref, sealed}, %{task: %Task{ref: ref}} = state),
    do: {:noreply, %{state | model_state: sealed}}

  def handle_info({:model_state, _stale_ref, _model_state}, state), do: {:noreply, state}

  def handle_info({:allowance, ref, allowance}, %{task: %Task{ref: ref}} = state),
    do: {:noreply, %{state | allowance: allowance}}

  def handle_info({:allowance, _stale_ref, _allowance}, state), do: {:noreply, state}

  # The workspace after every tool call, so a stopped turn keeps a Proposal
  # it already presented.
  def handle_info({:workspace, ref, workspace}, %{task: %Task{ref: ref}} = state),
    do: {:noreply, %{state | workspace: workspace}}

  def handle_info({:workspace, _stale_ref, _workspace}, state), do: {:noreply, state}

  def handle_info({ref, result}, %{task: %Task{ref: ref}} = state) do
    Process.demonitor(ref, [:flush])

    state = %{
      clear_turn(state)
      | model_state: result.model_state,
        messages: result.messages,
        workspace: result.workspace,
        allowance: result.allowance
    }

    emit_outcome(state, result.outcome)
    {:noreply, state}
  end

  def handle_info({:deadline, ref}, %{task: %Task{ref: ref}} = state) do
    state = stop_turn(state)
    emit(state, %{"type" => "limit_reached", "limit" => "time"})
    {:noreply, state}
  end

  def handle_info({:deadline, _stale}, state), do: {:noreply, state}

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{task: %Task{ref: ref}} = state) do
    Logger.error("planning agent turn crashed: #{inspect(reason)}")
    state = clear_turn(state)
    emit(state, %{"type" => "agent_unavailable", "reason" => "internal_error"})
    {:noreply, state}
  end

  def handle_info({:DOWN, ref, :process, pid, _reason}, state) do
    case Map.pop(state.subscribers, pid) do
      # Absence grace belongs to #432: for now the session ends when its
      # last subscriber is gone.
      {^ref, subscribers} when map_size(subscribers) == 0 ->
        {:stop, :normal, %{state | subscribers: subscribers}}

      {_ref, subscribers} ->
        {:noreply, %{state | subscribers: subscribers}}
    end
  end

  def handle_info(:renew_lease, state) do
    case PlanningRepo.renew_session_lease(state.account_id, state.session_id, state.membership_id) do
      {:ok, _session} ->
        schedule_lease_renewal()
        {:noreply, state}

      # The row ended behind this session's back (the sweeper after the
      # 30-minute cap or a lapsed lease): the range may already belong to a
      # new session, so stop spending now. session_id is cleared so
      # terminate/2 does not end the row a second time.
      {:error, reason} ->
        Logger.warning("planning agent session lost its lease: #{inspect(reason)}")
        state = stop_turn(state)
        emit(state, %{"type" => "session_ended"})
        {:stop, :normal, %{state | session_id: nil}}
    end
  end

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    _ = stop_turn(state)

    if state.session_id do
      _ = PlanningRepo.expire_session(state.account_id, state.session_id)
      emit(state, %{"type" => "session_ended"})
    end

    :ok
  end

  # The conversation is reduced to its length and a Member message to a
  # marker wherever OTP prints this callback's result (`:sys.get_status/1`
  # and crash reports). The model state, which holds the provider API key,
  # is sealed instead (see `seal/1`).
  @impl true
  def format_status(status) do
    status
    |> Map.replace_lazy(:state, &redact_state/1)
    |> Map.replace_lazy(:message, &redact_message/1)
  end

  defp redact_state(%{messages: messages} = state),
    do: %{state | messages: {:redacted, length(messages)}}

  defp redact_state(state), do: state

  defp redact_message({:send_message, _text}), do: {:send_message, :redacted}
  defp redact_message(message), do: message

  # ===========================================================================
  # Confirmation
  # ===========================================================================

  defp confirm_current(%{task: %Task{}} = state, _proposal_id),
    do: {:reply, {:error, :busy}, state}

  defp confirm_current(%{workspace: %{proposal: %{"proposal_id" => id} = shown}} = state, id),
    do: commit(state, shown)

  # Not the Proposal on display: the Member is shown the current one again.
  defp confirm_current(state, _proposal_id) do
    if state.workspace.proposal, do: emit(state, state.workspace.proposal)
    {:reply, {:error, :stale_proposal}, state}
  end

  # Restrictions, recipes, costs and the budget are read again: changes by
  # other Members since the Proposal was shown are caught here.
  defp commit(state, shown) do
    household = HouseholdContext.load(state.account_id, state.user_id)
    state = %{state | household: household}
    ctx = %{account_id: state.account_id, range: state.range, slots: @slots, household: household}

    with {:valid, meals} <- ProposalValidator.validate(Proposal.meals(shown), ctx),
         current = Proposal.build(meals, ctx),
         true <- Proposal.same_content?(current, shown) || {:stale, current},
         :ok <- approved(shown) do
      save(state, shown)
    else
      {:invalid, violations} ->
        emit(state, %{
          "type" => "proposal_invalidated",
          "proposal_id" => shown["proposal_id"],
          "violations" => violations
        })

        {:reply, {:error, :proposal_invalid}, put_proposal(state, nil)}

      # The same meals are shown again, recalculated, as a new Proposal the
      # Member is asked to confirm.
      {:stale, current} ->
        emit(state, current)
        {:reply, {:error, :stale_proposal}, put_proposal(state, current)}

      {:error, :approval_required} = error ->
        {:reply, error, state}
    end
  end

  # A Proposal with a Deviation needs the Member's approval, which arrives
  # with #430; until then it cannot be confirmed.
  defp approved(%{"status" => "valid"}), do: :ok
  defp approved(_proposal), do: {:error, :approval_required}

  defp save(state, shown) do
    attrs = %{
      confirmation_id: shown["proposal_id"],
      account_id: state.account_id,
      session_id: state.session_id,
      membership_id: state.membership_id,
      range: state.range,
      meals: Proposal.meals(shown)
    }

    case Confirmation.commit(attrs) do
      {:ok, summary} ->
        confirmed(state, summary)

      # A concurrent replay stored it first.
      {:error, :already_confirmed} ->
        case Confirmation.status(state.account_id, shown["proposal_id"]) do
          {:confirmed, summary} -> confirmed(state, summary)
          :not_found -> {:reply, {:error, :rejected}, state}
        end

      # The row ended behind this session's back: nothing was saved and the
      # session cannot go on.
      {:error, :session_not_active} ->
        state = stop_turn(state)
        emit(state, %{"type" => "session_ended"})
        {:stop, :normal, {:error, :session_not_active}, %{state | session_id: nil}}

      {:error, :unresolved} ->
        emit(state, %{"type" => "confirmation_unresolved", "proposal_id" => shown["proposal_id"]})
        {:reply, {:error, :unresolved}, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  # The Planning session is committed with the confirmation: it ends without
  # expiring its row, and the range is free.
  defp confirmed(state, summary) do
    emit(state, %{
      "type" => "proposal_confirmed",
      "proposal_id" => summary.confirmation_id,
      "meals_count" => summary.meals_count
    })

    emit(state, %{"type" => "session_ended"})
    {:stop, :normal, {:ok, summary}, %{state | session_id: nil}}
  end

  defp replayed(account_id, proposal_id) do
    case Confirmation.status(account_id, proposal_id) do
      {:confirmed, summary} -> {:ok, summary}
      :not_found -> {:error, :no_active_session}
    end
  end

  defp put_proposal(state, proposal),
    do: %{state | workspace: %{state.workspace | proposal: proposal}}

  # ===========================================================================
  # Turn management
  # ===========================================================================

  defp start_turn(state) do
    session = self()
    holder = make_ref()
    deadline_at = System.monotonic_time(:millisecond) + state.deadline_ms

    turn = %{
      model: state.model,
      model_state: state.model_state,
      instructions: state.instructions,
      messages: state.messages,
      allowance: state.allowance,
      bounds: CallBounds.new(policies: state.call_policies, deadline_at: deadline_at),
      tool_context: %{
        account_id: state.account_id,
        session_id: state.session_id,
        range: state.range,
        slots: @slots,
        household: state.household,
        optimizer: state.optimizer,
        recipe_search: state.recipe_search,
        workspace: state.workspace
      }
    }

    task =
      Task.Supervisor.async_nolink(@task_supervisor, fn ->
        ref = receive(do: ({^holder, ref} -> ref))
        emit_fun = fn event -> send(session, {:agent_event, ref, event}) end

        tool_context =
          turn.tool_context |> Map.put(:emit, emit_fun) |> Map.put(:bounds, turn.bounds)

        result =
          %{turn | tool_context: tool_context, model_state: unseal(turn.model_state)}
          |> Map.put(:emit, emit_fun)
          |> Map.put(:checkpoint, fn model_state ->
            send(session, {:model_state, ref, seal(model_state)})
          end)
          |> Map.put(:report_allowance, &send(session, {:allowance, ref, &1}))
          |> Map.put(:on_workspace, &send(session, {:workspace, ref, &1}))
          |> Loop.run()

        %{result | model_state: seal(result.model_state)}
      end)

    send(task.pid, {holder, task.ref})
    deadline_ref = Process.send_after(self(), {:deadline, task.ref}, state.deadline_ms)
    %{state | task: task, deadline_ref: deadline_ref}
  end

  defp emit_outcome(state, :completed), do: emit(state, %{"type" => "turn_completed"})

  defp emit_outcome(state, {:limit_reached, limit}),
    do: emit(state, %{"type" => "limit_reached", "limit" => limit})

  defp emit_outcome(state, {:exhausted, limit}),
    do: emit(state, %{"type" => "limit_reached", "limit" => limit})

  defp emit_outcome(state, {:failed, reason}),
    do: emit(state, %{"type" => "agent_unavailable", "reason" => failure_reason(reason)})

  defp emit_outcome(state, _outcome), do: emit(state, %{"type" => "turn_completed"})

  # Only code-defined failure kinds reach the Member.
  defp failure_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp failure_reason(_reason), do: "internal_error"

  defp stop_turn(%{task: nil} = state), do: state

  defp stop_turn(%{task: task} = state) do
    _ = Task.shutdown(task, :brutal_kill)
    # The task is dead, so every message it sent is already queued: adopt
    # the latest model state, allowance and workspace, so the killed turn's
    # paid usage and counted calls stay counted and a presented Proposal
    # stays on display.
    clear_turn(%{
      state
      | model_state: latest(:model_state, task.ref, state.model_state),
        allowance: latest(:allowance, task.ref, state.allowance),
        workspace: latest(:workspace, task.ref, state.workspace)
    })
  end

  defp latest(tag, ref, value) do
    receive do
      {^tag, ^ref, newer} -> latest(tag, ref, newer)
    after
      0 -> value
    end
  end

  defp clear_turn(state) do
    if state.deadline_ref, do: Process.cancel_timer(state.deadline_ref)
    %{state | task: nil, deadline_ref: nil}
  end

  # ===========================================================================
  # Events
  # ===========================================================================

  @event_fields %{
    "progress" => ~w(step tool outcome),
    "assistant_message" => ~w(text),
    "question" => ~w(text),
    "proposal" => ~w(proposal_id status meals budget deviations),
    "optimizer_failed" => ~w(reason),
    "consent_required" => ~w(text text_version),
    "limit_reached" => ~w(limit),
    "agent_unavailable" => ~w(reason),
    "turn_completed" => [],
    "stopped" => [],
    "session_cancelled" => [],
    "session_ended" => [],
    "proposal_confirmed" => ~w(proposal_id meals_count),
    "proposal_invalidated" => ~w(proposal_id violations),
    "confirmation_unresolved" => ~w(proposal_id)
  }
  @meal_fields ~w(date slot recipe_id name estimated_cost_cents)

  @doc """
  The event allowlist: every event type a subscriber can receive, with the
  only fields it carries besides `type`. `docs/CHANNELS.md` documents
  exactly these.
  """
  @spec event_fields() :: %{String.t() => [String.t()]}
  def event_fields, do: @event_fields

  @doc "The fields of each meal of a Proposal."
  @spec meal_fields() :: [String.t()]
  def meal_fields, do: @meal_fields

  defp consent_required,
    do: %{
      "type" => "consent_required",
      "text" => Consent.text(),
      "text_version" => Consent.text_version()
    }

  defp emit(state, event) do
    case sanitize(event) do
      nil ->
        Logger.warning("planning agent dropped an event outside the allowlist")

      event ->
        Enum.each(Map.keys(state.subscribers), fn pid ->
          send(pid, {:planning_agent_event, state.session_id, event})
        end)
    end
  end

  # Streaming carries progress only: known event types with known fields.
  # Anything else, such as raw tool output or model reasoning, is dropped.
  defp sanitize(%{"type" => type} = event) when is_map_key(@event_fields, type) do
    event
    |> Map.take(["type" | Map.fetch!(@event_fields, type)])
    |> Map.replace_lazy("meals", fn meals ->
      Enum.map(List.wrap(meals), &Map.take(&1, @meal_fields))
    end)
  end

  defp sanitize(_event), do: nil

  # ===========================================================================
  # Helpers
  # ===========================================================================

  # The model state holds the provider API key. It travels and is stored
  # sealed in a closure, which inspects as `#Function<...>`, so status
  # output, crash reports and stacktrace arguments never print the key.
  # Only the turn process unseals it, right before calling the model.
  defp seal(model_state), do: fn -> model_state end
  defp unseal(sealed) when is_function(sealed, 0), do: sealed.()

  defp add_subscriber(state, pid) do
    if Map.has_key?(state.subscribers, pid) do
      state
    else
      %{state | subscribers: Map.put(state.subscribers, pid, Process.monitor(pid))}
    end
  end

  defp schedule_lease_renewal, do: Process.send_after(self(), :renew_lease, @lease_renew_ms)

  defp check_eligible(account_id) do
    if AccountAccess.eligible?(account_id), do: :ok, else: {:error, :subscription_required}
  end

  defp validate_range(account_id, {%Date{} = from_date, %Date{} = to_date}) do
    days = Date.diff(to_date, from_date) + 1
    max_days = config(:max_range_days) || @default_max_range_days

    if days >= 1 and days <= max_days and
         Date.compare(from_date, AccountClock.today(account_id)) != :lt,
       do: {:ok, {from_date, to_date}},
       else: {:error, :invalid_range}
  end

  defp validate_range(_account_id, _range), do: {:error, :invalid_range}

  # The agent never plans over a Scheduled meal.
  defp ensure_unplanned(account_id, from_date, to_date) do
    case PlanningRepo.occupied_slots(account_id, from_date, to_date, @slots) do
      [] -> :ok
      occupied -> {:error, {:slot_occupied, occupied}}
    end
  end

  defp ensure_none_running(account_id) do
    if whereis(account_id), do: {:error, :session_already_active}, else: :ok
  end

  # A paid adapter refuses without its caps, prices or API key: the agent is
  # then unavailable. The reason is logged, never shown.
  defp init_model(model, model_opts) do
    case model.init(model_opts) do
      {:ok, model_state} ->
        {:ok, model_state}

      {:error, reason} ->
        Logger.error("planning agent model unavailable: #{inspect(reason)}")
        {:error, :agent_unavailable}
    end
  end

  defp lock(attrs, from_date, to_date) do
    PlanningRepo.create_session(attrs.account_id, %{
      range_from: from_date,
      range_to: to_date,
      lock_owner_user_id: attrs.user_id,
      lock_owner_membership_id: attrs.membership_id,
      lease_expires_at: DateTime.add(DateTime.utc_now(), @lease_seconds, :second),
      agent: true
    })
    |> case do
      {:ok, row} -> {:ok, row}
      {:error, :overlapping_range} -> {:error, :overlapping_range}
      {:error, _other} -> {:error, :agent_unavailable}
    end
  end

  defp config(key) do
    :meal_planner_api
    |> Application.get_env(:planning_agent, [])
    |> Keyword.get(key)
  end
end
