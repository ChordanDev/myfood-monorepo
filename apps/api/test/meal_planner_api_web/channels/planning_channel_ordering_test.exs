defmodule MealPlannerApiWeb.PlanningChannelOrderingTest do
  @moduledoc """
  Pins the order in which the commanding socket receives the reply to a
  command and an event the command made its agent session emit: the reply
  comes first, the event second.

  The order is a consequence of how the channel waits: while
  `Session.cancel/2` runs, the session's `session_cancelled` event waits in
  the mailbox of the channel, which pushes it only after the command clause
  has returned and its reply is on its way.

  This is a characterization test: it documents the current behaviour so
  that a change of it is noticed. Clients must not rely on this order: an
  event the session emits on its own (an agent turn) has no ordering
  relation to a reply. Events are correlated by `sessionId`.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers, only: [issue_access_v2_token: 2]
  import MealPlannerApi.PlanningAgentFixtures
  import Phoenix.ChannelTest

  alias MealPlannerApiWeb.{PlanningChannel, UserSocket}
  alias Phoenix.Socket.{Message, Reply}

  @endpoint MealPlannerApiWeb.Endpoint

  # The reply and the event are already in flight when the test starts
  # reading; the timeout only bounds a run in which one of them never comes.
  @receive_timeout 1_000

  setup do
    sandbox_sessions!()
    %{owner: household!()}
  end

  describe "an event a command makes the agent session emit" do
    test "cancel_session: the commanding socket receives the reply before session_cancelled",
         %{owner: owner} do
      token = issue_access_v2_token(owner.user, owner.membership)
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{owner.account.id}")

      today = MealPlannerApi.AccountClock.today(owner.account.id)

      ref =
        push(socket, "start_session", %{"rangeFrom" => Date.to_iso8601(today), "dayCount" => 1})

      assert_reply(ref, :ok, %{"sessionId" => session_id})

      ref = push(socket, "cancel_session", %{})

      first = next_reply_or_event(ref)
      second = next_reply_or_event(ref)

      assert [{:reply, reply}, {:event, event}] = [first, second]

      assert reply.status == :ok
      assert reply.payload == %{"status" => "cancelled"}
      assert event.payload == %{"type" => "session_cancelled", "sessionId" => session_id}
    end
  end

  # Takes from the mailbox of the test, which is the transport of the socket,
  # the earliest message that is either the reply to `ref` or a
  # `session_cancelled` push. One `receive` with both patterns walks the
  # mailbox in arrival order, so two calls return the two messages in the
  # order they arrived.
  defp next_reply_or_event(ref) do
    receive do
      %Reply{ref: ^ref} = reply ->
        {:reply, reply}

      %Message{event: "agent_event", payload: %{"type" => "session_cancelled"}} = message ->
        {:event, message}
    after
      @receive_timeout ->
        flunk("neither the reply nor a session_cancelled push arrived in #{@receive_timeout} ms")
    end
  end
end
