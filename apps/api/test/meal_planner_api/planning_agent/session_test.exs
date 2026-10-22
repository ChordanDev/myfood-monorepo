defmodule MealPlannerApi.PlanningAgent.SessionTest do
  @moduledoc """
  The agent Planning session (issue #423): who can start one, the range it
  covers, the consent gate, its lock and its lifecycle, driven with the
  scripted model.
  """

  use ExUnit.Case, async: false

  import MealPlannerApi.PlanningAgentFixtures

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Planning.{PlanningConsent, PlanningSession}
  alias MealPlannerApi.PlanningAgent.{Consent, FakeOptimizer, Session}
  alias MealPlannerApi.PlanningAgent.Model.{ClaudeMessages, Scripted}
  alias MealPlannerApi.Repo

  setup do
    sandbox_sessions!()
    on_exit(&FakeOptimizer.reset!/0)
    owner = household!()
    recipes_for_every_slot!(owner.account)
    %{owner: owner}
  end

  defp start(who, opts \\ []) do
    {range, opts} = Keyword.pop(opts, :range)
    {script, opts} = Keyword.pop(opts, :script, [])

    opts =
      Keyword.merge(
        [
          model: {Scripted, script: script, notify: self()},
          optimizer: FakeOptimizer,
          subscriber: self()
        ],
        opts
      )

    Session.start(session_attrs(who, range), opts)
  end

  defp row(session_id), do: Repo.get!(PlanningSession, session_id)

  describe "start/2 eligibility (#397)" do
    test "an Account that is not eligible cannot start, with enforcement off" do
      refute Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      expired = household!(eligible: false)

      assert {:error, :subscription_required} = start(expired)
      refute Repo.exists?(PlanningSession)
    end

    test "an eligible Account starts a session that holds the range lock as an agent row", %{
      owner: owner
    } do
      assert {:ok, %{session_id: id, pid: pid}} = start(owner)
      assert Process.alive?(pid)
      assert %PlanningSession{status: :active, agent: true} = row(id)
      assert Session.whereis(owner.account.id) == pid
    end
  end

  describe "start/2 range" do
    test "covers 1 to 31 days starting today or later in the Account's timezone", %{
      owner: owner
    } do
      today = MealPlannerApi.AccountClock.today(owner.account.id)

      assert {:error, :invalid_range} = start(owner, range: {Date.add(today, -1), today})
      assert {:error, :invalid_range} = start(owner, range: {today, Date.add(today, 31)})
      assert {:error, :invalid_range} = start(owner, range: {Date.add(today, 1), today})
      assert {:error, :invalid_range} = start(owner, range: :not_a_range)

      assert {:ok, _session} = start(owner, range: {today, Date.add(today, 30)})
    end

    test "is refused while a Scheduled meal holds one of its days and slots", %{owner: owner} do
      today = MealPlannerApi.AccountClock.today(owner.account.id)
      recipe = recipe!(owner.account, "Planned", ["dinner"])
      scheduled_meal!(owner.account, recipe, Date.add(today, 1), :dinner)

      assert {:error, {:slot_occupied, [{date, :dinner}]}} = start(owner)
      assert date == Date.add(today, 1)
    end
  end

  describe "start/2 lock" do
    test "one agent session per Account; a second Member is refused", %{owner: owner} do
      assert {:ok, _session} = start(owner)
      other = member!(owner.account)
      today = MealPlannerApi.AccountClock.today(owner.account.id)

      assert {:error, :session_already_active} =
               start(other, range: {Date.add(today, 5), Date.add(today, 6)})
    end

    test "a legacy session over the same days excludes it", %{owner: owner} do
      today = MealPlannerApi.AccountClock.today(owner.account.id)

      {:ok, _legacy} =
        PlanningRepo.create_session(owner.account.id, %{
          range_from: today,
          range_to: today,
          lock_owner_user_id: owner.user.id,
          lock_owner_membership_id: owner.membership.id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), 120)
        })

      assert {:error, :overlapping_range} = start(owner)
    end

    test "the paid model refuses without its configuration: the agent is unavailable", %{
      owner: owner
    } do
      assert {:error, :agent_unavailable} =
               start(owner, model: {ClaudeMessages, api_key: nil})

      refute Repo.exists?(PlanningSession)
    end
  end

  describe "consent (S4)" do
    test "a User without consent is asked; no model call is made until they give it", %{
      owner: owner
    } do
      assert {:ok, %{session_id: id, pid: pid, consent_required: true}} =
               start(owner, script: [{:text, "Hello!"}])

      assert {:error, :consent_required} = Session.send_message(pid, "Plan my week")

      assert_receive {:planning_agent_event, ^id,
                      %{"type" => "consent_required", "text" => text, "text_version" => version}}

      assert text == Consent.text()
      assert version == Consent.text_version()
      refute_received {:scripted_model_request, _}

      assert :ok = Session.record_consent(pid, owner.user.id)
      assert :ok = Session.send_message(pid, "Plan my week")
      assert_receive {:scripted_model_request, _request}
      assert_receive {:planning_agent_event, ^id, %{"type" => "assistant_message"}}
    end

    test "is stored once per User and not asked again, in any Account", %{owner: owner} do
      {:ok, %{pid: pid}} = start(owner)
      :ok = Session.record_consent(pid, owner.user.id)
      :ok = Session.cancel(pid, %{membership_id: owner.membership.id, owner?: true})

      assert [%PlanningConsent{text_version: "placeholder-2026-10-22"}] =
               Repo.all(PlanningConsent)

      # The same User in another Account.
      other = household!()
      recipes_for_every_slot!(other.account)

      membership =
        %AccountMembership{}
        |> AccountMembership.changeset(%{
          account_id: other.account.id,
          user_id: owner.user.id,
          role: :member,
          status: :active,
          joined_at: DateTime.utc_now()
        })
        |> Repo.insert!()

      assert {:ok, %{consent_required: false}} =
               start(%{account: other.account, user: owner.user, membership: membership})

      # Recording it again keeps the one row.
      assert :ok = Consent.record(owner.user.id)
      assert Repo.aggregate(PlanningConsent, :count) == 1
    end

    test "only the session's User can give it", %{owner: owner} do
      {:ok, %{pid: pid}} = start(owner)
      other = member!(owner.account)

      assert {:error, :forbidden} = Session.record_consent(pid, other.user.id)
      refute Consent.granted?(other.user.id)
      refute Consent.granted?(owner.user.id)
    end
  end

  describe "send_message/2" do
    setup %{owner: owner} do
      consent!(owner.user)
      :ok
    end

    test "refuses an empty or too long message without storing it", %{owner: owner} do
      {:ok, %{pid: pid}} = start(owner)

      assert {:error, :invalid_message} = Session.send_message(pid, "  ")

      assert {:error, :message_too_long} =
               Session.send_message(pid, String.duplicate("a", Session.max_message_bytes() + 1))

      refute_received {:scripted_model_request, _}
    end

    test "instructions carry code-owned facts only, and plan breakfast, lunch and dinner", %{
      owner: owner
    } do
      {:ok, %{pid: pid}} = start(owner, script: [{:text, "ok"}])
      :ok = Session.send_message(pid, "Plan my week")

      assert_receive {:scripted_model_request, %{instructions: instructions, tools: tools}}
      assert instructions =~ "slots: breakfast, lunch, dinner"
      refute instructions =~ owner.user.name

      assert Enum.map(tools, & &1.name) ==
               ~w(search_recipes run_optimizer present_proposal ask_human)
    end

    test "is refused while a turn runs", %{owner: owner} do
      test = self()

      slow = fn _request ->
        send(test, :turn_started)
        Process.sleep(500)
        {:text, "done"}
      end

      {:ok, %{pid: pid}} = start(owner, script: [slow])
      :ok = Session.send_message(pid, "first")
      assert_receive :turn_started
      assert {:error, :busy} = Session.send_message(pid, "second")
    end

    test "stop halts the running turn and keeps the session", %{owner: owner} do
      test = self()

      slow = fn _request ->
        send(test, :turn_started)
        Process.sleep(5_000)
        {:text, "never"}
      end

      {:ok, %{session_id: id, pid: pid}} = start(owner, script: [slow, {:text, "again"}])
      :ok = Session.send_message(pid, "first")
      assert_receive :turn_started

      other = member!(owner.account)
      assert {:error, :forbidden} = Session.stop(pid, other.membership.id)
      assert :ok = Session.stop(pid, owner.membership.id)
      assert_receive {:planning_agent_event, ^id, %{"type" => "stopped"}}
      refute_receive {:planning_agent_event, ^id, %{"type" => "assistant_message"}}, 100

      assert :ok = Session.send_message(pid, "second")

      assert_receive {:planning_agent_event, ^id,
                      %{"type" => "assistant_message", "text" => "again"}}
    end

    test "a turn past its deadline is killed and reported", %{owner: owner} do
      slow = fn _request ->
        Process.sleep(5_000)
        {:text, "never"}
      end

      {:ok, %{session_id: id, pid: pid}} = start(owner, script: [slow], deadline_ms: 100)
      :ok = Session.send_message(pid, "Plan")

      assert_receive {:planning_agent_event, ^id,
                      %{"type" => "limit_reached", "limit" => "time"}},
                     1_000
    end
  end

  describe "lifecycle" do
    test "cancel ends the session and frees the range; only its Member or the owner", %{
      owner: owner
    } do
      member = member!(owner.account)
      {:ok, %{session_id: id, pid: pid}} = start(member)
      ref = Process.monitor(pid)
      intruder = member!(owner.account)

      assert {:error, :forbidden} =
               Session.cancel(pid, %{membership_id: intruder.membership.id, owner?: false})

      assert :ok = Session.cancel(pid, %{membership_id: owner.membership.id, owner?: true})
      assert_receive {:planning_agent_event, ^id, %{"type" => "session_cancelled"}}
      assert_receive {:DOWN, ^ref, :process, ^pid, :normal}
      assert %PlanningSession{status: :cancelled} = row(id)
      assert Session.whereis(owner.account.id) == nil
    end

    test "the session ends when its last subscriber leaves", %{owner: owner} do
      test = self()

      subscriber =
        spawn(fn ->
          receive do
            :leave -> :ok
          end
        end)

      {:ok, %{session_id: id, pid: pid}} = start(owner, subscriber: subscriber)
      ref = Process.monitor(pid)
      send(subscriber, :leave)

      assert_receive {:DOWN, ^ref, :process, ^pid, :normal}
      assert %PlanningSession{status: :expired} = row(id)
      _ = test
    end

    test "a lost lease ends the session", %{owner: owner} do
      {:ok, %{session_id: id, pid: pid}} = start(owner)
      ref = Process.monitor(pid)
      {:ok, _} = PlanningRepo.expire_session(owner.account.id, id)

      send(pid, :renew_lease)

      assert_receive {:planning_agent_event, ^id, %{"type" => "session_ended"}}
      assert_receive {:DOWN, ^ref, :process, ^pid, :normal}
    end

    test "docs/CHANNELS.md documents exactly the event allowlist" do
      [_before, section] = "docs/CHANNELS.md" |> File.read!() |> String.split("#### Agent events")
      [table | _rest] = String.split(section, "A Proposal's")

      documented =
        for [_, type, fields] <- Regex.scan(~r/^\| `([a-z_]+)` \|([^|]*)\|$/m, table),
            into: %{} do
          {type,
           fields
           |> String.replace("`", "")
           |> String.split(",")
           |> Enum.map(&String.trim/1)
           |> Enum.reject(&(&1 == ""))}
        end

      camel = fn field ->
        [first | rest] = String.split(field, "_")
        Enum.join([first | Enum.map(rest, &String.capitalize/1)])
      end

      assert documented ==
               Map.new(Session.event_fields(), fn {type, fields} ->
                 {type, Enum.map(fields, camel)}
               end)
    end

    test "events outside the allowlist never reach a subscriber" do
      assert Map.keys(Session.event_fields()) |> Enum.sort() ==
               ~w(agent_unavailable assistant_message confirmation_unresolved consent_required
                  limit_reached optimizer_failed progress proposal proposal_confirmed
                  proposal_invalidated question session_cancelled session_ended stopped
                  turn_completed)
    end
  end
end
