defmodule MealPlannerApiWeb.PlanningStartTest do
  @moduledoc """
  The planning agent over `planning:<account_id>` (issue #423, ADR 0007):
  start a session, give consent, talk to the agent and confirm the Proposal
  into Scheduled meals, with the session's events pushed as `agent_event`.
  The agent replaced the legacy `start_planning` / `cancel_planning`
  handlers.
  """

  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers, only: [issue_access_v2_token: 2]
  import MealPlannerApi.PlanningAgentFixtures
  import MealPlannerApiWeb.ChannelHelpers, only: [persist_trial_window!: 2]
  import Phoenix.ChannelTest

  alias MealPlannerApi.Persistence.Planning.{PlanningConsent, PlanningSession, ScheduledMeal}
  alias MealPlannerApi.PlanningAgent.{Consent, Session}
  alias MealPlannerApi.PlanningAgent.Model.Scripted
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.{PlanningChannel, UserSocket}

  @endpoint MealPlannerApiWeb.Endpoint

  @moduletag :capture_log

  @plan [
    {:tool_calls, [{"run_optimizer", %{}}]},
    {:tool_calls, [{"present_proposal", %{}}]},
    {:text, "Here is your plan."}
  ]

  setup do
    sandbox_sessions!()
    owner = household!()
    recipes_for_every_slot!(owner.account)
    script!(@plan)
    %{owner: owner}
  end

  # The scripted model every session started over the channel runs.
  defp script!(script) do
    previous = Application.get_env(:meal_planner_api, :planning_agent)

    Application.put_env(
      :meal_planner_api,
      :planning_agent,
      Keyword.put(previous, :model, {Scripted, script: script})
    )

    on_exit(fn -> Application.put_env(:meal_planner_api, :planning_agent, previous) end)
  end

  defp join!(%{account: account, user: user, membership: membership}) do
    token = issue_access_v2_token(user, membership)
    {:ok, socket} = connect(UserSocket, %{"token" => token})
    {:ok, _reply, socket} = subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")
    socket
  end

  defp today(owner), do: MealPlannerApi.AccountClock.today(owner.account.id)

  defp start!(socket, owner, days \\ 2) do
    ref =
      push(socket, "start_session", %{
        "rangeFrom" => Date.to_iso8601(today(owner)),
        "dayCount" => days
      })

    assert_reply(ref, :ok, reply)
    reply
  end

  defp error_code(ref) do
    assert_reply(ref, :error, %{"error" => %{"code" => code, "message" => message}})
    assert is_binary(message)
    code
  end

  defp scheduled(account),
    do: Repo.aggregate(from(m in ScheduledMeal, where: m.account_id == ^account.id), :count)

  describe "eligibility (#397)" do
    test "an Account that is not eligible cannot join, with enforcement off" do
      refute Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      expired = household!(eligible: false)
      token = issue_access_v2_token(expired.user, expired.membership)
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      assert {:error, %{"error" => %{"code" => :trial_expired}}} =
               subscribe_and_join(socket, PlanningChannel, "planning:#{expired.account.id}")
    end

    test "an Account whose trial ends after the join cannot start", %{owner: owner} do
      socket = join!(owner)
      persist_trial_window!(owner.account, :expired)

      ref = push(socket, "start_session", %{"rangeFrom" => Date.to_iso8601(today(owner))})
      assert error_code(ref) == :planning_session_invalid_range

      ref =
        push(socket, "start_session", %{
          "rangeFrom" => Date.to_iso8601(today(owner)),
          "dayCount" => 1
        })

      assert error_code(ref) == :subscription_required
      refute Repo.exists?(PlanningSession)
    end
  end

  describe "start_session" do
    test "opens a session and asks a User without consent for it", %{owner: owner} do
      socket = join!(owner)
      reply = start!(socket, owner)

      assert %{"sessionId" => session_id, "status" => "active", "consentRequired" => true} = reply
      assert reply["consentText"] == Consent.text()
      assert reply["consentTextVersion"] == Consent.text_version()
      assert reply["rangeFrom"] == Date.to_iso8601(today(owner))
      assert reply["rangeTo"] == Date.to_iso8601(Date.add(today(owner), 1))

      assert %PlanningSession{status: :active, agent: true} =
               Repo.get!(PlanningSession, session_id)
    end

    test "a User who already consented is not asked again", %{owner: owner} do
      consent!(owner.user)
      reply = owner |> join!() |> start!(owner)

      assert reply["consentRequired"] == false
      refute Map.has_key?(reply, "consentText")
    end

    test "accepts rangeTo instead of dayCount, and 31 days at most", %{owner: owner} do
      socket = join!(owner)
      from = Date.to_iso8601(today(owner))

      ref = push(socket, "start_session", %{"rangeFrom" => from, "dayCount" => 32})
      assert error_code(ref) == :planning_session_invalid_range

      ref = push(socket, "start_session", %{"rangeFrom" => "not-a-date", "dayCount" => 2})
      assert error_code(ref) == :planning_session_invalid_range

      ref =
        push(socket, "start_session", %{
          "range_from" => from,
          "range_to" => Date.to_iso8601(Date.add(today(owner), 30))
        })

      assert_reply(ref, :ok, %{"status" => "active"})
    end

    test "a range with a Scheduled meal names the occupied day and slot", %{owner: owner} do
      recipe = recipe!(owner.account, "Planned", ["lunch"])
      scheduled_meal!(owner.account, recipe, today(owner), :lunch)
      socket = join!(owner)

      ref =
        push(socket, "start_session", %{
          "rangeFrom" => Date.to_iso8601(today(owner)),
          "dayCount" => 2
        })

      assert_reply(ref, :error, %{"error" => %{"code" => :planning_slot_occupied} = error})

      assert error["details"] == %{
               "occupied" => [%{"date" => Date.to_iso8601(today(owner)), "slot" => "lunch"}]
             }
    end

    test "a second Member is told another session holds the range, and by whom", %{owner: owner} do
      start!(join!(owner), owner)
      peer = member!(owner.account)

      ref =
        push(join!(peer), "start_session", %{
          "rangeFrom" => Date.to_iso8601(today(owner)),
          "dayCount" => 2
        })

      assert_reply(ref, :error, %{"error" => %{"code" => :planning_range_locked} = error})
      assert error["details"] == %{"ownerName" => owner.user.name}
    end
  end

  describe "the whole path" do
    test "consent, a message, a Proposal and its confirmation into Scheduled meals", %{
      owner: owner
    } do
      socket = join!(owner)
      %{"sessionId" => session_id} = start!(socket, owner)

      # Without consent no model call is made.
      ref = push(socket, "send_message", %{"text" => "Plan my days"})
      assert error_code(ref) == :consent_required
      assert_push("agent_event", %{"type" => "consent_required", "sessionId" => ^session_id})

      ref = push(socket, "give_consent", %{})
      assert_reply(ref, :ok, %{"status" => "granted"})
      assert Repo.exists?(from(c in PlanningConsent, where: c.user_id == ^owner.user.id))

      ref = push(socket, "send_message", %{"text" => "Plan my days"})
      assert_reply(ref, :ok, %{"status" => "accepted"})

      assert_push("agent_event", %{"type" => "proposal", "proposalId" => proposal_id} = proposal)
      assert proposal["sessionId"] == session_id
      assert proposal["status"] == "valid"
      assert length(proposal["meals"]) == 6
      assert %{"budgetCents" => _, "estimatedCostCents" => _} = proposal["budget"]
      assert [%{"date" => _, "slot" => _, "recipeId" => _, "name" => _} | _] = proposal["meals"]

      assert_push("agent_event", %{"type" => "assistant_message", "text" => "Here is your plan."})
      assert_push("agent_event", %{"type" => "turn_completed"})

      ref = push(socket, "confirm", %{"proposalId" => proposal_id})
      assert_reply(ref, :ok, %{"proposalId" => ^proposal_id, "mealsCount" => 6} = summary)
      assert_push("agent_event", %{"type" => "proposal_confirmed", "mealsCount" => 6})
      assert_push("agent_event", %{"type" => "session_ended"})
      assert scheduled(owner.account) == 6

      # Idempotent: a replay answers the same summary and saves nothing more.
      ref = push(socket, "confirm", %{"proposalId" => proposal_id})
      assert_reply(ref, :ok, ^summary)
      assert scheduled(owner.account) == 6

      ref = push(socket, "confirmation_status", %{"proposalId" => proposal_id})
      assert_reply(ref, :ok, %{"status" => "confirmed", "mealsCount" => 6})
    end

    test "a meal scheduled during the session refuses the confirmation and names its slot", %{
      owner: owner
    } do
      consent!(owner.user)
      socket = join!(owner)
      start!(socket, owner)

      ref = push(socket, "send_message", %{"text" => "Plan"})
      assert_reply(ref, :ok, _)
      assert_push("agent_event", %{"type" => "proposal", "proposalId" => proposal_id})

      recipe = recipe!(owner.account, "Added meanwhile", ["dinner"])
      scheduled_meal!(owner.account, recipe, today(owner), :dinner)

      ref = push(socket, "confirm", %{"proposalId" => proposal_id})
      assert_reply(ref, :error, %{"error" => %{"code" => :planning_slot_occupied} = error})

      assert error["details"] == %{
               "occupied" => [%{"date" => Date.to_iso8601(today(owner)), "slot" => "dinner"}]
             }

      assert scheduled(owner.account) == 1
      assert Session.whereis(owner.account.id)
    end

    test "a confirmation of a Proposal never shown is refused", %{owner: owner} do
      consent!(owner.user)
      socket = join!(owner)
      start!(socket, owner)

      ref = push(socket, "confirm", %{"proposalId" => Ecto.UUID.generate()})
      assert error_code(ref) == :stale_proposal

      ref = push(socket, "confirm", %{"proposalId" => "not-a-uuid"})
      assert error_code(ref) == :invalid_proposal_id

      ref = push(socket, "confirmation_status", %{"proposalId" => Ecto.UUID.generate()})
      assert_reply(ref, :ok, %{"status" => "not_found"})
      assert scheduled(owner.account) == 0
    end
  end

  describe "who may act on a session" do
    test "another Member cannot talk to, stop or confirm someone else's session", %{
      owner: owner
    } do
      peer = member!(owner.account)
      consent!(peer.user)
      start!(join!(peer), owner)
      socket = join!(owner)

      ref = push(socket, "send_message", %{"text" => "Plan"})
      assert error_code(ref) == :forbidden

      ref = push(socket, "give_consent", %{})
      assert error_code(ref) == :forbidden

      ref = push(socket, "stop", %{})
      assert error_code(ref) == :forbidden

      ref = push(socket, "confirm", %{"proposalId" => Ecto.UUID.generate()})
      assert error_code(ref) == :forbidden
    end

    test "the Account owner can cancel a Member's session", %{owner: owner} do
      peer = member!(owner.account)
      %{"sessionId" => session_id} = start!(join!(peer), owner)

      ref = push(join!(owner), "cancel_session", %{})
      assert_reply(ref, :ok, %{"status" => "cancelled"})
      assert %PlanningSession{status: :cancelled} = Repo.get!(PlanningSession, session_id)
    end

    test "without a session the commands say so", %{owner: owner} do
      socket = join!(owner)

      for event <- ~w(send_message give_consent stop cancel_session) do
        ref = push(socket, event, %{"text" => "Plan"})
        assert {event, error_code(ref)} == {event, :no_active_session}
      end
    end
  end

  describe "lifecycle" do
    test "stop halts the agent and the session goes on", %{owner: owner} do
      consent!(owner.user)
      test = self()

      script!([
        fn _request ->
          send(test, :model_called)
          Process.sleep(5_000)
          {:text, "never"}
        end,
        {:text, "again"}
      ])

      socket = join!(owner)
      start!(socket, owner)

      ref = push(socket, "send_message", %{"text" => "Plan"})
      assert_reply(ref, :ok, _)

      ref = push(socket, "send_message", %{"text" => "Plan again"})
      assert error_code(ref) == :agent_busy

      # A step that never started is not consumed: stop once it runs.
      assert_receive :model_called
      ref = push(socket, "stop", %{})
      assert_reply(ref, :ok, %{"status" => "stopped"})
      assert_push("agent_event", %{"type" => "stopped"})

      ref = push(socket, "send_message", %{"text" => "Plan again"})
      assert_reply(ref, :ok, _)
      assert_push("agent_event", %{"type" => "assistant_message", "text" => "again"})
    end

    test "the session ends when the socket that started it leaves", %{owner: owner} do
      socket = join!(owner)
      %{"sessionId" => session_id} = start!(socket, owner)
      pid = Session.whereis(owner.account.id)
      ref = Process.monitor(pid)

      Process.unlink(socket.channel_pid)
      leave(socket)

      assert_receive {:DOWN, ^ref, :process, ^pid, :normal}
      assert %PlanningSession{status: :expired} = Repo.get!(PlanningSession, session_id)
    end
  end
end
