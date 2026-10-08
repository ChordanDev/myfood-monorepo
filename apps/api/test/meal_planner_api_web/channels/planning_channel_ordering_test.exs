defmodule MealPlannerApiWeb.PlanningChannelOrderingTest do
  @moduledoc """
  Pins the order in which the commanding socket receives the reply to a
  command and an event the channel process itself broadcast while it handled
  that command: the reply comes first, the event second.

  The order is a consequence of the `intercept` of `PlanningChannel`
  (issue #11), not a design goal. Phoenix sends an intercepted broadcast to
  the channel process instead of straight to the transport, so the event
  waits in the mailbox of the channel until the command clause has returned
  and its reply is on its way; only then does `handle_out/3` push it. Before
  the intercept the same event was fastlaned to the transport during the
  command and arrived before the reply.

  This is a characterization test: it documents the current behaviour so
  that a change of it is noticed, for example an event leaving the intercept
  list. It covers one command, `cancel_planning`, whose `session_cancelled`
  event is broadcast by the channel process and needs no other process.

  Clients must not rely on this order. An event broadcast by another process
  (`Generation.Server`, `PlanningSessionServer`, the planning session
  sweeper, `AIChannel`) has no ordering relation to a reply, and the client
  cannot tell which process emitted an event. Replies and events are
  correlated by `requestId` / `sessionId`.
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  import Ecto.Query, only: [from: 2]

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.{PlanningChannel, UserSocket}
  alias Phoenix.Socket.{Message, Reply}

  # The reply and the event are already in flight when the test starts
  # reading; the timeout only bounds a run in which one of them never comes.
  @receive_timeout 1_000

  setup do
    {:ok, user, account, token} =
      issue_identity_and_token("u_plan_ordering_test", "acct_plan_ordering_test")

    %{user: user, account: account, token: token}
  end

  describe "an event the channel broadcasts while it handles a command" do
    test "cancel_planning: the commanding socket receives the reply before session_cancelled",
         %{user: user, account: account, token: token} do
      session_id = insert_active_session(account, user).id

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref = push(socket, "cancel_planning", %{"sessionId" => session_id})

      first = next_reply_or_event(ref, "session_cancelled")
      second = next_reply_or_event(ref, "session_cancelled")

      assert [{:reply, reply}, {:event, event}] = [first, second]

      assert reply.status == :ok
      assert reply.payload == %{"sessionId" => session_id, "status" => :cancelled}
      assert event.payload == %{"sessionId" => session_id}
    end
  end

  # Takes from the mailbox of the test, which is the transport of the socket,
  # the earliest message that is either the reply to `ref` or a push of
  # `event`. One `receive` with both patterns walks the mailbox in arrival
  # order, so two calls return the two messages in the order they arrived;
  # `assert_reply` followed by `assert_push` would each find its own message
  # wherever it is and prove nothing about the order.
  defp next_reply_or_event(ref, event) do
    receive do
      %Reply{ref: ^ref} = reply -> {:reply, reply}
      %Message{event: ^event} = message -> {:event, message}
    after
      @receive_timeout ->
        flunk("neither the reply nor a #{event} push arrived in #{@receive_timeout} ms")
    end
  end

  defp insert_active_session(account, user) do
    {:ok, session} =
      PlanningRepo.create_session(account.id, %{
        range_from: ~D[2026-03-01],
        range_to: ~D[2026-03-08],
        lock_owner_user_id: user.id,
        lock_owner_membership_id: active_membership_id(account.id, user.id),
        lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
      })

    session
  end

  defp active_membership_id(account_id, user_id) do
    Repo.one!(
      from(m in AccountMembership,
        where: m.account_id == ^account_id and m.user_id == ^user_id and m.status == :active,
        select: m.id
      )
    )
  end
end
