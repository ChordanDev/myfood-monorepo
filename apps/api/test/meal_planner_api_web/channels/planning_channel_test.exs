defmodule MealPlannerApiWeb.PlanningChannelTest do
  use MealPlannerApiWeb.ChannelCase, async: false

  import Ecto.Query, warn: false
  import ExUnit.CaptureLog
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Generation.PlanningSession.Sweeper
  alias MealPlannerApi.Persistence.Accounts.Account, as: PersistenceAccount
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Planning.{PlanningGenerationRun, PlanningMessage}
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.{AIChannel, Endpoint, PlanningChannel, UserSocket}

  import MealPlannerApiWeb.CasingAssertions, only: [assert_camel_case_keys: 1]
  import MealPlannerApiWeb.ChannelHelpers, only: [issue_identity_and_token: 2]

  # The channel logs a warning for every reason it replies as `unknown_error`;
  # the log of a test is printed only when the test fails.
  @moduletag :capture_log

  setup do
    _ = intent_atoms()

    {:ok, user, account, token} = issue_identity_and_token("u_plan_test", "acct_plan_test")

    # Every test of this file gets the same account id, and a generation
    # server registers under it when a test makes `start_planning` start
    # one. This stops it, so the server a test left does not answer the
    # commands of the next test.
    on_exit(fn ->
      for {pid, _value} <-
            Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) do
        DynamicSupervisor.terminate_child(MealPlannerApi.Generation.ServerSupervisor, pid)
      end
    end)

    %{user: user, account: account, token: token}
  end

  # `IntentAtomizer` only atomizes a key that already exists as an atom
  # (`String.to_existing_atom/1`). A release loads every module at boot, so
  # the atoms of the intents exist there; the test VM loads modules on
  # demand, and whether `:budget_cents` existed would depend on which test
  # ran first. Naming the atoms of the intents this file sends makes them
  # exist as soon as this module is loaded.
  # An ISO date `offset` days from today. `start_planning` refuses a range that
  # starts in the past, so the tests that start a session ask for dates
  # relative to the day they run.
  defp in_days(offset), do: Date.utc_today() |> Date.add(offset) |> Date.to_iso8601()

  defp intent_atoms, do: [:kind, :payload, :change_constraints, :budget_cents]

  # Phase 4 — `revenuecat-access-enforcement` realtime enforcement
  # (task 4.1). Trial-window helper used to mark the seeded Account
  # `:eligible` or `:expired` for `AccountAccess.eligible?/1`.
  defp persist_trial_window!(%PersistenceAccount{} = account, :eligible) do
    started = DateTime.utc_now()
    ends = DateTime.add(started, 7 * 86_400, :second)

    {:ok, updated} =
      account
      |> PersistenceAccount.changeset(%{trial_started_at: started, trial_ends_at: ends})
      |> Repo.update()

    updated
  end

  defp persist_trial_window!(%PersistenceAccount{} = account, :expired) do
    past = DateTime.add(DateTime.utc_now(), -30 * 86_400, :second)

    {:ok, updated} =
      account
      |> PersistenceAccount.changeset(%{trial_started_at: past, trial_ends_at: past})
      |> Repo.update()

    updated
  end

  # ==========================================================================
  # Join authorization tests
  # ==========================================================================

  describe "join/3 authorization" do
    test "user joins their own planning channel", %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      assert socket.assigns.account_id == account.id
    end

    test "user cannot join another account's planning channel", %{token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      # Try to join a different account's planning channel
      socket
      |> subscribe_and_join(PlanningChannel, "planning:other_account_id")
      |> assert_join_error(:forbidden)
    end

    test "cross-Account join is rejected (task 3.10)" do
      user =
        user_with_memberships(
          %{email: "plan_cross@example.com"},
          [
            {%{plan: :family_4, name: "Plan Cross A"}, :owner},
            {%{plan: :individual, name: "Plan Cross B"}, :member}
          ]
        )

      membership_a = Enum.find(user.memberships, &(&1.account.name == "Plan Cross A"))
      membership_b = Enum.find(user.memberships, &(&1.account.name == "Plan Cross B"))
      token_a = issue_access_v2_token(user, membership_a)

      {:ok, socket} = connect(UserSocket, %{"token" => token_a})

      socket
      |> subscribe_and_join(PlanningChannel, "planning:#{membership_b.account_id}")
      |> assert_join_error(:forbidden)
    end

    test "invited (non-active) membership join is rejected (task 3.10)" do
      user =
        user_with_memberships(
          %{email: "plan_invited@example.com"},
          [
            {%{plan: :family_4, name: "Plan Invited Account"}, :owner}
          ]
        )

      [membership] = user.memberships

      {:ok, invited_membership} =
        membership
        |> AccountMembership.changeset(%{status: :invited})
        |> MealPlannerApi.Repo.update()

      token = issue_access_v2_token(user, invited_membership)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      socket
      |> subscribe_and_join(PlanningChannel, "planning:#{invited_membership.account_id}")
      |> assert_join_error(:forbidden)
    end

    test "access_v1 legacy token is accepted via fallback (task 3.10)", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      assert {:ok, _reply, socket} =
               subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      assert socket.assigns.current_membership.account_id == account.id
      assert socket.assigns.current_membership.status == :active
    end
  end

  # ==========================================================================
  # Issue #24 — a socket outlives the access token it connected with, so the
  # join checks the token again. `unauthenticated` is the cue of the client to
  # refresh the token and reconnect.
  # ==========================================================================

  describe "join/3 authentication (issue #24)" do
    test "a socket whose access token expired since connect is refused as unauthenticated",
         %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      socket
      |> with_token_expiry(System.system_time(:second) - 1)
      |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
      |> assert_join_error(:unauthenticated)
    end

    test "a token that expires at the current second is already expired",
         %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      socket
      |> with_token_expiry(System.system_time(:second))
      |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
      |> assert_join_error(:unauthenticated)
    end

    test "a socket without identity is refused as unauthenticated", %{account: account} do
      UserSocket
      |> socket()
      |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
      |> assert_join_error(:unauthenticated)
    end

    test "a socket without claims is refused as unauthenticated",
         %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      %{socket | assigns: Map.delete(socket.assigns, :claims)}
      |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
      |> assert_join_error(:unauthenticated)
    end

    test "a socket without a current user is refused as unauthenticated",
         %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      %{socket | assigns: Map.delete(socket.assigns, :current_user)}
      |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
      |> assert_join_error(:unauthenticated)
    end

    test "a token that has not expired yet joins", %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      assert {:ok, _reply, _socket} =
               socket
               |> with_token_expiry(System.system_time(:second) + 60)
               |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
    end

    test "a token without an expiry claim is not treated as expired",
         %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      assert {:ok, _reply, _socket} =
               socket
               |> update_in([Access.key!(:assigns), :claims], &Map.delete(&1, "exp"))
               |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
    end

    test "a token whose expiry claim is not an integer is not treated as expired",
         %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      assert {:ok, _reply, _socket} =
               socket
               |> with_token_expiry("yesterday")
               |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
    end

    # Ordering: the token is checked before the Membership, so an expired
    # token replies `unauthenticated` even on a topic the Membership could
    # not join.
    test "an expired token on another Account's topic is refused as unauthenticated",
         %{token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      socket
      |> with_token_expiry(System.system_time(:second) - 1)
      |> subscribe_and_join(PlanningChannel, "planning:other_account_id")
      |> assert_join_error(:unauthenticated)
    end
  end

  # ==========================================================================
  # Phase 4 — `revenuecat-access-enforcement` realtime enforcement (task 4.1).
  # Same Account eligibility rule as the HTTP `:enforce_capability` plug, and
  # the same `trial_expired` code (issue #24).
  # ==========================================================================

  describe "join/3 subscription enforcement (phase 4 task 4.1)" do
    test "expired Account join returns trial_expired when enforcement is enabled (task 4.1)",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :expired)

      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      try do
        {:ok, socket} = connect(UserSocket, %{"token" => token})

        socket
        |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
        |> assert_join_error(:trial_expired)
      after
        Application.put_env(
          :meal_planner_api,
          :revenuecat_access_enforcement,
          previous
        )
      end
    end

    # Ordering: the token is checked before the capability, so an expired
    # token replies `unauthenticated` and the client refreshes it before it
    # learns anything about the trial.
    test "an expired token is refused as unauthenticated before the capability check",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :expired)

      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      try do
        {:ok, socket} = connect(UserSocket, %{"token" => token})

        socket
        |> with_token_expiry(System.system_time(:second) - 1)
        |> subscribe_and_join(PlanningChannel, "planning:#{account.id}")
        |> assert_join_error(:unauthenticated)
      after
        Application.put_env(
          :meal_planner_api,
          :revenuecat_access_enforcement,
          previous
        )
      end
    end

    test "eligible Account join succeeds when enforcement is enabled (task 4.1)",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :eligible)

      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      try do
        {:ok, socket} = connect(UserSocket, %{"token" => token})

        assert {:ok, _reply, socket} =
                 subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

        assert socket.assigns.account_id == account.id
      after
        Application.put_env(
          :meal_planner_api,
          :revenuecat_access_enforcement,
          previous
        )
      end
    end

    test "disabled enforcement allows an expired Account to join (rollout safety, task 4.1)",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :expired)

      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, false)

      try do
        {:ok, socket} = connect(UserSocket, %{"token" => token})

        assert {:ok, _reply, _socket} =
                 subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")
      after
        Application.put_env(
          :meal_planner_api,
          :revenuecat_access_enforcement,
          previous
        )
      end
    end

    # Task 4.2 — ordering triangulation: topic-vs-membership mismatch fires
    # BEFORE the subscription check, so the response is `forbidden` (not
    # `trial_expired`) even when enforcement is on. Prevents
    # leaking another Account's subscription state.
    test "topic-vs-membership mismatch fires before subscription check (task 4.2)",
         %{token: token} do
      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      try do
        {:ok, socket} = connect(UserSocket, %{"token" => token})

        socket
        |> subscribe_and_join(PlanningChannel, "planning:other_account_id")
        |> assert_join_error(:forbidden)
      after
        Application.put_env(
          :meal_planner_api,
          :revenuecat_access_enforcement,
          previous
        )
      end
    end
  end

  # ==========================================================================
  # Phase 4 — PR4 `cancel_planning` lifecycle handler (tasks 4.3 / 4.4).
  # Owner-scoped cancel: the session owner OR the Account's `:owner` role
  # may cancel; any other peer gets `:forbidden`. Calls
  # `PlanningRepo.cancel_session/4` (PR2) and broadcasts `session_cancelled`
  # on `planning:<account_id>` via `Phoenix.Channel.Server.broadcast!/4`.
  # ==========================================================================

  describe "handle_in cancel_planning (task 4.3 / 4.4)" do
    test "owner cancels their own session: :ok + session_cancelled broadcast", %{
      account: account,
      user: owner_user,
      token: owner_token
    } do
      _ = persist_trial_window!(account, :eligible)
      owner_membership_id = owner_membership_id(account.id, owner_user.id)

      # Pre-create an active session owned by owner_user.
      {:ok, session} =
        PlanningRepo.create_session(account.id, %{
          range_from: ~D[2026-03-01],
          range_to: ~D[2026-03-08],
          lock_owner_user_id: owner_user.id,
          lock_owner_membership_id: owner_membership_id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
        })

      session_id = session.id

      {:ok, socket} = connect(UserSocket, %{"token" => owner_token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "cancel_planning", %{
          "session_id" => session_id
        })

      assert_reply(ref, :ok, %{"sessionId" => ^session_id} = payload)
      assert payload["status"] == :cancelled

      assert_push("session_cancelled", %{"sessionId" => ^session_id})

      # Row flipped to :cancelled in the DB.
      reloaded =
        MealPlannerApi.Persistence.Planning.PlanningSession
        |> MealPlannerApi.Repo.get!(session_id)

      assert reloaded.status == :cancelled
      assert reloaded.terminal_at != nil
    end

    test "non-owner peer cannot cancel a peer's session: :forbidden, no state change",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :eligible)
      _ = token

      # Create a separate User + their own session for the same Account.
      peer_user =
        %User{}
        |> User.changeset(%{
          email: "peer-cancel-#{System.unique_integer([:positive])}@example.com",
          name: "Peer Cancel",
          role: :member
        })
        |> Repo.insert!()

      peer_membership_id =
        %AccountMembership{}
        |> AccountMembership.changeset(%{
          account_id: account.id,
          user_id: peer_user.id,
          role: :member,
          status: :active,
          joined_at: DateTime.utc_now()
        })
        |> Repo.insert!()
        |> Map.get(:id)

      {:ok, session} =
        PlanningRepo.create_session(account.id, %{
          range_from: ~D[2026-03-01],
          range_to: ~D[2026-03-08],
          lock_owner_user_id: peer_user.id,
          lock_owner_membership_id: peer_membership_id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
        })

      session_id = session.id

      # Bypass the `issue_identity_and_token` setup entirely and mint a
      # token for a brand-new peer user with a `:member` role on this
      # account. That user is NOT the account owner, so the cancel
      # attempt MUST be rejected with `:forbidden`.
      non_owner_token = non_owner_peer_token(account)

      {:ok, socket} = connect(UserSocket, %{"token" => non_owner_token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "cancel_planning", %{
          "session_id" => session_id
        })

      assert_error_reply(ref, :forbidden)

      # No session_cancelled broadcast fires.
      refute_receive %Phoenix.Socket.Broadcast{
                       topic: "planning:" <> _,
                       event: "session_cancelled"
                     },
                     200

      # Row stays :active.
      reloaded =
        MealPlannerApi.Persistence.Planning.PlanningSession
        |> MealPlannerApi.Repo.get!(session_id)

      assert reloaded.status == :active
    end

    test "Account owner cancels a peer's session: :ok + session_cancelled broadcast",
         %{account: account, token: owner_token} do
      _ = persist_trial_window!(account, :eligible)

      # Peer user's session.
      peer_user =
        %User{}
        |> User.changeset(%{
          email: "peer-owner-cancel-#{System.unique_integer([:positive])}@example.com",
          name: "Peer Owner Cancel",
          role: :member
        })
        |> Repo.insert!()

      peer_membership_id =
        %AccountMembership{}
        |> AccountMembership.changeset(%{
          account_id: account.id,
          user_id: peer_user.id,
          role: :member,
          status: :active,
          joined_at: DateTime.utc_now()
        })
        |> Repo.insert!()
        |> Map.get(:id)

      {:ok, session} =
        PlanningRepo.create_session(account.id, %{
          range_from: ~D[2026-03-01],
          range_to: ~D[2026-03-08],
          lock_owner_user_id: peer_user.id,
          lock_owner_membership_id: peer_membership_id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
        })

      session_id = session.id

      {:ok, socket} = connect(UserSocket, %{"token" => owner_token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "cancel_planning", %{
          "session_id" => session_id
        })

      assert_reply(ref, :ok, %{"sessionId" => ^session_id})
      assert_push("session_cancelled", %{"sessionId" => ^session_id})

      reloaded =
        MealPlannerApi.Persistence.Planning.PlanningSession
        |> MealPlannerApi.Repo.get!(session_id)

      assert reloaded.status == :cancelled
    end

    test "cancel of a non-existent session returns :not_found", %{
      account: account,
      token: token
    } do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      fake_session_id = Ecto.UUID.generate()

      ref =
        push(socket, "cancel_planning", %{
          "session_id" => fake_session_id
        })

      assert_error_reply(ref, :not_found)
    end
  end

  # ==========================================================================
  # Phase 4 — PR4 `start_planning` lifecycle handler (tasks 4.1 / 4.2).
  # Re-checks Account eligibility (mirroring the join-time guard) and
  # starts a `PlanningSessionServer` for the (account, range) lock. On
  # success the server broadcasts `session_started` on
  # `planning:<account_id>`; on failure (ineligible, overlap, bad range)
  # the channel replies the error envelope with the matching code and never
  # inserts a row.
  # ==========================================================================

  describe "handle_in start_planning (task 4.1 / 4.2)" do
    test "eligible Account + valid range: :ok + session_started broadcast + :active row",
         %{account: account, user: user, token: token} do
      _ = persist_trial_window!(account, :eligible)
      owner_membership_id = owner_membership_id(account.id, user.id)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "start_planning", %{
          "range_from" => in_days(1),
          "range_to" => in_days(7)
        })

      assert_reply(ref, :ok, %{"sessionId" => session_id, "status" => :active})
      assert is_binary(session_id)
      assert_push("session_started", %{"sessionId" => ^session_id})

      reloaded =
        MealPlannerApi.Persistence.Planning.PlanningSession
        |> MealPlannerApi.Repo.get!(session_id)

      assert reloaded.status == :active
      assert reloaded.account_id == account.id
      assert reloaded.lock_owner_user_id == user.id
      assert reloaded.lock_owner_membership_id == owner_membership_id
      assert reloaded.range_from == Date.add(Date.utc_today(), 1)
      assert reloaded.range_to == Date.add(Date.utc_today(), 7)
    end

    test "expired Account (ineligible) returns :subscription_required, no row, no broadcast",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :expired)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "start_planning", %{
          "range_from" => in_days(1),
          "range_to" => in_days(7)
        })

      assert_error_reply(ref, :subscription_required)

      refute_receive %Phoenix.Socket.Broadcast{
                       topic: "planning:" <> _,
                       event: "session_started"
                     },
                     200

      active_count =
        MealPlannerApi.Repo.aggregate(
          from(s in MealPlannerApi.Persistence.Planning.PlanningSession,
            where: s.account_id == ^account.id and s.status == :active
          ),
          :count
        )

      assert active_count == 0
    end

    test "overlapping active range returns :planning_range_locked, only the pre-existing row stays",
         %{account: account, user: owner_user, token: owner_token} do
      _ = persist_trial_window!(account, :eligible)
      owner_membership_id = owner_membership_id(account.id, owner_user.id)

      {:ok, existing} =
        PlanningRepo.create_session(account.id, %{
          range_from: Date.add(Date.utc_today(), 5),
          range_to: Date.add(Date.utc_today(), 12),
          lock_owner_user_id: owner_user.id,
          lock_owner_membership_id: owner_membership_id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
        })

      {:ok, socket} = connect(UserSocket, %{"token" => owner_token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "start_planning", %{
          "range_from" => in_days(10),
          "range_to" => in_days(15)
        })

      assert_error_reply(ref, :planning_range_locked)

      refute_receive %Phoenix.Socket.Broadcast{
                       topic: "planning:" <> _,
                       event: "session_started"
                     },
                     200

      active_sessions =
        MealPlannerApi.Repo.all(
          from(s in MealPlannerApi.Persistence.Planning.PlanningSession,
            where: s.account_id == ^account.id and s.status == :active
          )
        )

      assert length(active_sessions) == 1
      assert hd(active_sessions).id == existing.id
    end

    test "invalid range_from format returns :planning_invalid_range", %{
      account: account,
      token: token
    } do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "start_planning", %{
          "range_from" => "not-a-date",
          "range_to" => "2026-04-07"
        })

      assert_error_reply(ref, :planning_invalid_range)
    end
  end

  # ==========================================================================
  # Phase 4 — PR4 `send_message` handler (tasks 4.7 / 4.8).
  # The channel-layer intake for validated AI intents. Requires:
  #   1. an active `start_planning` (so `session_pid` is cached on the
  #      socket assigns), and
  #   2. a `session_id` payload that matches the cached id.
  # The intent is validated by `PlanningSessionServer.apply_intent/3`,
  # which delegates to `GenerationService.validate_ai_intent/1`.
  # ==========================================================================

  describe "handle_in send_message (task 4.7 / 4.8)" do
    test "valid intent: :ok + PlanningSessionServer.apply_intent accepts it",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # First start a session so the channel caches `session_pid`.
      ref_start =
        push(socket, "start_planning", %{
          "range_from" => in_days(31),
          "range_to" => in_days(37)
        })

      assert_reply(ref_start, :ok, %{"sessionId" => session_id, "status" => :active})
      # Drain the `session_started` broadcast that the server emits on
      # the planning topic, otherwise it sits in the mailbox ahead of
      # the `send_message` reply and `assert_reply` matches the wrong
      # message.
      assert_broadcast("session_started", %{"session_id" => ^session_id})

      # Now apply a valid intent.
      ref =
        push(socket, "send_message", %{
          "session_id" => session_id,
          "intent" => %{
            "kind" => "change_constraints",
            "payload" => %{"budget_cents" => 5000}
          }
        })

      assert_reply(ref, :ok, %{
        "kind" => :change_constraints,
        "payload" => %{"budgetCents" => 5000}
      })
    end

    test "forbidden key inside payload (recipe_id) is rejected by validate_ai_intent",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref_start =
        push(socket, "start_planning", %{
          "range_from" => in_days(38),
          "range_to" => in_days(44)
        })

      assert_reply(ref_start, :ok, %{"sessionId" => session_id, "status" => :active})
      # Drain the `session_started` broadcast emitted by the server so
      # it doesn't sit in the mailbox ahead of the `send_message` reply.
      assert_broadcast("session_started", %{"session_id" => ^session_id})

      ref =
        push(socket, "send_message", %{
          "session_id" => session_id,
          "intent" => %{
            "kind" => "change_constraints",
            "payload" => %{"recipe_id" => "attacker-supplied-id"}
          }
        })

      assert_error_reply(ref, :forbidden_intent)
    end

    test "unknown kind is rejected by validate_ai_intent",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref_start =
        push(socket, "start_planning", %{
          "range_from" => in_days(45),
          "range_to" => in_days(51)
        })

      assert_reply(ref_start, :ok, %{"sessionId" => session_id, "status" => :active})
      assert_broadcast("session_started", %{"session_id" => ^session_id})

      ref =
        push(socket, "send_message", %{
          "session_id" => session_id,
          "intent" => %{
            "kind" => "totally_made_up",
            "payload" => %{}
          }
        })

      assert_error_reply(ref, :unknown_intent)
    end

    test "send_message without an active session returns :no_active_session",
         %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # No start_planning has run, so session_pid is nil.
      ref =
        push(socket, "send_message", %{
          "session_id" => Ecto.UUID.generate(),
          "intent" => %{"kind" => "change_constraints"}
        })

      assert_error_reply(ref, :no_active_session)
    end

    test "session_id payload that doesn't match the cached id returns :session_mismatch",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref_start =
        push(socket, "start_planning", %{
          "range_from" => in_days(52),
          "range_to" => in_days(58)
        })

      assert_reply(ref_start, :ok, %{"sessionId" => started_id, "status" => :active})
      assert_broadcast("session_started", %{"session_id" => ^started_id})

      other_session_id = Ecto.UUID.generate()

      ref =
        push(socket, "send_message", %{
          "session_id" => other_session_id,
          "intent" => %{"kind" => "change_constraints", "payload" => %{}}
        })

      assert_error_reply(ref, :session_mismatch)
    end

    test "session_id that is not a UUID replies :invalid_payload and the channel stays alive",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref_start =
        push(socket, "start_planning", %{
          "range_from" => in_days(59),
          "range_to" => in_days(65)
        })

      assert_reply(ref_start, :ok, %{"sessionId" => session_id, "status" => :active})
      assert_broadcast("session_started", %{"session_id" => ^session_id})

      ref =
        push(socket, "send_message", %{
          "session_id" => "not-a-uuid",
          "intent" => %{"kind" => "change_constraints", "payload" => %{}}
        })

      assert_error_reply(ref, :invalid_payload)

      # The same socket still serves the session it started.
      ref_next =
        push(socket, "send_message", %{
          "session_id" => session_id,
          "intent" => %{"kind" => "change_constraints", "payload" => %{"budget_cents" => 5000}}
        })

      assert_reply(ref_next, :ok, %{"kind" => :change_constraints})
    end

    test "intent the atomizer rejects replies :invalid_payload and the channel stays alive",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref_start =
        push(socket, "start_planning", %{
          "range_from" => in_days(66),
          "range_to" => in_days(72)
        })

      assert_reply(ref_start, :ok, %{"sessionId" => session_id, "status" => :active})
      assert_broadcast("session_started", %{"session_id" => ^session_id})

      # `IntentAtomizer.atomize/1` rejects an intent that is not a map,
      # whichever atoms the VM has loaded.
      ref =
        push(socket, "send_message", %{
          "session_id" => session_id,
          "intent" => "change_constraints"
        })

      assert_error_reply(ref, :invalid_payload)

      # The same socket still serves the session it started.
      ref_next =
        push(socket, "send_message", %{
          "session_id" => session_id,
          "intent" => %{"kind" => "change_constraints", "payload" => %{"budget_cents" => 5000}}
        })

      assert_reply(ref_next, :ok, %{"kind" => :change_constraints})
    end
  end

  # ==========================================================================
  # Phase 5 — e2e 2-socket test (task 5.2).
  # Two distinct members join the same `planning:<account_id>` topic.
  # A starts a session; B tries overlapping (refused) and non-overlapping
  # (succeeds). A cancels — BOTH sockets receive the `session_cancelled`
  # broadcast because both are subscribed to the planning topic.
  # ==========================================================================

  describe "e2e 2-socket on same planning:<account_id> (task 5.2)" do
    test "A starts, B overlap → :planning_range_locked, B non-overlap → :ok, A cancels → both see session_cancelled",
         %{account: account, user: owner_user, token: owner_token} do
      _ = persist_trial_window!(account, :eligible)
      owner_membership_id = owner_membership_id(account.id, owner_user.id)

      # A = owner on the seeded user; B = a brand-new peer member on
      # the same account (different actor_membership_id for cancel auth).
      peer_token = non_owner_peer_token(account)

      # ── A starts a session in 2026-06 ──
      {:ok, socket_a} = connect(UserSocket, %{"token" => owner_token})
      {:ok, _, socket_a} = subscribe_and_join(socket_a, PlanningChannel, "planning:#{account.id}")

      ref_a_start =
        push(socket_a, "start_planning", %{
          "range_from" => in_days(62),
          "range_to" => in_days(68)
        })

      assert_reply(ref_a_start, :ok, %{"sessionId" => a_session_id, "status" => :active})
      assert_push("session_started", %{"sessionId" => ^a_session_id})
      # The test process is subscribed to the topic too: take its raw copy of
      # the broadcast out of the mailbox, so the refute below only sees a new
      # one.
      assert_broadcast("session_started", %{"session_id" => ^a_session_id})
      _ = owner_membership_id

      # ── B joins ──
      {:ok, socket_b} = connect(UserSocket, %{"token" => peer_token})
      {:ok, _, socket_b} = subscribe_and_join(socket_b, PlanningChannel, "planning:#{account.id}")

      # ── B tries an OVERLAPPING range → refused ──
      ref_b_overlap =
        push(socket_b, "start_planning", %{
          "range_from" => in_days(66),
          "range_to" => in_days(72)
        })

      # B is not the owner of the lock, so the error names who holds it.
      assert_receive %Phoenix.Socket.Reply{ref: ^ref_b_overlap, status: :error, payload: locked}
      assert %{"error" => %{"code" => :planning_range_locked, "details" => details}} = locked
      assert %{"ownerName" => owner_name} = details
      assert is_binary(owner_name) and owner_name != ""
      refute_receive %Phoenix.Socket.Broadcast{event: "session_started"}, 200

      # ── B starts a NON-OVERLAPPING range → ok ──
      ref_b_ok =
        push(socket_b, "start_planning", %{
          "range_from" => in_days(76),
          "range_to" => in_days(82)
        })

      assert_reply(ref_b_ok, :ok, %{"sessionId" => b_session_id, "status" => :active})
      assert b_session_id != a_session_id
      assert_push("session_started", %{"sessionId" => ^b_session_id})

      # ── A cancels its session — BOTH sockets should see session_cancelled ──
      ref_a_cancel =
        push(socket_a, "cancel_planning", %{"session_id" => a_session_id})

      assert_reply(ref_a_cancel, :ok, %{"sessionId" => ^a_session_id, "status" => :cancelled})

      # Both A and B receive the event: each channel pushes it to its client.
      assert_push("session_cancelled", %{"sessionId" => ^a_session_id})
      assert_push("session_cancelled", %{"sessionId" => ^a_session_id})
    end
  end

  # ==========================================================================
  # camelCase contract (issue #11): a command is accepted with camelCase keys
  # (snake_case keeps working, see the tests above), and every reply and
  # every event reaches the client with camelCase keys.
  #
  # `assert_push` sees what the client receives, after `handle_out/3`;
  # `assert_broadcast` sees the raw PubSub payload, which is still the
  # snake_case one the broadcasting module built.
  # ==========================================================================

  describe "camelCase commands (issue #11)" do
    test "start_planning, send_message and cancel_planning accept camelCase payloads", %{
      account: account,
      token: token
    } do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref_start =
        push(socket, "start_planning", %{
          "rangeFrom" => in_days(92),
          "rangeTo" => in_days(98)
        })

      assert_reply(ref_start, :ok, start_reply)
      assert %{"sessionId" => session_id, "status" => :active} = start_reply
      assert Map.keys(start_reply) == ["sessionId", "status"]

      # `session_started` is broadcast by `PlanningSessionServer`.
      assert_push("session_started", started)
      assert started == %{"sessionId" => session_id}

      session = Repo.get!(MealPlannerApi.Persistence.Planning.PlanningSession, session_id)
      assert session.range_from == Date.add(Date.utc_today(), 92)
      assert session.range_to == Date.add(Date.utc_today(), 98)

      # The intent is atomized after the normalization: `budgetCents` is not
      # a key the atomizer knows, `budget_cents` is.
      ref_intent =
        push(socket, "send_message", %{
          "sessionId" => session_id,
          "intent" => %{
            "kind" => "change_constraints",
            "payload" => %{"budgetCents" => 5000}
          }
        })

      assert_reply(ref_intent, :ok, intent_reply)

      assert intent_reply == %{
               "kind" => :change_constraints,
               "payload" => %{"budgetCents" => 5000}
             }

      ref_cancel = push(socket, "cancel_planning", %{"sessionId" => session_id})

      assert_reply(ref_cancel, :ok, cancel_reply)
      assert cancel_reply == %{"sessionId" => session_id, "status" => :cancelled}

      assert_push("session_cancelled", cancelled)
      assert cancelled == %{"sessionId" => session_id}
    end

    test "a key sent in both casings resolves to the snake_case one", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # The camelCase id is a UUID of no session (`not_found`); the
      # snake_case one is not a UUID at all, so `invalid_payload` proves it
      # is the one the command read.
      ref =
        push(socket, "cancel_planning", %{
          "session_id" => "not-a-uuid",
          "sessionId" => Ecto.UUID.generate()
        })

      assert_error_reply(ref, :invalid_payload)
    end

    test "a payload that is not a map replies invalid_payload on an unknown event", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      for payload <- ["not a map", ["rangeFrom", "2026-07-01"], 42] do
        ref = push(socket, "totally_unknown_event", payload)

        assert_error_reply(ref, :invalid_payload)
      end
    end
  end

  describe "outbound events (issue #11)" do
    test "every outbound event reaches the client with camelCase keys", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, _socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      cooked_at = ~U[2026-06-15 12:30:00Z]

      # Atom and string keys, a nested list, struct values and a value that
      # looks like a key: only the keys are rewritten.
      payload = %{
        "session_id" => "session_1",
        request_id: "req_1",
        reason: "invalid_date_range",
        date_from: ~D[2026-06-15],
        scheduled_meals: [
          %{recipe_id: "recipe_1", cooked_at: cooked_at, slot_tags: ["quick_meal"]},
          %{recipe_id: "recipe_2", cooked_at: nil, slot_tags: []}
        ]
      }

      expected = %{
        "sessionId" => "session_1",
        "requestId" => "req_1",
        "reason" => "invalid_date_range",
        "dateFrom" => ~D[2026-06-15],
        "scheduledMeals" => [
          %{"recipeId" => "recipe_1", "cookedAt" => cooked_at, "slotTags" => ["quick_meal"]},
          %{"recipeId" => "recipe_2", "cookedAt" => nil, "slotTags" => []}
        ]
      }

      # Only keys are rewritten, except in `generation_error`: it has the same
      # keys whoever broadcast it, so the payload gains the ones it lacked.
      for event <- PlanningChannel.outbound_events() do
        Endpoint.broadcast!("planning:#{account.id}", event, payload)

        expected_for_event =
          if event == "generation_error",
            do: Map.merge(expected, %{"details" => %{}, "runId" => nil}),
            else: expected

        assert_push(^event, pushed)
        assert pushed == expected_for_event, "#{event} was pushed as #{inspect(pushed)}"
      end
    end

    # Why the list below has to be complete: an event the channel does not
    # intercept is sent to the client as it was broadcast.
    test "an event outside the list is not rewritten", %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, _socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      refute "unlisted_probe" in PlanningChannel.outbound_events()

      Endpoint.broadcast!("planning:#{account.id}", "unlisted_probe", %{"session_id" => "s"})

      assert_push("unlisted_probe", %{"session_id" => "s"})
    end

    # Drift guard. The events are collected from the source of every module
    # under `lib` that names the planning topic: each string literal passed
    # straight to a function whose name contains `broadcast` is an event.
    # The list of the channel must be exactly that set, so an event added to
    # any of those modules fails here until it is intercepted.
    test "the outbound list is exactly the set of events broadcast on the planning topic" do
      broadcasters = planning_topic_sources()

      for module_file <- ~w(
            generation/server.ex
            generation/planning_session_server.ex
            generation/planning_session_sweeper.ex
            channels/ai_channel.ex
            channels/planning_channel.ex
          ) do
        assert Enum.any?(broadcasters, &String.ends_with?(&1, module_file)),
               "#{module_file} was not scanned"
      end

      broadcast = broadcasters |> Enum.flat_map(&broadcast_event_literals/1) |> Enum.uniq()
      listed = PlanningChannel.outbound_events()

      assert broadcast -- listed == [],
             "broadcast on the planning topic but not intercepted by PlanningChannel: " <>
               inspect(broadcast -- listed)

      assert listed -- broadcast == [],
             "intercepted by PlanningChannel but broadcast by no module: " <>
               inspect(listed -- broadcast)

      assert listed == Enum.uniq(listed)
    end

    test "the channel intercepts every outbound event" do
      assert Enum.sort(PlanningChannel.__intercepts__()) ==
               Enum.sort(PlanningChannel.outbound_events())
    end

    test "session_expired, broadcast by the sweeper, is pushed in camelCase", %{
      account: account,
      user: user,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, _socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # A lease in the past, so the sweeper expires the session on its
      # first tick.
      {:ok, session} =
        PlanningRepo.create_session(account.id, %{
          range_from: ~D[2026-09-01],
          range_to: ~D[2026-09-07],
          lock_owner_user_id: user.id,
          lock_owner_membership_id: owner_membership_id(account.id, user.id),
          lease_expires_at: DateTime.add(DateTime.utc_now(), -1, :second)
        })

      session_id = session.id

      start_supervised!({Sweeper, interval: 100, name: :planning_channel_test_sweeper},
        id: :planning_channel_test_sweeper
      )

      assert_push("session_expired", pushed, 2_000)
      assert pushed == %{"sessionId" => session_id}
    end

    test "send_intent, broadcast by the AI channel, is pushed in camelCase", %{
      account: account,
      token: token
    } do
      {:ok, planning_socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, _socket} =
        subscribe_and_join(planning_socket, PlanningChannel, "planning:#{account.id}")

      {:ok, ai_socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, ai_socket} =
        subscribe_and_join(ai_socket, AIChannel, "ai_chat:planning_casing")

      push(ai_socket, "new_message", %{
        "message" => "ajusta el budget",
        "intent" => %{
          "kind" => "change_constraints",
          "payload" => %{"budget_cents" => 5000}
        }
      })

      assert_push("send_intent", pushed)

      assert pushed == %{
               "intent" => %{
                 "kind" => :change_constraints,
                 "payload" => %{"budgetCents" => 5000}
               }
             }
    end
  end

  # ==========================================================================
  # Unknown event test
  # ==========================================================================

  describe "handle_in unknown event" do
    test "unknown event returns invalid_payload", %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref = push(socket, "totally_unknown_event", %{})

      assert_error_reply(ref, :invalid_payload)
    end

    # Issue #15 — the older command set is retired. Each of its commands,
    # sent with the keys it used to read, is an unknown event: it replies the
    # envelope and starts no generation and writes no run.
    for event <- ~w(generate_menu swap_constraints chat confirm_proposal reject_proposal) do
      test "the retired #{event} command replies invalid_payload and does nothing", %{
        account: account,
        token: token
      } do
        {:ok, socket} = connect(UserSocket, %{"token" => token})

        {:ok, _reply, socket} =
          subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

        ref =
          push(socket, unquote(event), %{
            "request_id" => "req_retired",
            "proposal_id" => Ecto.UUID.generate(),
            "session_id" => Ecto.UUID.generate(),
            "message" => "Change the menu",
            "base_payload" => %{},
            "constraints" => %{}
          })

        assert_error_reply(ref, :invalid_payload)
        refute_broadcast("generation_started", _)
        refute_broadcast("proposal_rejected", _)

        assert Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) ==
                 []

        assert Repo.aggregate(PlanningGenerationRun, :count) == 0
      end
    end
  end

  # ==========================================================================
  # Payload that is not a map: every command that reads its payload replies
  # `invalid_payload` and the channel process stays alive. The socket has a
  # started session, so `send_message` gets as far as reading its payload and
  # the session proves the channel kept its state. The last test is the same
  # command on a socket without a session: the payload is refused first.
  # ==========================================================================

  describe "handle_in with a payload that is not a map" do
    for event <- ~w(
          start_planning
          send_message
          cancel_planning
        ),
        {kind, payload} <- [
          {"a string", "not a map"},
          {"a list", ["rangeFrom", "2026-07-01"]},
          {"an integer", 42}
        ] do
      test "#{event} with #{kind} replies :invalid_payload and the channel stays alive",
           %{account: account, token: token} do
        _ = persist_trial_window!(account, :eligible)

        {:ok, socket} = connect(UserSocket, %{"token" => token})

        {:ok, _reply, socket} =
          subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

        ref_start =
          push(socket, "start_planning", %{
            "range_from" => in_days(73),
            "range_to" => in_days(79)
          })

        assert_reply(ref_start, :ok, %{"sessionId" => session_id, "status" => :active})
        assert_broadcast("session_started", %{"session_id" => ^session_id})

        ref = push(socket, unquote(event), unquote(payload))

        assert_error_reply(ref, :invalid_payload)

        # The same socket still serves the session it started.
        ref_next =
          push(socket, "send_message", %{
            "session_id" => session_id,
            "intent" => %{"kind" => "change_constraints", "payload" => %{"budget_cents" => 5000}}
          })

        assert_reply(ref_next, :ok, %{"kind" => :change_constraints})
      end
    end

    test "send_message without a session replies :invalid_payload, not :no_active_session",
         %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # No start_planning has run. The payload is refused before the command
      # looks at the socket for a session.
      ref = push(socket, "send_message", "not a map")

      assert_error_reply(ref, :invalid_payload)

      # The channel is alive, and the same command with a map gets as far as
      # the session check.
      ref_next =
        push(socket, "send_message", %{
          "session_id" => Ecto.UUID.generate(),
          "intent" => %{"kind" => "change_constraints"}
        })

      assert_error_reply(ref_next, :no_active_session)
    end
  end

  # ==========================================================================
  # Helper function tests
  # ==========================================================================

  # Resolves the `:active` `AccountMembership` id for the given (account,
  # user) pair. Phase 4 PR4 channel tests use this to assert
  # `lock_owner_membership_id` and to drive `cancel_planning` scenarios.
  defp owner_membership_id(account_id, user_id) do
    MealPlannerApi.Repo.one!(
      from(m in AccountMembership,
        where: m.account_id == ^account_id and m.user_id == ^user_id and m.status == :active
      )
    ).id
  end

  # An `:active` session of the owner of the account, for the
  # `session_resumed` tests.
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

  # Fetches the User that owns the JWT — used by the cancel-planning
  # "non-owner peer" scenario to look up the primary user without
  # resorting to `issue_identity_and_token` again.
  # Mints a token for a brand-new peer user with a `:member` (non-owner)
  # role on the given account. Used to simulate a peer cancelling
  # someone else's session.
  defp non_owner_peer_token(account) do
    peer_user =
      %User{}
      |> User.changeset(%{
        email: "non-owner-peer-#{System.unique_integer([:positive])}@example.com",
        name: "Non Owner Peer",
        role: :member
      })
      |> Repo.insert!()

    {:ok, membership} =
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account.id,
        user_id: peer_user.id,
        role: :member,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert()

    issue_access_v2_token(peer_user, membership)
  end

  # Issue #27 — after a join the channel pushes `session_resumed` when the
  # Account has an :active PlanningSession, so a reconnecting client recovers
  # the pending proposal and the recent chat.
  describe "join/3 session_resumed push" do
    defp insert_proposal(account, user, proposal_json, status \\ :pending) do
      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: account.id,
          user_id: user.id,
          status: :completed,
          input_context: %{},
          started_at: DateTime.utc_now(),
          completed_at: DateTime.utc_now()
        })

      {:ok, proposal} =
        PlanningRepo.create_proposal(%{
          generation_run_id: run.id,
          proposal_json: proposal_json,
          status: status
        })

      proposal
    end

    defp backdate!(record, seconds_ago) do
      record
      |> Ecto.Changeset.change(%{
        inserted_at: DateTime.add(DateTime.utc_now(), -seconds_ago, :second)
      })
      |> Repo.update!()
    end

    defp insert_planning_message(account, session, role, content, intent_kind, seconds_ago) do
      %PlanningMessage{}
      |> PlanningMessage.changeset(%{
        account_id: account.id,
        session_id: session.id,
        role: role,
        content: content,
        intent_kind: intent_kind
      })
      |> Repo.insert!()
      |> backdate!(seconds_ago)
    end

    defp join_planning(account, token) do
      {:ok, socket} = connect(UserSocket, %{"token" => token})
      subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")
    end

    test "pushes nothing when the account has no active session", %{
      account: account,
      user: user,
      token: token
    } do
      insert_proposal(account, user, %{"meals" => []})

      {:ok, _reply, _socket} = join_planning(account, token)

      refute_push "session_resumed", _payload, 200
    end

    test "pushes nothing when the only session is terminal", %{
      account: account,
      user: user,
      token: token
    } do
      session = insert_active_session(account, user)
      {:ok, _} = PlanningRepo.expire_session(account.id, session.id)

      {:ok, _reply, _socket} = join_planning(account, token)

      refute_push "session_resumed", _payload, 200
    end

    test "pushes the session id, latest pending proposal and recent messages in camelCase", %{
      account: account,
      user: user,
      token: token
    } do
      session = insert_active_session(account, user)

      %{"old_marker" => true} |> then(&insert_proposal(account, user, &1)) |> backdate!(60)
      insert_proposal(account, user, %{"rejected_marker" => true}, :rejected)
      latest = insert_proposal(account, user, %{"meals" => [%{"recipe_id" => 7}]})

      insert_planning_message(account, session, :user, "second", nil, 10)
      insert_planning_message(account, session, :assistant, "third", "change_constraints", 5)
      insert_planning_message(account, session, :user, "first", nil, 20)

      {:ok, _reply, _socket} = join_planning(account, token)

      assert_push "session_resumed", payload
      assert_camel_case_keys(payload)

      assert payload["sessionId"] == session.id
      assert payload["proposalId"] == latest.id
      assert payload["proposal"] == %{"meals" => [%{"recipeId" => 7}]}

      assert [
               %{"role" => "user", "content" => "first", "intentKind" => nil},
               %{"role" => "user", "content" => "second", "intentKind" => nil},
               %{
                 "role" => "assistant",
                 "content" => "third",
                 "intentKind" => "change_constraints"
               }
             ] = payload["messages"]
    end

    test "pushes a null proposal when the session has none pending", %{
      account: account,
      user: user,
      token: token
    } do
      session = insert_active_session(account, user)

      {:ok, _reply, _socket} = join_planning(account, token)

      assert_push "session_resumed", payload
      assert payload["sessionId"] == session.id
      assert payload["proposalId"] == nil
      assert payload["proposal"] == nil
      assert payload["messages"] == []
    end

    test "a pending proposal from before the session started is not pushed", %{
      account: account,
      user: user,
      token: token
    } do
      insert_proposal(account, user, %{"stale_marker" => true}) |> backdate!(60)
      session = insert_active_session(account, user)

      {:ok, _reply, _socket} = join_planning(account, token)

      assert_push "session_resumed", payload
      assert payload["sessionId"] == session.id
      assert payload["proposalId"] == nil
      assert payload["proposal"] == nil
    end

    test "a pending proposal created after the session started is pushed", %{
      account: account,
      user: user,
      token: token
    } do
      insert_proposal(account, user, %{"stale_marker" => true}) |> backdate!(60)
      session = insert_active_session(account, user)
      fresh = insert_proposal(account, user, %{"meals" => []})

      {:ok, _reply, _socket} = join_planning(account, token)

      assert_push "session_resumed", payload
      assert payload["sessionId"] == session.id
      assert payload["proposalId"] == fresh.id
    end

    test "keeps only the last 20 messages, oldest first", %{
      account: account,
      user: user,
      token: token
    } do
      session = insert_active_session(account, user)

      for n <- 1..25 do
        insert_planning_message(account, session, :user, "m#{n}", nil, 100 - n)
      end

      {:ok, _reply, _socket} = join_planning(account, token)

      assert_push "session_resumed", payload
      contents = Enum.map(payload["messages"], & &1["content"])
      assert contents == Enum.map(6..25, &"m#{&1}")
    end

    test "another account's active session is not pushed", %{account: account, token: token} do
      {:ok, other_user, other_account, _other_token} =
        issue_identity_and_token("u_plan_other", "acct_plan_other")

      other_session = insert_active_session(other_account, other_user)
      insert_proposal(other_account, other_user, %{"secret" => true})
      insert_planning_message(other_account, other_session, :user, "secret chat", nil, 1)

      {:ok, _reply, _socket} = join_planning(account, token)

      refute_push "session_resumed", _payload, 200
    end

    test "own session never carries another account's proposal or messages", %{
      account: account,
      user: user,
      token: token
    } do
      {:ok, other_user, other_account, _other_token} =
        issue_identity_and_token("u_plan_other2", "acct_plan_other2")

      other_session = insert_active_session(other_account, other_user)
      insert_proposal(other_account, other_user, %{"secret" => true})
      insert_planning_message(other_account, other_session, :user, "secret chat", nil, 1)

      session = insert_active_session(account, user)

      {:ok, _reply, _socket} = join_planning(account, token)

      assert_push "session_resumed", payload
      assert payload["sessionId"] == session.id
      assert payload["proposal"] == nil
      assert payload["messages"] == []
    end

    # Jorge F1 on #146 — a generation stores an empty placeholder proposal when
    # it starts. Pushed before the generation ends, the app would take it as a
    # ready plan with no days and drop the real one.
    test "pushes no proposal while the generation that holds it is still running", %{
      account: account,
      user: user,
      token: token
    } do
      session = insert_active_session(account, user)

      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: account.id,
          user_id: user.id,
          status: :processing,
          input_context: %{},
          started_at: DateTime.utc_now()
        })

      {:ok, _placeholder} =
        PlanningRepo.create_proposal(%{
          generation_run_id: run.id,
          proposal_json: %{slots: []},
          status: :pending
        })

      {:ok, _reply, _socket} = join_planning(account, token)

      assert_push "session_resumed", payload
      assert payload["sessionId"] == session.id
      assert payload["proposalId"] == nil
      assert payload["proposal"] == nil
    end

    # Issue #146 — the app rebuilds its draft from the proposal of
    # `session_resumed`, so a generation proposal comes in the shape of
    # `proposal_ready`.
    test "pushes a generation proposal in the shape of proposal_ready", %{
      account: account,
      user: user,
      token: token
    } do
      insert_active_session(account, user)

      proposal =
        insert_proposal(account, user, %{
          "slots" => [
            %{
              "slot_key" => "2030-01-01_lunch",
              "recipe_id" => "recipe-1",
              "recipe_name" => "Soup",
              "price_cents" => 500,
              "macros" => %{"protein_g" => 10, "carbs_g" => 20, "calories" => 300}
            }
          ]
        })

      {:ok, _reply, _socket} = join_planning(account, token)

      assert_push "session_resumed", payload

      assert payload["proposal"] == %{
               "proposalId" => proposal.id,
               "runId" => proposal.generation_run_id,
               "estimatedCostCents" => 500,
               "days" => [
                 %{
                   "date" => "2030-01-01",
                   "costCents" => 500,
                   "meals" => [
                     %{
                       "slot" => "lunch",
                       "recipeId" => "recipe-1",
                       "recipeName" => "Soup",
                       "priceCents" => 500,
                       "macros" => %{"proteinG" => 10, "carbsG" => 20, "calories" => 300}
                     }
                   ]
                 }
               ]
             }
    end

    # Issue #146 — the session server broadcasts `session_resumed` with the
    # session id alone when it restarts; every joined socket gets the payload
    # of a join.
    test "a session_resumed broadcast reaches each socket with the full payload", %{
      account: account,
      user: user,
      token: token
    } do
      session = insert_active_session(account, user)
      proposal = insert_proposal(account, user, %{"meals" => []})

      {:ok, _reply, _socket} = join_planning(account, token)
      assert_push "session_resumed", _join_payload

      insert_planning_message(account, session, :user, "after the join", nil, 1)

      Phoenix.Channel.Server.broadcast!(
        MealPlannerApi.PubSub,
        "planning:#{account.id}",
        "session_resumed",
        %{"session_id" => session.id}
      )

      assert_push "session_resumed", payload
      assert payload["sessionId"] == session.id
      assert payload["proposalId"] == proposal.id

      assert [%{"role" => "user", "content" => "after the join", "intentKind" => nil}] =
               payload["messages"]
    end
  end

  describe "helper functions behavior" do
    test "build_request_id generates unique ids", %{
      account: account,
      token: token
    } do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      start_generation_server_stub(account.id, {:error, :invalid_date_range})

      # Push without explicit request_id - server should auto-generate
      ref = push(socket, "start_planning", %{"range_from" => in_days(1), "day_count" => 2})

      # The error reply carries the generated id
      payload = assert_error_reply(ref, :invalid_date_range)
      assert "req_" <> _ = payload["requestId"]
    end

    test "an atom reason from a guard is replied as its allowlisted code", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # The favorites guard answers an atom reason, replied as the code of the
      # envelope
      ref =
        push(socket, "start_planning", %{
          "range_from" => in_days(1),
          "day_count" => 2,
          "favorite_recipe_ids" => "not-a-list"
        })

      assert_error_reply(ref, :invalid_payload)
    end
  end

  # ==========================================================================
  # Error envelope (issue #11): a failed join or command replies
  # `%{error: %{code, message}}` with an allowlisted code. The helpers below
  # check that shape on every error reply of this file.
  # ==========================================================================

  describe "error envelope" do
    test "an error reply never contains a reason key", %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      assert {:error, join_payload} =
               subscribe_and_join(socket, PlanningChannel, "planning:other_account_id")

      refute has_reason_key?(join_payload)

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      failing_commands = [
        {"totally_unknown_event", %{}},
        {"start_planning", %{"range_from" => "not-a-date", "range_to" => "2026-04-07"}},
        {"send_message", %{"session_id" => Ecto.UUID.generate(), "intent" => %{}}},
        {"cancel_planning", %{"session_id" => "not-a-uuid"}}
      ]

      for {event, command_payload} <- failing_commands do
        ref = push(socket, event, command_payload)

        assert_receive %Phoenix.Socket.Reply{ref: ^ref, status: :error, payload: payload}
        refute has_reason_key?(payload), "#{event} replied a reason: #{inspect(payload)}"
        assert %{"error" => %{"code" => code, "message" => message}} = payload
        assert is_atom(code) and is_binary(message), "#{event} replied #{inspect(payload)}"
      end
    end

    test "a reply that carried request_id keeps it next to the error", %{
      account: account,
      token: token
    } do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      start_generation_server_stub(account.id, {:error, :invalid_date_range})

      ref =
        push(socket, "start_planning", %{
          "request_id" => "start_req_correlated",
          "range_from" => in_days(1),
          "day_count" => 2
        })

      payload = assert_error_reply(ref, :invalid_date_range)

      assert Map.keys(payload) == ["error", "requestId"]
      assert payload["requestId"] == "start_req_correlated"
    end

    test "a reason outside the allowlist replies unknown_error and is logged", %{
      account: account,
      token: token
    } do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # A generation server that answers a reason no service chose and the
      # allowlist does not hold.
      start_generation_server_stub(account.id, {:error, {:storage_fault, "disk on fire"}})

      log =
        capture_log(fn ->
          ref = push(socket, "start_planning", %{"range_from" => in_days(1), "day_count" => 2})

          payload = assert_error_reply(ref, :unknown_error)
          refute inspect(payload) =~ "storage_fault"
          refute inspect(payload) =~ "disk on fire"
        end)

      assert log =~ "unknown_error"
      assert log =~ "storage_fault"
    end

    test "a changeset error is replied as invalid_payload, without its details", %{
      account: account,
      token: token
    } do
      _ = persist_trial_window!(account, :eligible)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # A generation server that answers a changeset: neither an atom nor a
      # string reason.
      start_generation_server_stub(
        account.id,
        {:error, %Ecto.Changeset{valid?: false, errors: [name: {"is invalid", []}]}}
      )

      ref = push(socket, "start_planning", %{"range_from" => in_days(1), "day_count" => 2})

      payload = assert_error_reply(ref, :invalid_payload)
      refute inspect(payload) =~ "is invalid"
    end
  end

  # Asserts the error reply for `ref` is the envelope with `code` and nothing
  # else, `requestId` aside, and returns the payload.
  defp assert_error_reply(ref, code) do
    assert_receive %Phoenix.Socket.Reply{ref: ^ref, status: :error, payload: payload}

    assert_error_envelope(payload, code)
  end

  defp assert_join_error(result, code) do
    assert {:error, payload} = result

    assert_error_envelope(payload, code)
  end

  # A connected socket whose access token carries `exp` as its expiry claim:
  # the state of a socket that stayed open while its token aged.
  defp with_token_expiry(socket, exp) do
    Phoenix.Socket.assign(socket, :claims, Map.put(socket.assigns.claims, "exp", exp))
  end

  defp assert_error_envelope(payload, code) do
    assert %{"error" => %{"code" => ^code, "message" => message} = error} = payload
    assert is_binary(message) and message != ""
    assert Map.keys(error) == ["code", "message"]
    assert Map.keys(payload) -- ["requestId"] == ["error"]

    payload
  end

  # Registers a process as the generation server of the account. It answers
  # `reply` to the first call it receives, whatever the call is.
  defp start_generation_server_stub(account_id, reply) do
    test_pid = self()

    spawn_link(fn ->
      {:ok, _owner} =
        Registry.register(
          MealPlannerApi.Generation.Generations,
          {:generation, account_id},
          nil
        )

      send(test_pid, :generation_server_stub_registered)

      receive do
        {:"$gen_call", from, _request} -> GenServer.reply(from, reply)
      end
    end)

    assert_receive :generation_server_stub_registered
  end

  # The source files under `lib` that name the planning topic. A module has
  # to spell `"planning:` to build the topic it broadcasts on.
  defp planning_topic_sources do
    [__DIR__, "../../../lib/**/*.ex"]
    |> Path.join()
    |> Path.expand()
    |> Path.wildcard()
    |> Enum.filter(&(File.read!(&1) =~ ~s("planning:)))
  end

  # The string literals passed straight to a call of a function whose name
  # contains `broadcast`, local or remote: `broadcast!(socket, "event", _)`,
  # `broadcast(state, "event", _)`, `Server.broadcast!(pubsub, topic, "event",
  # _)`. A topic is built by interpolation, so it is not a literal.
  #
  # In `planning_channel.ex` a literal passed to `push/3` counts too: the
  # channel derives `planning_message` from the generation's `proposal_ready`
  # and pushes it to the client without broadcasting it. Other modules push on
  # their own channels (`AIChannel`), which is not this topic.
  defp broadcast_event_literals(path) do
    {_ast, events} =
      path
      |> File.read!()
      |> Code.string_to_quoted!()
      |> Macro.prewalk([], fn
        {{:., _, [_module, name]}, _meta, args} = node, events when is_atom(name) ->
          {node, events ++ event_literals(name, args, path)}

        {name, _meta, args} = node, events when is_atom(name) and is_list(args) ->
          {node, events ++ event_literals(name, args, path)}

        node, events ->
          {node, events}
      end)

    events
  end

  defp event_literals(name, args, path) do
    pushes? = name == :push and String.ends_with?(path, "channels/planning_channel.ex")

    if pushes? or name |> Atom.to_string() |> String.contains?("broadcast") do
      Enum.filter(args, &is_binary/1)
    else
      []
    end
  end

  # The old reply shape, in either spelling of the key.
  defp has_reason_key?(payload),
    do: Map.has_key?(payload, :reason) or Map.has_key?(payload, "reason")
end
