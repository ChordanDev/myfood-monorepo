defmodule MealPlannerApiWeb.PlanningChannel do
  @moduledoc """
  Phoenix Channel para el flujo de planificación v2 con streaming via Phoenix Channels.

  El canal delega la lógica pesada a `GenerationServer` (un GenServer por account_id).
  `GenerationServer` hace broadcast directo al `channel_pid` del socket.

  Eventos entrantes del cliente:
  - `generate_menu` — inicia generación de menú (usa GenerationServer)
  - `start_planning` — abre la sesión de planificación del rango y arranca su primera generación (issue #25)
  - `chat` — mensaje de modificación del usuario (usa GenerationServer)
  - `confirm_proposal` — confirma propuesta (canal atómico, PlanningSession-lock + Repo.transaction/1; sin fallback HTTP)
  - `reject_proposal` — rechaza propuesta (usa PlanningChatService, backward compat)

  Eventos salientes (broadcast):
  - `generation_started` — generación iniciada
  - `proposal_ready` — propuesta disponible
  - `proposal_confirmed` — propuesta confirmada
  - `proposal_rejected` — propuesta rechazada
  - `generation_error` — error durante generación
  - `proposal_update` — propuesta actualizada tras modificación de usuario

  ## Casing

  The channel speaks camelCase with its clients, in both directions
  (issue #11), through `MealPlannerApiWeb.Casing`:

    * Inbound: the payload of every command is normalized to snake_case
      before a command clause sees it, so `%{"rangeFrom" => "2026-04-01"}`
      and `%{"range_from" => "2026-04-01"}` are the same command.
    * Replies: the payload of every ok reply and of every error reply has
      camelCase keys.
    * Events: every event delivered on `planning:<account_id>` is
      intercepted and pushed with camelCase keys by `handle_out/3`, whoever
      broadcast it. `outbound_events/0` is the list; an event that is not in
      it reaches the client as it was broadcast.

  Only keys are rewritten: event names and values stay as they are, the
  `reason` of a `generation_error` event included.

  ## Error replies

  A failed join or command replies the mobile error envelope of
  `MealPlannerApiWeb.ApiError` (issue #11), next to `requestId` when the
  command correlates its reply:

      %{"error" => %{"code" => :overlapping_range, "message" => "..."}}

  The code is always in the `ApiError` allowlist; a reason outside it
  replies `unknown_error`. Events such as `generation_error` are not replies
  and keep their `reason` field.

  A command whose payload is not a map replies `invalid_payload`, whatever
  the event.

  ## Join refusals

  A refused join replies one of three codes (issue #24), checked in this
  order:

    * `unauthenticated`: the socket carries no identity, or its access token
      has expired since the socket connected. The client refreshes the token
      and reconnects.
    * `forbidden`: no Membership resolves for the socket, the Membership
      belongs to another Account than the topic, or it is not active.
    * `trial_expired`: capability enforcement is on and the Account is not
      eligible, the code the HTTP capability plug replies for the same rule.
  """
  use MealPlannerApiWeb, :channel

  require Logger

  alias MealPlannerApi.AccountAccess
  alias MealPlannerApi.Generation.{PlanningSessionServer, PlanningSessionSupervisor, Server}
  alias MealPlannerApi.Planning.LockOwner
  alias MealPlannerApi.Services.PlanningChatService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Casing
  alias MealPlannerApiWeb.ChannelCapability
  alias MealPlannerApiWeb.Channels.IntentAtomizer
  alias MealPlannerApiWeb.Plugs.LoadCurrentMembershipSocket

  # The `ApiError` allowlist by reason name, so a reason a service returned as
  # a string finds its code without creating an atom.
  @codes_by_reason Map.new(ApiError.codes(), &{Atom.to_string(&1), &1})

  # Every event delivered on `planning:<account_id>`. The topic has five
  # broadcasters: this channel, `Generation.Server`, `PlanningSessionServer`,
  # the planning session sweeper and `AIChannel`. An event reaches the client
  # in camelCase only when it is listed here, so a module that starts
  # broadcasting a new event on the topic has to add it; a test compares the
  # list with the events those modules name.
  @outbound_events ~w(
    generation_started
    generation_error
    proposal_ready
    proposal_confirmed
    proposal_rejected
    proposal_update
    session_started
    session_resumed
    session_cancelled
    session_committed
    session_lost_lock
    session_expired
    send_intent
  )

  intercept @outbound_events

  @doc """
  The events delivered on `planning:<account_id>`, each of them pushed to the
  client with camelCase keys by `handle_out/3`.
  """
  @spec outbound_events() :: [String.t()]
  def outbound_events, do: @outbound_events

  # Issue #24 — a refused join replies one of three codes, checked in this
  # order: `unauthenticated`, `forbidden`, `trial_expired`. See "Join
  # refusals" in the moduledoc.
  @impl true
  def join("planning:" <> topic_account_id, _payload, socket) do
    with :ok <- check_authenticated(socket),
         {:ok, membership} <- fetch_active_membership(socket, topic_account_id),
         :ok <- check_join_capability(membership) do
      {:ok,
       socket
       |> assign(:account_id, topic_account_id)
       |> assign(:current_membership, membership)}
    else
      {:error, code} -> {:error, error_payload(code)}
    end
  end

  # `UserSocket.connect/3` verifies the token once and the socket can stay
  # open past the expiry of that token, so the join checks the expiry again.
  # A socket that carries no user or no claims is refused the same way.
  defp check_authenticated(socket) do
    case socket.assigns do
      %{current_user: user, claims: %{} = claims} when not is_nil(user) ->
        if token_expired?(claims), do: {:error, :unauthenticated}, else: :ok

      _no_identity ->
        {:error, :unauthenticated}
    end
  end

  # A token without an integer `exp` claim has no expiry to compare and is
  # not treated as expired.
  defp token_expired?(%{"exp" => exp}) when is_integer(exp),
    do: exp <= System.system_time(:second)

  defp token_expired?(_claims), do: false

  defp fetch_active_membership(socket, topic_account_id) do
    membership = LoadCurrentMembershipSocket.membership_from_socket(socket)

    cond do
      is_nil(membership) -> {:error, :forbidden}
      to_string(membership.account_id) != topic_account_id -> {:error, :forbidden}
      membership.status != :active -> {:error, :forbidden}
      true -> {:ok, membership}
    end
  end

  # `ChannelCapability` is shared with channels that still reply
  # `subscription_required`. The planning join names the denial as the HTTP
  # capability plug does for the same rule.
  defp check_join_capability(membership) do
    case ChannelCapability.authorize(membership) do
      :ok -> :ok
      {:error, :subscription_required} -> {:error, :trial_expired}
    end
  end

  # Issue #11 — the single entry of every command: the payload is normalized
  # to snake_case before a command clause reads it (`send_message` atomizes
  # its intent, so this has to come first), and the payload of an ok reply
  # leaves in camelCase. Error replies are already camelCase, see
  # `error_payload/1`.
  @impl true
  def handle_in(event, payload, socket) when is_map(payload) do
    event
    |> handle_command(Casing.snake_keys(payload), socket)
    |> camelize_ok_reply()
  end

  # A payload that is not a map has no keys for a command to read: it replies
  # `invalid_payload` here, whatever the event, before a command clause sees
  # it or looks at the state of the socket.
  def handle_in(_event, _payload, socket) do
    {:reply, {:error, error_payload(:invalid_payload)}, socket}
  end

  # Issue #11 — every event of `@outbound_events` goes through here on its
  # way to the client, whichever module broadcast it.
  @impl true
  def handle_out(event, payload, socket) do
    push(socket, event, Casing.camelize_keys(payload))
    {:noreply, socket}
  end

  defp handle_command("generate_menu", payload, socket) do
    user = socket.assigns.current_user
    membership = socket.assigns.current_membership
    request_id = Map.get(payload, "request_id", build_request_id())

    result =
      with {:ok, constraints} <- generation_constraints(payload) do
        Server.start_generation(membership.account_id, user.id, constraints, socket.channel_pid)
      end

    case result do
      {:ok, run_id} ->
        broadcast!(socket, "generation_started", %{request_id: request_id, run_id: run_id})
        {:reply, {:ok, %{request_id: request_id, run_id: run_id}}, socket}

      {:error, :already_running} ->
        {:reply, {:error, error_payload(:generation_in_progress, request_id)}, socket}

      {:error, reason} ->
        # The `generation_error` event is not a command reply: it keeps its
        # `reason` field instead of the error envelope. Its keys are still
        # camelized on the way out by `handle_out/3` (`requestId`).
        event = %{request_id: request_id, reason: serialize_reason(reason)}
        broadcast!(socket, "generation_error", event)
        {:reply, {:error, error_payload(reason, request_id)}, socket}
    end
  end

  defp handle_command("swap_constraints", payload, socket) do
    user = socket.assigns.current_user
    request_id = Map.get(payload, "request_id", build_request_id())
    base_payload = Map.get(payload, "base_payload", %{})
    constraints = Map.get(payload, "constraints", %{})

    broadcast!(socket, "generation_started", %{
      request_id: request_id,
      reason: "constraint_update"
    })

    case PlanningChatService.regenerate_menu(user, base_payload, constraints) do
      {:ok, result} ->
        event = %{
          request_id: request_id,
          run_id: result.run.id,
          proposal_id: result.proposal.id,
          date_from: Date.to_iso8601(result.date_from),
          date_to: Date.to_iso8601(result.date_to),
          proposal: result.proposal_json,
          applied_constraints: constraints
        }

        broadcast!(socket, "proposal_ready", event)
        {:reply, {:ok, event}, socket}

      {:error, reason} ->
        event = %{request_id: request_id, reason: serialize_reason(reason)}
        broadcast!(socket, "generation_error", event)
        {:reply, {:error, error_payload(reason, request_id)}, socket}
    end
  end

  defp handle_command("chat", %{"message" => message, "proposal_id" => proposal_id}, socket) do
    membership = socket.assigns.current_membership

    # Obtener el PID del GenerationServer para este account
    case Registry.lookup(
           MealPlannerApi.Generation.Generations,
           {:generation, membership.account_id}
         ) do
      [{server_pid, _}] ->
        Server.chat(server_pid, proposal_id, message)
        {:noreply, socket}

      [] ->
        {:reply, {:error, error_payload(:no_active_generation)}, socket}
    end
  end

  defp handle_command("confirm_proposal", payload, socket) do
    # PR2 of issue #35 — `session_id` is required and forwarded into
    # `Server.do_confirm/3`. The session row IS the confirmation lock —
    # no lock, no confirm. Missing or invalid payload returns
    # `:missing_session_id` BEFORE any DB or GenerationServer lookup.
    user = socket.assigns.current_user
    membership = socket.assigns.current_membership

    with {:ok, proposal_id} <- require_proposal_id(Map.get(payload, "proposal_id")),
         {:ok, session_id} <- require_session_id(Map.get(payload, "session_id")),
         :ok <- check_handler_entitlement(membership.account_id) do
      confirm_with_lock(user, membership, proposal_id, session_id, socket)
    else
      {:error, :missing_session_id} ->
        {:reply, {:error, error_payload(:missing_session_id)}, socket}

      {:error, :account_expired} ->
        {:reply, {:error, error_payload(:account_expired)}, socket}

      {:error, :invalid_proposal_id} ->
        {:reply, {:error, error_payload(:invalid_proposal_id)}, socket}
    end
  end

  defp handle_command("reject_proposal", %{"proposal_id" => proposal_id}, socket) do
    user = socket.assigns.current_user
    membership = socket.assigns.current_membership

    case Registry.lookup(
           MealPlannerApi.Generation.Generations,
           {:generation, membership.account_id}
         ) do
      [{server_pid, _}] ->
        Server.reject(server_pid, proposal_id)
        {:noreply, socket}

      [] ->
        # Fallback: usar PlanningChatService (REST API backward compat)
        # Catch exceptions from service to return graceful errors
        try do
          case PlanningChatService.reject_proposal(user, proposal_id) do
            {:ok, result} ->
              event = Map.put(result, :status, "rejected")
              broadcast!(socket, "proposal_rejected", event)
              {:reply, {:ok, event}, socket}

            {:error, reason} ->
              {:reply, {:error, error_payload(reason)}, socket}
          end
        rescue
          Ecto.NoResultsError ->
            {:reply, {:error, error_payload(:not_found)}, socket}

          Ecto.Query.CastError ->
            {:reply, {:error, error_payload(:invalid_proposal_id)}, socket}
        end
    end
  end

  defp handle_command("start_planning", payload, socket) do
    # Phase 5 PR5 — capability re-check fires here too, not only at
    # join/3. If the Account's trial/entitlement expired mid-session,
    # refuse the start with `:subscription_required`. The join-time
    # guard would have already admitted the socket; this handler
    # enforces the same rule on every new planning attempt.
    #
    # Session-server ownership: the `PlanningSessionServer` is owned
    # by `PlanningSessionSupervisor` (not the channel process). The
    # server `Process.monitor`s this channel pid; on abnormal exit
    # the row transitions to `:lost_lock` and `session_lost_lock` is
    # broadcast. On normal disconnect (or graceful supervisor
    # shutdown) the server stays alive (TM-3). On the server's own
    # crash the `:transient` strategy restarts it, `init/1` rehydrates
    # from the DB row, and `session_resumed` is broadcast (TM-2).
    membership = socket.assigns.current_membership
    user = socket.assigns.current_user
    account_id = membership.account_id

    request_id = Map.get(payload, "request_id", build_request_id())

    with {:ok, {date_from, date_to} = range} <- parse_range(payload),
         {:ok, request_text} <- parse_request_text(payload),
         :ok <- check_account_eligible(account_id),
         {:ok, %{session_id: started_id, pid: pid}} <-
           start_session(account_id, user.id, membership.id, range, socket.channel_pid) do
      # `session_started` is broadcast by PlanningSessionServer
      # itself on `planning:<account_id>`. The socket (and any
      # other joined member) receives it as a pubsub broadcast.
      # Do NOT re-broadcast here or the event fires twice.
      #
      # The generation starts through the same public call `generate_menu`
      # uses, with the range of the session and the free text of the member
      # as the request. A generation that cannot start leaves no session
      # behind: the session is cancelled, so the member can start again.
      constraints = start_constraints(date_from, date_to, request_text)

      case start_generation(account_id, user.id, constraints, socket.channel_pid) do
        {:ok, run_id} ->
          # Cache the pid on the socket assigns so `send_message`
          # (PR4 task 4.8) can route intents back to the same server
          # without a Registry lookup.
          socket =
            socket
            |> assign(:session_id, started_id)
            |> assign(:session_pid, pid)

          broadcast!(socket, "generation_started", %{
            request_id: request_id,
            run_id: run_id,
            session_id: started_id
          })

          {:reply, {:ok, %{session_id: started_id, status: :active}}, socket}

        {:error, :already_running} ->
          # As `generate_menu` does: the run in flight is not ours, so the
          # topic is not told of a failure, only this caller is refused.
          cancel_unstarted_session(membership, started_id, pid)
          {:reply, {:error, error_payload(:generation_in_progress, request_id)}, socket}

        {:error, reason} ->
          cancel_unstarted_session(membership, started_id, pid)
          event = %{request_id: request_id, reason: serialize_reason(reason)}
          broadcast!(socket, "generation_error", event)
          {:reply, {:error, error_payload(reason, request_id)}, socket}
      end
    else
      {:error, :subscription_required} ->
        {:reply, {:error, error_payload(:subscription_required)}, socket}

      {:error, :planning_invalid_range} ->
        {:reply, {:error, error_payload(:planning_invalid_range)}, socket}

      {:error, {:range_locked, range}} ->
        details = range_lock_details(account_id, range, membership.id)
        {:reply, {:error, error_payload(:planning_range_locked, %{}, details)}, socket}

      {:error, reason} ->
        {:reply, {:error, error_payload(reason)}, socket}
    end
  end

  defp handle_command("send_message", payload, socket) do
    # Phase 4 PR4 task 4.8 — channel-layer intake for validated AI
    # intents. The `send_intent` broadcast from `AIChannel.new_message`
    # (task 4.6) is the public notification; THIS handler is the
    # single choke point where the intent is actually applied to the
    # session via `PlanningSessionServer.apply_intent/3`, which runs
    # `validate_ai_intent/1` and returns `{:error, :forbidden_intent}`
    # or `{:error, :unknown_intent}` on rejection.
    #
    # Authorization: the socket must have started a session
    # (`session_pid` cached on the assigns by `start_planning`). A
    # peer who joined but did not start a session gets
    # `:no_active_session`. The `session_id` payload MUST match the
    # cached id — we do NOT apply intents to a different session just
    # because the caller passed a valid UUID.
    case socket.assigns[:session_pid] do
      nil ->
        {:reply, {:error, error_payload(:no_active_session)}, socket}

      session_pid ->
        with {:ok, session_id} <- require_uuid(Map.get(payload, "session_id")),
             {:ok, intent_atom} <- IntentAtomizer.atomize(Map.get(payload, "intent")),
             :ok <- ensure_session_match(session_id, socket.assigns[:session_id]),
             {:ok, validated} <-
               PlanningSessionServer.apply_intent(session_pid, session_id, intent_atom) do
          {:reply, {:ok, validated}, socket}
        else
          {:error, :forbidden_intent} ->
            {:reply, {:error, error_payload(:forbidden_intent)}, socket}

          {:error, :unknown_intent} ->
            {:reply, {:error, error_payload(:unknown_intent)}, socket}

          {:error, :invalid_payload} ->
            {:reply, {:error, error_payload(:invalid_payload)}, socket}

          {:error, :session_mismatch} ->
            {:reply, {:error, error_payload(:session_mismatch)}, socket}

          {:error, :invalid_session_id} ->
            {:reply, {:error, error_payload(:invalid_payload)}, socket}

          # `IntentAtomizer.atomize/1` rejects an intent with a bare `:error`.
          :error ->
            {:reply, {:error, error_payload(:invalid_payload)}, socket}
        end
    end
  end

  defp handle_command("cancel_planning", payload, socket) do
    # Phase 4 PR4 task 4.4 — owner-scoped cancel.
    #
    # Authorization: the actor must either own the session (matching
    # `lock_owner_membership_id`) OR be the Account's `:owner` role.
    # Anything else (a peer who is not the account owner) gets
    # `:forbidden`. The PR2 `PlanningRepo.cancel_session/4` runs the
    # authorization + status check + child-delete in a single
    # transaction; we just route the call and broadcast the lifecycle
    # event on success.
    membership = socket.assigns.current_membership
    account_id = membership.account_id
    actor_membership_id = membership.id
    account_owner? = membership.role == :owner

    with {:ok, session_id} <- require_uuid(Map.get(payload, "session_id")),
         {:ok, _cancelled} <-
           MealPlannerApi.Data.PlanningRepo.cancel_session(
             account_id,
             session_id,
             actor_membership_id,
             account_owner?
           ) do
      broadcast_session_cancelled(account_id, session_id)

      {:reply, {:ok, %{session_id: session_id, status: :cancelled}}, socket}
    else
      {:error, :forbidden} ->
        {:reply, {:error, error_payload(:forbidden)}, socket}

      {:error, :not_active} ->
        {:reply, {:error, error_payload(:not_found)}, socket}

      {:error, :invalid_session_id} ->
        {:reply, {:error, error_payload(:invalid_payload)}, socket}
    end
  end

  defp handle_command(_event, _payload, socket) do
    {:reply, {:error, error_payload(:invalid_payload)}, socket}
  end

  # The constraints of `generate_menu` come nested under `constraints` and
  # flat in the payload (date_from, date_to, budget_cents, etc.), a flat key
  # winning over a nested one. A `constraints` that is not a map cannot be
  # merged and fails the command as `invalid_payload`.
  defp generation_constraints(payload) do
    case Map.get(payload, "constraints", %{}) do
      nested when is_map(nested) -> {:ok, Map.merge(nested, payload)}
      _not_a_map -> {:error, :invalid_payload}
    end
  end

  defp camelize_ok_reply({:reply, {:ok, payload}, socket}),
    do: {:reply, {:ok, Casing.camelize_keys(payload)}, socket}

  defp camelize_ok_reply(result), do: result

  defp build_request_id do
    "req_" <> Integer.to_string(System.unique_integer([:positive, :monotonic]))
  end

  # Issue #11 — the payload of every error reply, joins and commands alike:
  # the `ApiError` envelope `%{error: %{code: code, message: message}}` for
  # the reason a guard or a service returned, with camelCase keys.
  defp error_payload(reason), do: build_error_payload(reason, %{})

  # A command that correlates its reply keeps `request_id` next to `error`
  # (`requestId` on the wire).
  defp error_payload(reason, request_id),
    do: build_error_payload(reason, %{request_id: request_id})

  # `details` ride inside `error`, next to `code` and `message`, when the
  # reason is worth more than its message (`planning_range_locked` names the
  # member who holds the range).
  defp error_payload(reason, correlation, details) do
    build_error_payload(reason, correlation, details)
  end

  defp build_error_payload(reason, correlation, details \\ %{}) do
    reason |> error_envelope(details) |> Map.merge(correlation) |> Casing.camelize_keys()
  end

  # A reason outside the allowlist replies `unknown_error` and is logged, so
  # nothing free-form reaches the client.
  defp error_envelope(reason, details) do
    case error_code(reason) do
      {:ok, code} ->
        ApiError.envelope(code, details)

      :error ->
        Logger.warning(
          "PlanningChannel replied unknown_error for a reason outside the allowlist: " <>
            inspect(reason, limit: 50, printable_limit: 500)
        )

        ApiError.unknown_error_envelope()
    end
  end

  # A reason is an atom or a string, depending on the service it comes from,
  # and is looked up by name. A changeset means the payload did not pass a
  # validation and keeps the `invalid_payload` it has always been replied as;
  # its details stay on the server. Any other term is a fault, not a reason.
  #
  # `:invalid_format` is what `Date.from_iso8601/1` answers for a string that
  # is not a date, and `PlanningChatService` hands it through for a date the
  # client sent (`swap_constraints`). It is a mistake of the client, like an
  # impossible date, so it replies `invalid_date` instead of being logged as
  # a fault of the server.
  defp error_code(:invalid_format), do: {:ok, :invalid_date}

  defp error_code(reason) when is_atom(reason),
    do: Map.fetch(@codes_by_reason, Atom.to_string(reason))

  defp error_code(reason) when is_binary(reason), do: Map.fetch(@codes_by_reason, reason)
  defp error_code(%Ecto.Changeset{}), do: {:ok, :invalid_payload}
  defp error_code(_fault), do: :error

  # The `reason` field of a `generation_error` event. It is not the code of
  # the reply to the same command, and the two can differ:
  #
  #   * the event forwards the raw reason a service returned, as a string and
  #     without consulting the `ApiError` allowlist, and falls back to
  #     `"invalid_payload"` for a term that is neither an atom nor a string;
  #   * the reply names an allowlisted code (`error_code/1`) and falls back
  #     to `unknown_error`.
  #
  # A malformed date, for instance, is `"invalid_format"` in the event and
  # `invalid_date` in the reply.
  defp serialize_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp serialize_reason(reason) when is_binary(reason), do: reason
  defp serialize_reason(_), do: "invalid_payload"

  # Phase 4 PR4 — capability re-check on `start_planning`. Returns
  # `:ok` when the Account is eligible, `{:error, :subscription_required}`
  # otherwise. Mirrors the join-time `ChannelCapability.authorize/1`
  # pattern but with no rollout flag — the channel-layer start guard
  # ALWAYS re-checks, regardless of `:revenuecat_access_enforcement`.
  defp check_account_eligible(account_id) do
    if AccountAccess.eligible?(account_id) do
      :ok
    else
      {:error, :subscription_required}
    end
  end

  # The most days a Planning session covers, and how far in the past its
  # first day may be. The Planner sends the day the member sees as today; a
  # member east of UTC sees a date that is still yesterday in UTC, so one day
  # back is accepted.
  @max_planning_days 7
  @max_days_in_past 1

  # The longest free text a member may type with the request.
  @max_request_chars 1_000

  # The range of a `start_planning` payload: `range_from` is an ISO 8601 date
  # that is today or later, and the range ends with `range_to` or lasts
  # `day_count` days (when both are sent they must agree). It covers 1 to
  # `@max_planning_days` days. Anything else is `:planning_invalid_range`.
  defp parse_range(payload) do
    with {:ok, date_from} <- parse_iso_date(Map.get(payload, "range_from")),
         {:ok, date_to} <- range_end(date_from, payload),
         :ok <- check_range_length(date_from, date_to),
         :ok <- check_not_in_the_past(date_from) do
      {:ok, {date_from, date_to}}
    end
  end

  # A key sent as `null` is as absent as one not sent.
  defp range_end(date_from, payload) do
    case {Map.get(payload, "range_to"), Map.get(payload, "day_count")} do
      {nil, nil} ->
        invalid_range()

      {nil, count} ->
        case day_count_end(date_from, count) do
          %Date{} = date_to -> {:ok, date_to}
          nil -> invalid_range()
        end

      {range_to, nil} ->
        parse_iso_date(range_to)

      {range_to, count} ->
        with {:ok, date_to} <- parse_iso_date(range_to) do
          if date_to == day_count_end(date_from, count), do: {:ok, date_to}, else: invalid_range()
        end
    end
  end

  defp day_count_end(date_from, count) when is_integer(count) and count >= 1,
    do: Date.add(date_from, count - 1)

  defp day_count_end(_date_from, _count), do: nil

  defp check_range_length(date_from, date_to) do
    days = Date.diff(date_to, date_from) + 1
    if days in 1..@max_planning_days, do: :ok, else: invalid_range()
  end

  defp check_not_in_the_past(date_from) do
    earliest = Date.add(Date.utc_today(), -@max_days_in_past)
    if Date.compare(date_from, earliest) == :lt, do: invalid_range(), else: :ok
  end

  defp invalid_range, do: {:error, :planning_invalid_range}

  defp parse_iso_date(string) when is_binary(string) do
    case Date.from_iso8601(string) do
      {:ok, date} -> {:ok, date}
      _ -> invalid_range()
    end
  end

  defp parse_iso_date(_), do: invalid_range()

  # The free text of the request is optional. Surrounding whitespace is not
  # part of it and a blank text is no text; anything but a string, or a
  # string over `@max_request_chars`, is `:invalid_payload`.
  defp parse_request_text(payload) do
    case Map.get(payload, "request") do
      nil ->
        {:ok, nil}

      text when is_binary(text) ->
        case String.trim(text) do
          "" ->
            {:ok, nil}

          trimmed ->
            if String.length(trimmed) > @max_request_chars,
              do: {:error, :invalid_payload},
              else: {:ok, trimmed}
        end

      _not_text ->
        {:error, :invalid_payload}
    end
  end

  # What `Server.start_generation/4` is given: the dates of the session and,
  # when the member typed one, the free text under `"request"`.
  defp start_constraints(date_from, date_to, request_text) do
    base = %{
      "date_from" => Date.to_iso8601(date_from),
      "date_to" => Date.to_iso8601(date_to)
    }

    if request_text, do: Map.put(base, "request", request_text), else: base
  end

  defp start_session(account_id, user_id, membership_id, range, channel_pid) do
    case PlanningSessionSupervisor.start_session(
           account_id,
           user_id,
           membership_id,
           range,
           channel_pid: channel_pid
         ) do
      {:error, :overlapping_range} -> {:error, {:range_locked, range}}
      other -> other
    end
  end

  # `Server.start_generation/4` is a blocking call into the engine process of
  # the Account, which another member's pipeline can keep busy for longer
  # than the call timeout. An exit of that call (timeout, process gone) is
  # an error like any other, never a crash of the channel.
  defp start_generation(account_id, user_id, constraints, channel_pid) do
    Server.start_generation(account_id, user_id, constraints, channel_pid)
  catch
    :exit, _reason -> {:error, :generation_in_progress}
  end

  # A session whose generation did not start is cancelled, as its owner
  # would: the lock is released, the topic hears `session_cancelled` and the
  # session process is stopped so nothing keeps the row's account busy.
  defp cancel_unstarted_session(membership, session_id, session_pid) do
    _ =
      MealPlannerApi.Data.PlanningRepo.cancel_session(
        membership.account_id,
        session_id,
        membership.id,
        membership.role == :owner
      )

    _ = DynamicSupervisor.terminate_child(PlanningSessionSupervisor, session_pid)
    broadcast_session_cancelled(membership.account_id, session_id)
  end

  # The details of `planning_range_locked`: the display name of the member
  # who holds the range, only when it is not the caller.
  defp range_lock_details(account_id, range, caller_membership_id) do
    case LockOwner.owner_name(account_id, range, caller_membership_id) do
      {:ok, name} -> %{owner_name: name}
      :none -> %{}
    end
  end

  # Phase 4 PR4 task 4.4 — Validates `session_id` is a UUID string and
  # returns it. Anything else falls back to `{:error, :invalid_session_id}`
  # so the caller can surface a `:invalid_payload` error.
  defp require_uuid(value) when is_binary(value) do
    case Ecto.UUID.cast(value) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :invalid_session_id}
    end
  end

  defp require_uuid(_), do: {:error, :invalid_session_id}

  # PR2 of issue #35 — `confirm_proposal` payload guards. Both
  # `proposal_id` and `session_id` are required UUIDs; absent or
  # malformed values map to a single transport reason so the client
  # gets a deterministic response.
  defp require_proposal_id(value) when is_binary(value) do
    case Ecto.UUID.cast(value) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :invalid_proposal_id}
    end
  end

  defp require_proposal_id(_), do: {:error, :invalid_proposal_id}

  defp require_session_id(value) when is_binary(value) do
    case Ecto.UUID.cast(value) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :missing_session_id}
    end
  end

  defp require_session_id(_), do: {:error, :missing_session_id}

  # Phase 4 PR4 task 4.8 — the caller's `session_id` MUST equal the
  # session cached on the socket assigns. Prevents a caller from
  # applying intents to a session they did not start on this socket.
  defp ensure_session_match(caller_session_id, cached_session_id)
       when caller_session_id == cached_session_id,
       do: :ok

  defp ensure_session_match(_caller, _cached), do: {:error, :session_mismatch}

  defp broadcast_session_cancelled(account_id, session_id) do
    Phoenix.Channel.Server.broadcast!(
      MealPlannerApi.PubSub,
      "planning:#{account_id}",
      "session_cancelled",
      %{"session_id" => session_id}
    )
  end

  # PR2 of issue #35 — AC #1 proof: when
  # `:revenuecat_access_enforcement` is enabled, the per-handler re-check
  # refuses an expired Account's `confirm_proposal` with `:account_expired`
  # BEFORE `Server.do_confirm/3` is invoked. Mirrors the join-time
  # `ChannelCapability.authorize/1` gate.
  defp check_handler_entitlement(account_id) do
    cond do
      not ChannelCapability.enforcement_enabled?() -> :ok
      AccountAccess.eligible?(account_id) -> :ok
      true -> {:error, :account_expired}
    end
  end

  defp confirm_with_lock(_user, membership, proposal_id, session_id, socket) do
    case Registry.lookup(
           MealPlannerApi.Generation.Generations,
           {:generation, membership.account_id}
         ) do
      [{server_pid, _}] ->
        case Server.confirm(server_pid, proposal_id, session_id) do
          {:ok, result} -> {:reply, {:ok, result}, socket}
          {:error, reason} -> {:reply, {:error, error_payload(reason)}, socket}
        end

      [] ->
        # No GenerationServer registered — the legacy HTTP
        # `PlanningChatService.confirm_proposal/2` bypass path is
        # RETIRED in PR3. The channel is now the SOLE atomic
        # confirmation path; if no GenerationServer is alive (no
        # `generate_menu` / `start_planning` is in flight), reply
        # `:no_active_generation` so the client can recover by
        # starting a new session instead of silently losing the
        # AC #4 atomicity guarantee.
        {:reply, {:error, error_payload(:no_active_generation)}, socket}
    end
  end
end
