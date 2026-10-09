defmodule MealPlannerApiWeb.PlanningChannelTest do
  use MealPlannerApiWeb.ChannelCase, async: false

  import Ecto.Query, warn: false
  import ExUnit.CaptureLog
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Data.{PlanningRepo, RecipeRepo, ShoppingRepo}
  alias MealPlannerApi.Generation.PlanningSession.Sweeper
  alias MealPlannerApi.Generation.Server
  alias MealPlannerApi.Persistence.Accounts.Account, as: PersistenceAccount
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.{AIChannel, Endpoint, PlanningChannel, UserSocket}

  import MealPlannerApi.Generation.ServerTestFixtures, only: [stop_generation_server: 1]
  import MealPlannerApiWeb.CasingAssertions, only: [assert_camel_case_keys: 1]
  import MealPlannerApiWeb.ChannelHelpers, only: [issue_identity_and_token: 2]

  # The channel logs a warning for every reason it replies as `unknown_error`;
  # the log of a test is printed only when the test fails.
  @moduletag :capture_log

  setup do
    _ = intent_atoms()

    {:ok, user, account, token} = issue_identity_and_token("u_plan_test", "acct_plan_test")

    # Every test of this file gets the same account id, and a generation
    # server registers under it. A test that makes `generate_menu` start one
    # stops it itself (`stop_generation_server/1`); this covers a test that
    # fails before it gets there, so the server it left does not answer the
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
        |> MealPlannerApi.Persistence.Accounts.AccountMembership.changeset(%{status: :invited})
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
  # generate_menu tests
  # ==========================================================================

  describe "handle_in generate_menu" do
    test "generates response with request_id", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "generate_menu", %{
          "request_id" => "test_req_1",
          "constraints" => %{}
        })

      # No generation server is running, so the command starts one and
      # replies ok with the request id.
      assert_reply(ref, :ok, %{"requestId" => "test_req_1"})

      stop_generation_server(account.id)
    end

    test "cold start: starts a generation server for the account and replies ok", %{
      account: account,
      user: user,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # No generation server is running for the account.
      assert Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) ==
               []

      {run_id, log} =
        with_log(fn ->
          ref =
            push(socket, "generate_menu", %{
              "request_id" => "gen_cold_start",
              "constraints" => %{"participant_ids" => [user.id]}
            })

          assert_reply(ref, :ok, reply)
          assert %{"requestId" => "gen_cold_start", "runId" => run_id} = reply
          assert Map.keys(reply) == ["requestId", "runId"]
          assert is_binary(run_id)

          run_id
        end)

      refute log =~ "unknown_error"

      assert_push("generation_started", %{"requestId" => "gen_cold_start", "runId" => ^run_id})

      # The server registered for the account is the one that took the run.
      assert [{server_pid, _value}] =
               Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id})

      assert %{current_run_id: ^run_id} = Server.get_status(account.id)

      stop_generation_server(account.id)
      refute Process.alive?(server_pid)
    end

    test "error when Server.start_generation fails with a fault", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # A generation server that answers a fault: a reason no service chose
      # and the allowlist does not hold.
      start_generation_server_stub(account.id, {:error, {:storage_fault, "disk on fire"}})

      ref =
        push(socket, "generate_menu", %{
          "request_id" => "test_req_fault",
          "constraints" => %{}
        })

      # Should receive error reply, with the fallback code and the request id.
      payload = assert_error_reply(ref, :unknown_error)
      assert payload["requestId"] == "test_req_fault"
      refute inspect(payload) =~ "storage_fault"

      # The `generation_error` event falls back on its own for a reason that
      # is neither an atom nor a string.
      assert_push("generation_error", %{
        "requestId" => "test_req_fault",
        "reason" => "invalid_payload"
      })
    end

    # The window of a generation (its dates) and the constraints themselves
    # are refused before a generation starts: the reply is the envelope with
    # the request id, the event keeps its reason, and no generation server is
    # started for the account.
    for {label, constraints, code, reason} <- [
          {"a malformed date", %{"date_from" => "not-a-date"}, :invalid_date, "invalid_date"},
          {"a range that ends before it starts",
           %{"date_from" => "2026-02-07", "date_to" => "2026-02-01"}, :invalid_date_range,
           "invalid_date_range"},
          {"a range of eight days", %{"date_from" => "2026-02-01", "date_to" => "2026-02-08"},
           :invalid_date_range, "invalid_date_range"},
          {"constraints that are null", nil, :invalid_payload, "invalid_payload"},
          {"constraints that are a string", "2026-02-01", :invalid_payload, "invalid_payload"}
        ] do
      test "#{label} replies #{code} and starts no generation", %{
        account: account,
        token: token
      } do
        {:ok, socket} = connect(UserSocket, %{"token" => token})

        {:ok, _reply, socket} =
          subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

        ref =
          push(socket, "generate_menu", %{
            "request_id" => "gen_refused",
            "constraints" => unquote(Macro.escape(constraints))
          })

        payload = assert_error_reply(ref, unquote(code))
        assert payload["requestId"] == "gen_refused"

        assert_push("generation_error", %{
          "requestId" => "gen_refused",
          "reason" => unquote(reason)
        })

        assert Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) ==
                 []

        # The channel is alive, and a chat finds no generation to talk to.
        ref_next = push(socket, "chat", %{"proposal_id" => "999", "message" => "Hello"})

        assert_error_reply(ref_next, :no_active_generation)
      end
    end
  end

  # ==========================================================================
  # swap_constraints tests
  # ==========================================================================

  describe "handle_in swap_constraints" do
    test "returns response with request_id", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "swap_constraints", %{
          "request_id" => "swap_req_1",
          "base_payload" => %{"date_from" => "2026-06-15", "date_to" => "2026-06-21"},
          "constraints" => %{"budget_cents" => 5000}
        })

      # Should push generation_started and return ok with proposal
      assert_push("generation_started", %{
        "requestId" => "swap_req_1",
        "reason" => "constraint_update"
      })

      # Response should include the request id
      assert_receive %{ref: ^ref, payload: %{"requestId" => "swap_req_1"}}
    end

    test "broadcasts error when service fails", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Pass invalid date range (date_to before date_from)
      ref =
        push(socket, "swap_constraints", %{
          "request_id" => "swap_req_error",
          "base_payload" => %{"date_from" => "2026-06-21", "date_to" => "2026-06-15"},
          "constraints" => %{}
        })

      payload = assert_error_reply(ref, :invalid_date_range)
      assert payload["requestId"] == "swap_req_error"

      # The `generation_error` event is not a command reply and keeps its
      # `reason` field, value included.
      assert_push("generation_error", %{
        "requestId" => "swap_req_error",
        "reason" => "invalid_date_range"
      })
    end

    test "a malformed date replies invalid_date and is not logged as a fault", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # `Date.from_iso8601/1` answers `:invalid_format` for a string that is
      # not a date: a mistake of the client, not a fault of the server.
      log =
        capture_log(fn ->
          ref =
            push(socket, "swap_constraints", %{
              "request_id" => "swap_req_malformed_date",
              "base_payload" => %{"date_from" => "not-a-date"},
              "constraints" => %{}
            })

          payload = assert_error_reply(ref, :invalid_date)
          assert payload["requestId"] == "swap_req_malformed_date"
        end)

      refute log =~ "unknown_error"
      refute log =~ "invalid_format"
    end
  end

  # ==========================================================================
  # chat tests
  # ==========================================================================

  describe "handle_in chat" do
    test "error when no active generation", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # No generation started, so chat should fail
      ref =
        push(socket, "chat", %{
          "proposal_id" => "123",
          "message" => "Change the menu"
        })

      assert_error_reply(ref, :no_active_generation)
    end

    test "missing proposal_id returns error", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Missing proposal_id falls through to unknown event
      ref =
        push(socket, "chat", %{
          "message" => "Hello"
        })

      assert_error_reply(ref, :invalid_payload)
    end

    test "success when GenerationServer is running", %{
      account: account,
      user: user,
      token: token
    } do
      # Create recipe so generation can potentially work
      {:ok, _recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "Test Recipe Chat",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Start generation first to have GenerationServer running
      ref_gen =
        push(socket, "generate_menu", %{
          "request_id" => "chat_req_init",
          "constraints" => %{}
        })

      # The ok reply means the server is started and registered
      assert_reply(ref_gen, :ok, %{"requestId" => "chat_req_init", "runId" => run_id})

      # The server answers a call once the generation it is running has
      # finished, so the chat below does not wait behind the pipeline. The
      # call has to come before the chat is pushed: the channel process
      # casts the chat, and a call of the test process sent after the push
      # could reach the server ahead of that cast.
      assert %{current_run_id: ^run_id} = Server.get_status(account.id)

      # Now send chat message - should find GenerationServer
      _ref_chat =
        push(socket, "chat", %{
          "proposal_id" => "999",
          "message" => "Remove tomatoes from the menu"
        })

      # chat returns noreply (cast to GenServer): the GenerationServer
      # responds via broadcast. The message is not a modification the server
      # understands, and that is what it announces.
      assert_push("generation_error", %{"reason" => "invalid_modification"})

      stop_generation_server(account.id)
    end
  end

  # ==========================================================================
  # confirm_proposal tests
  # ==========================================================================

  describe "handle_in confirm_proposal" do
    test "missing session_id is rejected with :missing_session_id before any DB lookup", %{
      account: account,
      user: user,
      token: token
    } do
      {:ok, _recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "Test Recipe Confirm",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # PR2 — session_id is required; the payload guard fires before
      # proposal_id is even checked, so the well-formed fake proposal_id
      # never reaches `Server.do_confirm/3`.
      fake_uuid = Ecto.UUID.generate()

      ref =
        push(socket, "confirm_proposal", %{
          "proposal_id" => fake_uuid
        })

      assert_error_reply(ref, :missing_session_id)
    end

    test "invalid session_id format returns :missing_session_id", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "confirm_proposal", %{
          "proposal_id" => Ecto.UUID.generate(),
          "session_id" => "not-uuid"
        })

      assert_error_reply(ref, :missing_session_id)
    end

    test "invalid proposal_id format returns :invalid_proposal_id", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Use a TRULY malformed UUID — too short, contains non-hex chars.
      # (Strings like "not-a-valid-uuid" happen to be 36 ASCII bytes
      # that parse as a valid hex UUID, which would slip past the
      # cast check.)
      ref =
        push(socket, "confirm_proposal", %{
          "proposal_id" => "not-uuid",
          "session_id" => Ecto.UUID.generate()
        })

      assert_error_reply(ref, :invalid_proposal_id)
    end

    # @task 4.3 — channel-layer end-to-end test: confirms that the cart
    # fields (`shoppingItemsCount`, `checkoutSessionId`, `cart`) flow
    # through both the direct reply and the `proposal_confirmed`
    # event. This is the first test that exercises the registered
    # `Generation.Server` path (not the `PlanningChatService` fallback).
    #
    # Issue #11 — the command is accepted in both casings, and the reply and
    # the event `Generation.Server` broadcasts reach the client in camelCase,
    # the nested `cart` list included.
    for {casing, proposal_key, session_key} <- [
          {"snake_case", "proposal_id", "session_id"},
          {"camelCase", "proposalId", "sessionId"}
        ] do
      test "confirm reply AND proposal_confirmed push carry cart fields end-to-end " <>
             "(#{casing} command)",
           %{account: account, user: user, token: token} do
        confirm_payload = fn proposal_id, session_id ->
          %{unquote(proposal_key) => proposal_id, unquote(session_key) => session_id}
        end

        assert_confirm_carries_cart_fields(account, user, token, confirm_payload)
      end
    end

    defp assert_confirm_carries_cart_fields(account, user, token, confirm_payload) do
      # Seed: a recipe with one ingredient, a proposal with one slot.
      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "4-3 recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, flour} =
        Catalog.create_ingredient(%{name: "4-3 flour", category: :granos})

      {:ok, _ri} =
        RecipeRepo.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: flour.id,
          quantity_milli: 750_000,
          unit: :g
        })

      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: account.id,
          user_id: user.id,
          status: :processing,
          started_at: DateTime.utc_now(),
          input_context: %{}
        })

      {:ok, proposal} =
        PlanningRepo.create_proposal(%{
          generation_run_id: run.id,
          status: :pending,
          proposal_json: %{
            slots: [
              %{
                slot_key: "2026-08-08_lunch",
                date: "2026-08-08",
                slot: "lunch",
                recipe_id: recipe.id,
                recipe_name: "4-3 recipe",
                price_cents: 1000
              }
            ]
          }
        })

      flour_id = flour.id

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Register a Generation.Server under the account's registry with the
      # joined channel's pid so `proposal_confirmed` is broadcast back
      # onto `planning:<account_id>`, which the test process is subscribed
      # to (via `subscribe_and_join`/`assert_broadcast`).
      start_supervised!(
        {Server, account_id: account.id, user_id: user.id, channel_pid: socket.channel_pid},
        id: {:channel_server, account.id, :cart_payload_test}
      )

      # PR2 — pre-create the session lock so `do_confirm/3`'s pre-check
      # passes and the full atomic pipeline runs.
      session = insert_active_session(account, user)

      ref = push(socket, "confirm_proposal", confirm_payload.(proposal.id, session.id))

      assert_reply(
        ref,
        :ok,
        %{
          "shoppingItemsCount" => 1,
          "checkoutSessionId" => checkout_session_id,
          "cart" => [
            %{"ingredientId" => ingredient_id, "unit" => :g, "quantityMilli" => 750_000}
          ]
        } = reply
      )

      assert is_binary(checkout_session_id)
      assert ingredient_id == flour_id
      assert_camel_case_keys(reply)

      # The raw PubSub payload `Generation.Server` broadcasts is still
      # snake_case; the client receives what `handle_out/3` pushes.
      assert_push(
        "proposal_confirmed",
        %{
          "shoppingItemsCount" => 1,
          "checkoutSessionId" => pushed_session_id,
          "cart" => [
            %{"ingredientId" => pushed_ingredient_id, "unit" => :g, "quantityMilli" => 750_000}
          ]
        } = pushed
      )

      assert pushed_session_id == checkout_session_id
      assert pushed_ingredient_id == flour_id
      assert_camel_case_keys(pushed)

      # PR2 — the session row must be :committed by the same transaction
      # that wrote the cart and meals. The cart-payload test now also
      # proves AC #4 atomicity at the channel boundary.
      reloaded =
        MealPlannerApi.Repo.get!(
          MealPlannerApi.Persistence.Planning.PlanningSession,
          session.id
        )

      assert reloaded.status == :committed
      assert reloaded.terminal_at != nil
    end

    test "re-confirming an already-accepted proposal returns :already_confirmed and emits no proposal_confirmed",
         %{
           account: account,
           user: user,
           token: token
         } do
      {:ok, _recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "4-3 idemp",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: account.id,
          user_id: user.id,
          status: :processing,
          started_at: DateTime.utc_now(),
          input_context: %{}
        })

      {:ok, proposal} =
        PlanningRepo.create_proposal(%{
          generation_run_id: run.id,
          status: :accepted,
          proposal_json: %{slots: []}
        })

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      start_supervised!(
        {Server, account_id: account.id, user_id: user.id, channel_pid: socket.channel_pid},
        id: {:channel_server, account.id, :already_confirmed_test}
      )

      # PR2 — provide a session_id; the `:already_confirmed` short-circuit
      # runs BEFORE the session check, so this is just a sanity UUID.
      session = insert_active_session(account, user)

      ref =
        push(socket, "confirm_proposal", %{
          "proposal_id" => proposal.id,
          "session_id" => session.id
        })

      assert_error_reply(ref, :already_confirmed)

      # No `proposal_confirmed` broadcast should follow the rejection.
      refute_receive %Phoenix.Socket.Broadcast{
                       topic: "planning:" <> _,
                       event: "proposal_confirmed"
                     },
                     100
    end

    # Regression for review blocker R4-001: a failed `schedule_meal/1`
    # MUST roll back the proposal status flip and the cart writes.
    test "failed scheduled_meal insert rolls back proposal status, meals, and cart",
         %{account: account, user: user, token: token} do
      missing_recipe_id = Ecto.UUID.generate()

      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: account.id,
          user_id: user.id,
          status: :processing,
          started_at: DateTime.utc_now(),
          input_context: %{}
        })

      {:ok, proposal} =
        PlanningRepo.create_proposal(%{
          generation_run_id: run.id,
          status: :pending,
          proposal_json: %{
            slots: [%{slot_key: "2026-08-09_lunch", recipe_id: missing_recipe_id}]
          }
        })

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      start_supervised!(
        {Server, account_id: account.id, user_id: user.id, channel_pid: socket.channel_pid},
        id: {:channel_server, account.id, :rollback_test}
      )

      session = insert_active_session(account, user)

      ref =
        push(socket, "confirm_proposal", %{
          "proposal_id" => proposal.id,
          "session_id" => session.id
        })

      assert_error_reply(ref, :transaction_failed)

      reloaded = Repo.get!(MealPlannerApi.Persistence.Planning.PlanningProposal, proposal.id)
      assert reloaded.status == :pending

      assert PlanningRepo.list_scheduled_meals(account.id, ~D[2026-01-01], ~D[2026-12-31]) == []

      assert ShoppingRepo.list_checkout_sessions(account.id) == []

      # PR2 — the session MUST stay :active after the rollback; the
      # :committed transition runs inside the same Multi as the meals
      # and cart writes and rolls back atomically.
      reloaded_session =
        MealPlannerApi.Repo.get!(
          MealPlannerApi.Persistence.Planning.PlanningSession,
          session.id
        )

      assert reloaded_session.status == :active
      assert reloaded_session.terminal_at == nil
    end

    # PR2 of issue #35 — Foreign-lock rejection at the channel boundary.
    # A session that belongs to ANOTHER Account must be refused before
    # any write — `:foreign_lock` reply, no proposal flip, no
    # proposal_confirmed broadcast.
    test "foreign-lock session is rejected with :foreign_lock, no writes fire", %{
      account: account,
      user: user,
      token: token
    } do
      _ = persist_trial_window!(account, :eligible)

      # Peer account with its own session owned by a peer user.
      peer_account =
        %PersistenceAccount{}
        |> PersistenceAccount.changeset(%{
          name: "PR2 Foreign Peer",
          plan: :family_4,
          default_budget_cents: 0,
          subscription_plan_id:
            MealPlannerApi.Repo.get_by!(MealPlannerApi.Subscriptions.Plan, name: "family_4").id
        })
        |> MealPlannerApi.Repo.insert!()

      peer_user =
        %MealPlannerApi.Persistence.Accounts.User{}
        |> MealPlannerApi.Persistence.Accounts.User.changeset(%{
          email: "pr2-foreign-peer@example.com",
          name: "PR2 Foreign Peer",
          role: :owner
        })
        |> MealPlannerApi.Repo.insert!()

      # peer_user needs an :active membership on peer_account so the
      # session row can be created with a valid lock_owner_membership_id.
      %MealPlannerApi.Persistence.Accounts.AccountMembership{}
      |> MealPlannerApi.Persistence.Accounts.AccountMembership.changeset(%{
        account_id: peer_account.id,
        user_id: peer_user.id,
        role: :owner,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> MealPlannerApi.Repo.insert!()

      foreign_session = insert_active_session(peer_account, peer_user)

      # The current membership's account (driven by `token`) has a
      # proposal it tries to confirm with the FOREIGN session id.
      {:ok, _recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "PR2 foreign recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: account.id,
          user_id: user.id,
          status: :processing,
          started_at: DateTime.utc_now(),
          input_context: %{}
        })

      {:ok, proposal} =
        PlanningRepo.create_proposal(%{
          generation_run_id: run.id,
          status: :pending,
          proposal_json: %{slots: []}
        })

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      start_supervised!(
        {Server, account_id: account.id, user_id: user.id, channel_pid: socket.channel_pid},
        id: {:channel_server, account.id, :foreign_lock_test}
      )

      ref =
        push(socket, "confirm_proposal", %{
          "proposal_id" => proposal.id,
          "session_id" => foreign_session.id
        })

      assert_error_reply(ref, :foreign_lock)

      # The proposal stays :pending — pre-check fired before any write.
      reloaded_proposal =
        Repo.get!(MealPlannerApi.Persistence.Planning.PlanningProposal, proposal.id)

      assert reloaded_proposal.status == :pending

      refute_receive %Phoenix.Socket.Broadcast{
                       topic: "planning:" <> _,
                       event: "proposal_confirmed"
                     },
                     100
    end

    # PR2 of issue #35 — AC #1 proof at the channel boundary. When
    # `:revenuecat_access_enforcement` is enabled and the Account is
    # expired, `confirm_proposal` returns `:account_expired` BEFORE
    # `Server.do_confirm/3` is invoked. The pre-existing session stays
    # `:active` and no proposal flip occurs.
    #
    # The Account must be eligible AT JOIN TIME so the join-time
    # `ChannelCapability.authorize/1` guard admits the socket. The
    # trial window is then flipped to expired mid-session to simulate
    # a real entitlement lapse, which the per-handler
    # `check_handler_entitlement/1` re-check catches.
    test "expired Account is denied confirm when :revenuecat_access_enforcement is enabled (AC #1)",
         %{account: account, user: user, token: token} do
      # Eligible AT JOIN TIME.
      _ = persist_trial_window!(account, :eligible)

      {:ok, _recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "PR2 expired recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: account.id,
          user_id: user.id,
          status: :processing,
          started_at: DateTime.utc_now(),
          input_context: %{}
        })

      {:ok, proposal} =
        PlanningRepo.create_proposal(%{
          generation_run_id: run.id,
          status: :pending,
          proposal_json: %{slots: []}
        })

      session = insert_active_session(account, user)

      previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      try do
        {:ok, socket} = connect(UserSocket, %{"token" => token})

        {:ok, _reply, socket} =
          subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

        start_supervised!(
          {Server, account_id: account.id, user_id: user.id, channel_pid: socket.channel_pid},
          id: {:channel_server, account.id, :expired_confirm_test}
        )

        # Flip the trial window to expired mid-session — the per-handler
        # check fires on this `confirm_proposal` message and refuses.
        _ = persist_trial_window!(account, :expired)

        ref =
          push(socket, "confirm_proposal", %{
            "proposal_id" => proposal.id,
            "session_id" => session.id
          })

        assert_error_reply(ref, :account_expired)

        # Session stays :active — handler short-circuits BEFORE
        # `Server.do_confirm/3` and never opens the transaction.
        reloaded_session =
          MealPlannerApi.Repo.get!(
            MealPlannerApi.Persistence.Planning.PlanningSession,
            session.id
          )

        assert reloaded_session.status == :active

        reloaded_proposal =
          Repo.get!(MealPlannerApi.Persistence.Planning.PlanningProposal, proposal.id)

        assert reloaded_proposal.status == :pending
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
  # reject_proposal tests
  # ==========================================================================

  describe "handle_in reject_proposal" do
    test "error when proposal not found - graceful error handling", %{
      account: account,
      user: user,
      token: token
    } do
      {:ok, _recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "Test Recipe Reject",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:dinner]
        })

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Use valid UUID format but non-existent
      fake_uuid = Ecto.UUID.generate()

      ref =
        push(socket, "reject_proposal", %{
          "proposal_id" => fake_uuid
        })

      # Should get error (proposal not found) - gracefully handled
      assert_error_reply(ref, :not_found)
    end

    test "rejects with missing proposal_id gracefully", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # No proposal_id in payload - falls through to unknown event
      ref = push(socket, "reject_proposal", %{})

      assert_error_reply(ref, :invalid_payload)
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
        %MealPlannerApi.Persistence.Accounts.User{}
        |> MealPlannerApi.Persistence.Accounts.User.changeset(%{
          email: "peer-cancel-#{System.unique_integer([:positive])}@example.com",
          name: "Peer Cancel",
          role: :member
        })
        |> Repo.insert!()

      peer_membership_id =
        %MealPlannerApi.Persistence.Accounts.AccountMembership{}
        |> MealPlannerApi.Persistence.Accounts.AccountMembership.changeset(%{
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
        %MealPlannerApi.Persistence.Accounts.User{}
        |> MealPlannerApi.Persistence.Accounts.User.changeset(%{
          email: "peer-owner-cancel-#{System.unique_integer([:positive])}@example.com",
          name: "Peer Owner Cancel",
          role: :member
        })
        |> Repo.insert!()

      peer_membership_id =
        %MealPlannerApi.Persistence.Accounts.AccountMembership{}
        |> MealPlannerApi.Persistence.Accounts.AccountMembership.changeset(%{
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
          "range_from" => "2026-04-01",
          "range_to" => "2026-04-07"
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
      assert reloaded.range_from == ~D[2026-04-01]
      assert reloaded.range_to == ~D[2026-04-07]
    end

    test "expired Account (ineligible) returns :subscription_required, no row, no broadcast",
         %{account: account, token: token} do
      _ = persist_trial_window!(account, :expired)

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "start_planning", %{
          "range_from" => "2026-04-01",
          "range_to" => "2026-04-07"
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
          range_from: ~D[2026-04-05],
          range_to: ~D[2026-04-12],
          lock_owner_user_id: owner_user.id,
          lock_owner_membership_id: owner_membership_id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
        })

      {:ok, socket} = connect(UserSocket, %{"token" => owner_token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "start_planning", %{
          "range_from" => "2026-04-10",
          "range_to" => "2026-04-15"
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
          "range_from" => "2026-05-01",
          "range_to" => "2026-05-07"
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
          "range_from" => "2026-05-08",
          "range_to" => "2026-05-14"
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
          "range_from" => "2026-05-15",
          "range_to" => "2026-05-21"
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
          "range_from" => "2026-05-22",
          "range_to" => "2026-05-28"
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
          "range_from" => "2026-05-29",
          "range_to" => "2026-06-04"
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
          "range_from" => "2026-06-05",
          "range_to" => "2026-06-11"
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
          "range_from" => "2026-06-01",
          "range_to" => "2026-06-07"
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
          "range_from" => "2026-06-05",
          "range_to" => "2026-06-12"
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
          "range_from" => "2026-06-15",
          "range_to" => "2026-06-21"
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
    test "generate_menu reads requestId and the nested constraints", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # `participant_ids` is validated before a generation starts, so the
      # code of the reply proves the nested key was read.
      ref =
        push(socket, "generate_menu", %{
          "requestId" => "gen_camel_refused",
          "constraints" => %{"participantIds" => ["not-a-uuid"]}
        })

      payload = assert_error_reply(ref, :forbidden)
      assert payload["requestId"] == "gen_camel_refused"

      assert_push("generation_error", %{
        "requestId" => "gen_camel_refused",
        "reason" => "forbidden"
      })
    end

    test "generate_menu replies and announces the generation in camelCase", %{
      account: account,
      user: user,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      start_supervised!(
        {Server, account_id: account.id, user_id: user.id, channel_pid: socket.channel_pid},
        id: {:channel_server, account.id, :camel_case_generate_test}
      )

      ref =
        push(socket, "generate_menu", %{
          "requestId" => "gen_camel",
          "constraints" => %{"participantIds" => [user.id]}
        })

      assert_reply(ref, :ok, reply)
      assert %{"requestId" => "gen_camel", "runId" => run_id} = reply
      assert Map.keys(reply) == ["requestId", "runId"]
      assert is_binary(run_id)

      assert_push("generation_started", started)
      assert started == %{"requestId" => "gen_camel", "runId" => run_id}

      # The server answers a call once the generation it is running has
      # finished, so the pipeline does not outlive the sandbox connection of
      # the test.
      assert %{current_run_id: ^run_id} = Server.get_status(account.id)
    end

    test "swap_constraints reads basePayload and constraints, and replies in camelCase", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "swap_constraints", %{
          "requestId" => "swap_camel",
          "basePayload" => %{"dateFrom" => "2026-06-15", "dateTo" => "2026-06-21"},
          "constraints" => %{"budgetCents" => 5000}
        })

      assert_push("generation_started", %{
        "requestId" => "swap_camel",
        "reason" => "constraint_update"
      })

      assert_reply(ref, :ok, reply)

      # The dates of the reply are the ones of `basePayload`: without the
      # normalization they would default to today.
      assert %{
               "requestId" => "swap_camel",
               "runId" => run_id,
               "proposalId" => proposal_id,
               "dateFrom" => "2026-06-15",
               "dateTo" => "2026-06-21",
               "appliedConstraints" => %{"budgetCents" => 5000},
               "proposal" => %{
                 "dateFrom" => "2026-06-15",
                 "dateTo" => "2026-06-21",
                 "scheduledMeals" => scheduled_meals,
                 "weeklyPlan" => %{"days" => days}
               }
             } = reply

      assert is_binary(run_id) and is_binary(proposal_id)
      assert is_list(scheduled_meals) and is_list(days)
      assert_camel_case_keys(reply)

      # The same payload is announced to every client of the topic.
      assert_push("proposal_ready", pushed)
      assert pushed == reply
    end

    test "swap_constraints refuses a camelCase range that ends before it starts", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "swap_constraints", %{
          "requestId" => "swap_camel_error",
          "basePayload" => %{"dateFrom" => "2026-06-21", "dateTo" => "2026-06-15"},
          "constraints" => %{}
        })

      payload = assert_error_reply(ref, :invalid_date_range)
      assert payload["requestId"] == "swap_camel_error"
    end

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
          "rangeFrom" => "2026-07-01",
          "rangeTo" => "2026-07-07"
        })

      assert_reply(ref_start, :ok, start_reply)
      assert %{"sessionId" => session_id, "status" => :active} = start_reply
      assert Map.keys(start_reply) == ["sessionId", "status"]

      # `session_started` is broadcast by `PlanningSessionServer`.
      assert_push("session_started", started)
      assert started == %{"sessionId" => session_id}

      session = Repo.get!(MealPlannerApi.Persistence.Planning.PlanningSession, session_id)
      assert session.range_from == ~D[2026-07-01]
      assert session.range_to == ~D[2026-07-07]

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

    test "confirm_proposal reads proposalId and sessionId", %{account: account, token: token} do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Both ids pass their guards, so the command reaches the lookup of the
      # generation server instead of stopping at `invalid_proposal_id`.
      ref =
        push(socket, "confirm_proposal", %{
          "proposalId" => Ecto.UUID.generate(),
          "sessionId" => Ecto.UUID.generate()
        })

      assert_error_reply(ref, :no_active_generation)
    end

    test "a key sent in both casings resolves to the snake_case one", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "swap_constraints", %{
          "request_id" => "snake_wins",
          "requestId" => "camel_loses",
          "base_payload" => %{"date_from" => "2026-06-21", "date_to" => "2026-06-15"},
          "constraints" => %{}
        })

      payload = assert_error_reply(ref, :invalid_date_range)
      assert payload["requestId"] == "snake_wins"
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

      for event <- PlanningChannel.outbound_events() do
        Endpoint.broadcast!("planning:#{account.id}", event, payload)

        assert_push(^event, pushed)
        assert pushed == expected, "#{event} was pushed as #{inspect(pushed)}"
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
          generate_menu
          swap_constraints
          chat
          confirm_proposal
          reject_proposal
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
            "range_from" => "2026-06-12",
            "range_to" => "2026-06-18"
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
      from(m in MealPlannerApi.Persistence.Accounts.AccountMembership,
        where: m.account_id == ^account_id and m.user_id == ^user_id and m.status == :active
      )
    ).id
  end

  # PR2 of issue #35 — Phase 2.3 channel tests create an `:active`
  # session and forward its id into `confirm_proposal` so the channel
  # reaches the lock-aware confirm path.
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
      %MealPlannerApi.Persistence.Accounts.User{}
      |> MealPlannerApi.Persistence.Accounts.User.changeset(%{
        email: "non-owner-peer-#{System.unique_integer([:positive])}@example.com",
        name: "Non Owner Peer",
        role: :member
      })
      |> Repo.insert!()

    {:ok, membership} =
      %MealPlannerApi.Persistence.Accounts.AccountMembership{}
      |> MealPlannerApi.Persistence.Accounts.AccountMembership.changeset(%{
        account_id: account.id,
        user_id: peer_user.id,
        role: :member,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert()

    issue_access_v2_token(peer_user, membership)
  end

  describe "helper functions behavior" do
    test "build_request_id generates unique ids", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Push without explicit request_id - server should auto-generate
      ref =
        push(socket, "generate_menu", %{
          "constraints" => %{}
        })

      # The reply carries the generated id
      assert_reply(ref, :ok, %{"requestId" => "req_" <> _})

      stop_generation_server(account.id)
    end

    test "an atom reason from a guard is replied as its allowlisted code", %{
      account: account,
      user: user,
      token: token
    } do
      {:ok, _recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "Test Recipe Serialize",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # Try to confirm a proposal - the payload guard answers an atom reason
      ref = push(socket, "confirm_proposal", %{"proposal_id" => Ecto.UUID.generate()})

      # The reason is replied as the code of the envelope
      assert_error_reply(ref, :missing_session_id)
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
        {"chat", %{"proposal_id" => "123", "message" => "Change the menu"}},
        {"confirm_proposal", %{"proposal_id" => Ecto.UUID.generate()}},
        {"start_planning", %{"range_from" => "not-a-date", "range_to" => "2026-04-07"}},
        {"send_message", %{"session_id" => Ecto.UUID.generate(), "intent" => %{}}},
        {"cancel_planning", %{"session_id" => "not-a-uuid"}},
        {"swap_constraints",
         %{
           "request_id" => "swap_req_no_reason",
           "base_payload" => %{"date_from" => "2026-06-21", "date_to" => "2026-06-15"},
           "constraints" => %{}
         }}
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
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      ref =
        push(socket, "swap_constraints", %{
          "request_id" => "swap_req_correlated",
          "base_payload" => %{"date_from" => "2026-06-21", "date_to" => "2026-06-15"},
          "constraints" => %{}
        })

      payload = assert_error_reply(ref, :invalid_date_range)

      assert Map.keys(payload) == ["error", "requestId"]
      assert payload["requestId"] == "swap_req_correlated"
    end

    test "a reason outside the allowlist replies unknown_error and is logged", %{
      account: account,
      token: token
    } do
      {:ok, socket} = connect(UserSocket, %{"token" => token})

      {:ok, _reply, socket} =
        subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")

      # A generation server that answers a reason no service chose and the
      # allowlist does not hold.
      start_generation_server_stub(account.id, {:error, {:storage_fault, "disk on fire"}})

      log =
        capture_log(fn ->
          ref =
            push(socket, "confirm_proposal", %{
              "proposal_id" => Ecto.UUID.generate(),
              "session_id" => Ecto.UUID.generate()
            })

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

      ref =
        push(socket, "generate_menu", %{"request_id" => "req_changeset", "constraints" => %{}})

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
  defp broadcast_event_literals(path) do
    {_ast, events} =
      path
      |> File.read!()
      |> Code.string_to_quoted!()
      |> Macro.prewalk([], fn
        {{:., _, [_module, name]}, _meta, args} = node, events when is_atom(name) ->
          {node, events ++ event_literals(name, args)}

        {name, _meta, args} = node, events when is_atom(name) and is_list(args) ->
          {node, events ++ event_literals(name, args)}

        node, events ->
          {node, events}
      end)

    events
  end

  defp event_literals(name, args) do
    if name |> Atom.to_string() |> String.contains?("broadcast") do
      Enum.filter(args, &is_binary/1)
    else
      []
    end
  end

  # The old reply shape, in either spelling of the key.
  defp has_reason_key?(payload),
    do: Map.has_key?(payload, :reason) or Map.has_key?(payload, "reason")
end
