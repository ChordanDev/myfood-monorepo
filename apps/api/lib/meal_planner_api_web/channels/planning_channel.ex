defmodule MealPlannerApiWeb.PlanningChannel do
  @moduledoc """
  The `planning:<account_id>` channel: a Member plans with the planning
  agent (`MealPlannerApi.PlanningAgent.Session`, issue #423). The agent
  replaced the legacy handlers (`start_planning`, `send_message` with an
  intent, `cancel_planning`); there is no `planning_agent:*` topic.

  Commands (ADR 0007, the planning exception to ADR 0004):

  - `start_session` — opens an agent Planning session for a range
  - `give_consent` — the Member's AI-processing consent, asked once per User
  - `send_message` — a message to the agent; its answer arrives as events
  - `stop` — halts the agent's running turn
  - `cancel_session` — ends the session (its Member or the Account owner)
  - `confirm` — saves the Proposal on display as Scheduled meals,
    idempotently
  - `confirmation_status` — whether a Proposal was confirmed

  Like any event the channel does not know, the older commands
  (`start_planning`, `cancel_planning`, `generate_menu`, ...) reply the
  `invalid_payload` envelope.

  The session's events are pushed to the socket that started it as
  `agent_event`, with the session id; `docs/CHANNELS.md` lists them.

  Broadcast events of the legacy planner (`proposal_ready`,
  `session_expired`, ...) are still delivered until it is switched off
  (#436), shaped by `handle_out/3`.

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
    * `trial_expired`: the Account is not eligible (issue #397), whatever
      `REVENUECAT_ACCESS_ENFORCEMENT` says; the code the HTTP capability
      plug replies for the same rule.
  """
  use MealPlannerApiWeb, :channel

  require Logger

  alias MealPlannerApi.AccountAccess
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Planning.LockOwner
  alias MealPlannerApi.PlanningAgent.{Consent, Session}
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Casing
  alias MealPlannerApiWeb.Channels.Serializers.PlanningEvents
  alias MealPlannerApiWeb.Plugs.LoadCurrentMembershipSocket

  # The `ApiError` allowlist.
  @codes ApiError.codes()

  # Every event delivered on `planning:<account_id>`. The topic has five
  # broadcasters: this channel, `Generation.Server`, `PlanningSessionServer`,
  # the planning session sweeper and `AIChannel`. An event reaches the client
  # in camelCase only when it is listed here, so a module that starts
  # broadcasting a new event on the topic has to add it; a test compares the
  # list with the events those modules name. `agent_event` is pushed by this
  # channel to the socket whose agent session sent it (issue #423).
  @outbound_events ~w(
    agent_event
    generation_error
    proposal_ready
    proposal_confirmed
    proposal_rejected
    proposal_update
    planning_message
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
         :ok <- check_eligible(membership) do
      send(self(), :after_join)

      {:ok,
       socket
       |> assign(:account_id, topic_account_id)
       |> assign(:current_membership, membership)}
    else
      {:error, code} -> {:error, error_payload(code)}
    end
  end

  # Issue #27 — a client that joins (or rejoins) while its Account has an
  # :active PlanningSession receives `session_resumed` with the pending
  # proposal and the recent chat, so it can recover the session without a
  # command. No active session, no push.
  @impl true
  def handle_info(:after_join, socket) do
    account_id = socket.assigns.account_id

    # An agent session is not resumed: it ends with the socket that started
    # it (absence grace arrives with #432).
    case Planning.get_active_planning_session(account_id) do
      %{agent: false} = session ->
        push(socket, "session_resumed", resumed_payload(account_id, session))

      _none_or_agent ->
        :ok
    end

    {:noreply, socket}
  end

  # The events of the agent session this socket started, as `agent_event`.
  def handle_info({:planning_agent_event, session_id, event}, socket) do
    push(
      socket,
      "agent_event",
      event |> Map.put("session_id", session_id) |> Casing.camelize_keys()
    )

    {:noreply, socket}
  end

  defp resumed_payload(account_id, session) do
    proposal = Planning.latest_pending_proposal(account_id, session)

    Casing.camelize_keys(%{
      session_id: session.id,
      proposal_id: proposal && proposal.id,
      proposal: proposal && resumed_proposal(proposal),
      messages:
        account_id
        |> Planning.recent_planning_messages(session.id)
        |> Enum.map(fn message ->
          %{
            role: Atom.to_string(message.role),
            content: message.content,
            intent_kind: message.intent_kind
          }
        end)
    })
  end

  # Issue #146 — a proposal of the generation is pushed in the shape of
  # `proposal_ready`, so the client rebuilds its draft with the parser of that
  # event. Any other stored proposal is pushed as it was stored.
  defp resumed_proposal(proposal) do
    payload = %{
      proposal: proposal.proposal_json,
      proposal_id: proposal.id,
      run_id: proposal.generation_run_id
    }

    case PlanningEvents.proposal_ready(payload) do
      {:ok, ready, _message} -> ready
      :passthrough -> proposal.proposal_json
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

  # Planning always needs an eligible Account (issue #397), whatever
  # `REVENUECAT_ACCESS_ENFORCEMENT` says, so this join does not go through
  # `ChannelCapability`. The denial is named as the HTTP capability plug
  # names it. `start_session` checks it again.
  defp check_eligible(membership) do
    if AccountAccess.eligible?(membership.account_id), do: :ok, else: {:error, :trial_expired}
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
  #
  # Three events are shaped before they leave (issue #25, see
  # `PlanningEvents`): the proposal of the generation becomes day-by-day cards
  # and is followed by the `planning_message` of the assistant, and a
  # `generation_error` has the same keys whoever broadcast it. Every other
  # payload only has its keys camelized.
  @impl true
  def handle_out("proposal_ready", payload, socket) do
    case PlanningEvents.proposal_ready(payload) do
      {:ok, ready, message} ->
        push(socket, "proposal_ready", Casing.camelize_keys(ready))
        push(socket, "planning_message", Casing.camelize_keys(message))

      :passthrough ->
        push(socket, "proposal_ready", Casing.camelize_keys(payload))
    end

    {:noreply, socket}
  end

  def handle_out("generation_error", payload, socket) do
    push(
      socket,
      "generation_error",
      payload |> PlanningEvents.generation_error() |> Casing.camelize_keys()
    )

    {:noreply, socket}
  end

  # Issue #146 — `PlanningSessionServer` broadcasts `session_resumed` with the
  # session id alone when it restarts. While that session is the Account's
  # active one, each socket gets the payload a join pushes; otherwise the
  # payload goes out as it was broadcast.
  def handle_out("session_resumed", payload, socket) do
    account_id = socket.assigns.account_id
    session_id = payload |> Casing.snake_keys() |> Map.get("session_id")

    resumed =
      case Planning.get_active_planning_session(account_id) do
        %{id: ^session_id} = session -> resumed_payload(account_id, session)
        _other -> Casing.camelize_keys(payload)
      end

    push(socket, "session_resumed", resumed)
    {:noreply, socket}
  end

  def handle_out(event, payload, socket) do
    push(socket, event, Casing.camelize_keys(payload))
    {:noreply, socket}
  end

  # The planning agent's commands (issue #423, ADR 0007): the Member
  # starts a session, gives AI-processing consent, talks to the agent and
  # confirms the Proposal over this topic. The session's events reach the
  # socket that started it as `agent_event` pushes (`handle_info/2`).

  defp handle_command("start_session", payload, socket) do
    membership = socket.assigns.current_membership

    with {:ok, range} <- parse_agent_range(payload),
         {:ok, session} <- start_agent_session(socket, range) do
      {:reply, {:ok, started_payload(session, range)}, socket}
    else
      {:error, {:slot_occupied, occupied}} ->
        details = %{occupied: Enum.map(occupied, &occupied_slot/1)}
        {:reply, {:error, error_payload(:planning_slot_occupied, %{}, details)}, socket}

      {:error, {:range_locked, range}} ->
        details = range_lock_details(membership.account_id, range, membership.id)
        {:reply, {:error, error_payload(:planning_range_locked, %{}, details)}, socket}

      {:error, reason} ->
        {:reply, {:error, error_payload(reason)}, socket}
    end
  end

  defp handle_command("give_consent", _payload, socket) do
    with_own_session(socket, fn pid ->
      case Session.record_consent(pid, socket.assigns.current_user.id) do
        :ok -> {:ok, %{status: "granted"}}
        {:error, :forbidden} -> {:error, :forbidden}
        {:error, _changeset} -> {:error, :invalid_payload}
      end
    end)
  end

  defp handle_command("send_message", payload, socket) do
    with_own_session(socket, fn pid ->
      case Session.send_message(pid, Map.get(payload, "text")) do
        :ok -> {:ok, %{status: "accepted"}}
        {:error, :busy} -> {:error, :agent_busy}
        {:error, :consent_required} -> {:error, :consent_required}
        {:error, _invalid} -> {:error, :invalid_payload}
      end
    end)
  end

  defp handle_command("stop", _payload, socket) do
    with_own_session(socket, fn pid ->
      case Session.stop(pid, socket.assigns.current_membership.id) do
        :ok -> {:ok, %{status: "stopped"}}
        error -> error
      end
    end)
  end

  # The session's Member or the Account owner cancels it.
  defp handle_command("cancel_session", _payload, socket) do
    membership = socket.assigns.current_membership

    with_session(socket, fn pid ->
      case Session.cancel(pid, %{membership_id: membership.id, owner?: membership.role == :owner}) do
        :ok -> {:ok, %{status: "cancelled"}}
        error -> error
      end
    end)
  end

  defp handle_command("confirm", payload, socket) do
    membership = socket.assigns.current_membership

    with {:ok, proposal_id} <- require_proposal_id(payload),
         {:ok, summary} <- Session.confirm(membership.account_id, membership.id, proposal_id) do
      {:reply, {:ok, confirmation_payload(summary)}, socket}
    else
      {:error, reason} -> {:reply, {:error, error_payload(agent_reason(reason))}, socket}
    end
  end

  # Whether a Proposal was confirmed, also after its session ended (a client
  # that lost the acknowledgement of `confirm`).
  defp handle_command("confirmation_status", payload, socket) do
    case require_proposal_id(payload) do
      {:ok, proposal_id} ->
        {:reply, {:ok, confirmation_status(socket.assigns.account_id, proposal_id)}, socket}

      {:error, reason} ->
        {:reply, {:error, error_payload(reason)}, socket}
    end
  end

  defp handle_command(_event, _payload, socket) do
    {:reply, {:error, error_payload(:invalid_payload)}, socket}
  end

  defp camelize_ok_reply({:reply, {:ok, payload}, socket}),
    do: {:reply, {:ok, Casing.camelize_keys(payload)}, socket}

  defp camelize_ok_reply(result), do: result

  # Issue #11 — the payload of every error reply, joins and commands alike:
  # the `ApiError` envelope `%{error: %{code: code, message: message}}` for
  # the reason a guard or a service returned, with camelCase keys.
  defp error_payload(reason), do: error_payload(reason, %{}, %{})

  # `details` ride inside `error`, next to `code` and `message`, when the
  # reason is worth more than its message (`planning_range_locked` names the
  # member who holds the range).
  defp error_payload(reason, correlation, details) do
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

  # Every reason the commands reply is an atom of the allowlist.
  defp error_code(reason) when reason in @codes, do: {:ok, reason}
  defp error_code(_reason), do: :error

  # The range of `start_session`: `range_from` is an ISO 8601 date and the
  # range ends with `range_to` or lasts `day_count` days. The session checks
  # the length and that it starts today or later; a payload without a
  # readable range is refused the same way.
  defp parse_agent_range(payload) do
    with {:ok, date_from} <- parse_iso_date(Map.get(payload, "range_from")),
         {:ok, date_to} <- agent_range_end(date_from, payload) do
      {:ok, {date_from, date_to}}
    end
  end

  # A key sent as `null` is as absent as one not sent.
  defp agent_range_end(date_from, payload) do
    case {Map.get(payload, "range_to"), Map.get(payload, "day_count")} do
      {nil, count} when is_integer(count) and count >= 1 -> {:ok, Date.add(date_from, count - 1)}
      {range_to, nil} -> parse_iso_date(range_to)
      _invalid -> {:error, :planning_session_invalid_range}
    end
  end

  defp parse_iso_date(string) when is_binary(string) do
    case Date.from_iso8601(string) do
      {:ok, date} -> {:ok, date}
      _ -> {:error, :planning_session_invalid_range}
    end
  end

  defp parse_iso_date(_), do: {:error, :planning_session_invalid_range}

  # The session's events go to this socket's process, which pushes them.
  defp start_agent_session(socket, range) do
    membership = socket.assigns.current_membership

    attrs = %{
      account_id: membership.account_id,
      user_id: socket.assigns.current_user.id,
      membership_id: membership.id,
      range: range
    }

    case Session.start(attrs, subscriber: self()) do
      {:ok, session} ->
        {:ok, session}

      {:error, :invalid_range} ->
        {:error, :planning_session_invalid_range}

      {:error, reason} when reason in [:session_already_active, :overlapping_range] ->
        {:error, {:range_locked, range}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp started_payload(session, {date_from, date_to}) do
    consent =
      if session.consent_required,
        do: %{consent_text: Consent.text(), consent_text_version: Consent.text_version()},
        else: %{}

    Map.merge(
      %{
        session_id: session.session_id,
        status: "active",
        range_from: Date.to_iso8601(date_from),
        range_to: Date.to_iso8601(date_to),
        consent_required: session.consent_required
      },
      consent
    )
  end

  # Runs `command` on the Account's running session when this socket's
  # Member owns it. `command` returns `{:ok, reply}` or `{:error, reason}`.
  defp with_own_session(socket, command) do
    with_session(socket, fn pid ->
      if Session.info(pid).membership_id == socket.assigns.current_membership.id,
        do: command.(pid),
        else: {:error, :forbidden}
    end)
  end

  # A session that ends during the call is no longer active.
  defp with_session(socket, command) do
    result =
      case Session.whereis(socket.assigns.account_id) do
        nil -> {:error, :no_active_session}
        pid -> command.(pid)
      end

    case result do
      {:ok, reply} -> {:reply, {:ok, reply}, socket}
      {:error, reason} -> {:reply, {:error, error_payload(reason)}, socket}
    end
  catch
    :exit, _reason -> {:reply, {:error, error_payload(:no_active_session)}, socket}
  end

  defp require_proposal_id(payload) do
    case Ecto.UUID.cast(Map.get(payload, "proposal_id")) do
      {:ok, id} -> {:ok, id}
      :error -> {:error, :invalid_proposal_id}
    end
  end

  defp confirmation_status(account_id, proposal_id) do
    case Session.confirmation_status(account_id, proposal_id) do
      {:confirmed, summary} -> Map.put(confirmation_payload(summary), :status, "confirmed")
      :not_found -> %{proposal_id: proposal_id, status: "not_found"}
    end
  end

  defp confirmation_payload(summary) do
    %{
      proposal_id: summary.confirmation_id,
      meals_count: summary.meals_count,
      range_from: Date.to_iso8601(summary.range_from),
      range_to: Date.to_iso8601(summary.range_to)
    }
  end

  # The session's reasons by the codes the client knows.
  defp agent_reason(:busy), do: :agent_busy
  defp agent_reason(:unresolved), do: :confirmation_unresolved
  defp agent_reason(:session_not_active), do: :no_active_session
  defp agent_reason(:rejected), do: :transaction_failed
  defp agent_reason(reason), do: reason

  defp occupied_slot({date, slot}), do: %{date: Date.to_iso8601(date), slot: to_string(slot)}

  # The details of `planning_range_locked`: the display name of the member
  # who holds the range, only when it is not the caller.
  defp range_lock_details(account_id, range, caller_membership_id) do
    case LockOwner.owner_name(account_id, range, caller_membership_id) do
      {:ok, name} -> %{owner_name: name}
      :none -> %{}
    end
  end
end
