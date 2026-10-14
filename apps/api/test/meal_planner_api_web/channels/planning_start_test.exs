defmodule MealPlannerApiWeb.PlanningStartTest do
  @moduledoc """
  `start_planning` as the Planner screen uses it (issue #25): the command
  validates a range of 1 to 7 days that starts today or later, starts the
  Planning session, starts the generation, and the five events the screen
  reads reach the client in camelCase with a frozen shape.

  The frozen shapes are documented in `apps/api/docs/CHANNELS.md`.
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  import Ecto.Query, only: [from: 2]
  import MealPlannerApiWeb.CasingAssertions, only: [assert_camel_case_keys: 1]

  import MealPlannerApi.Generation.ServerTestFixtures,
    only: [
      answer_optimizer_request: 1,
      insert_recipe: 2,
      start_optimizer_server!: 0,
      stop_generation_server: 1
    ]

  import MealPlannerApiWeb.ChannelHelpers, only: [issue_identity_and_token: 2]

  alias MealPlannerApi.Data.{AccountRepo, PlanningRepo, RecipeRepo}
  alias MealPlannerApi.Generation.Server
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.{AccountMembership, User}
  alias MealPlannerApi.Persistence.Planning.{PlanningGenerationRun, PlanningSession}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.{GenerationService, UserPreferencesService}
  alias MealPlannerApiWeb.{ApiError, Endpoint, PlanningChannel, UserSocket}

  @moduletag :capture_log

  setup do
    {:ok, user, account, token} = issue_identity_and_token("u_plan_start", "acct_plan_start")
    _ = persist_trial_window!(account)

    on_exit(fn ->
      for {pid, _value} <-
            Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) do
        DynamicSupervisor.terminate_child(MealPlannerApi.Generation.ServerSupervisor, pid)
      end
    end)

    %{user: user, account: account, token: token}
  end

  describe "error codes (T1)" do
    test "ApiError holds planning_invalid_range (422) and planning_range_locked (409)" do
      assert :planning_invalid_range in ApiError.codes()
      assert :planning_range_locked in ApiError.codes()

      assert %{error: %{code: :planning_invalid_range}} =
               ApiError.envelope(:planning_invalid_range)

      assert %{error: %{code: :planning_range_locked}} =
               ApiError.envelope(:planning_range_locked)
    end

    test "an unparseable date replies planning_invalid_range", %{account: account, token: token} do
      socket = join_planning!(token, account)

      ref =
        push(socket, "start_planning", %{"rangeFrom" => "not-a-date", "rangeTo" => in_days(2)})

      assert_error_reply(ref, :planning_invalid_range)
    end

    test "a range that ends before it starts replies planning_invalid_range", %{
      account: account,
      token: token
    } do
      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(3), "rangeTo" => in_days(1)})

      assert_error_reply(ref, :planning_invalid_range)
    end

    test "an overlap with the caller's own session replies planning_range_locked, no details",
         %{account: account, user: user, token: token} do
      {:ok, _existing} =
        insert_session(account, user, owner_membership_id(account.id, user.id), 1, 5)

      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(3), "rangeTo" => in_days(7)})

      payload = assert_error_reply(ref, :planning_range_locked)
      refute Map.has_key?(payload["error"], "details")
    end

    test "an overlap with another member's session names its owner", %{
      account: account,
      token: token
    } do
      {peer_user, peer_membership} = insert_peer(account, "Ana Peer")
      {:ok, _existing} = insert_session(account, peer_user, peer_membership.id, 1, 5)

      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(3), "rangeTo" => in_days(7)})

      payload = assert_error_reply(ref, :planning_range_locked)
      assert payload["error"]["details"] == %{"ownerName" => "Ana Peer"}
      assert_camel_case_keys(payload)

      active =
        Repo.aggregate(
          from(s in PlanningSession, where: s.account_id == ^account.id and s.status == :active),
          :count
        )

      assert active == 1
    end

    for {label, own_offsets, peer_offsets} <- [
          {"before", {1, 2}, {3, 4}},
          {"after", {3, 4}, {1, 2}}
        ] do
      test "an overlap with the caller's session starting #{label} a peer's names the peer", %{
        account: account,
        user: user,
        token: token
      } do
        {own_from, own_to} = unquote(Macro.escape(own_offsets))
        {peer_from, peer_to} = unquote(Macro.escape(peer_offsets))

        {:ok, _own} =
          insert_session(
            account,
            user,
            owner_membership_id(account.id, user.id),
            own_from,
            own_to
          )

        {peer_user, peer_membership} = insert_peer(account, "Ana Peer")
        {:ok, _peer} = insert_session(account, peer_user, peer_membership.id, peer_from, peer_to)

        socket = join_planning!(token, account)

        ref =
          push(socket, "start_planning", %{"rangeFrom" => in_days(1), "rangeTo" => in_days(4)})

        payload = assert_error_reply(ref, :planning_range_locked)
        assert payload["error"]["details"] == %{"ownerName" => "Ana Peer"}
      end
    end

    test "an overlap with a session whose Membership was removed still names its owner", %{
      account: account,
      token: token
    } do
      {peer_user, peer_membership} = insert_peer(account, "Ana Peer")
      {:ok, existing} = insert_session(account, peer_user, peer_membership.id, 1, 5)

      Repo.delete!(peer_membership)
      assert Repo.reload!(existing).lock_owner_membership_id == nil

      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(3), "rangeTo" => in_days(7)})

      payload = assert_error_reply(ref, :planning_range_locked)
      assert payload["error"]["details"] == %{"ownerName" => "Ana Peer"}
    end
  end

  describe "params (T2)" do
    test "accepts camelCase dates and a free text, and starts the generation", %{
      account: account,
      token: token
    } do
      socket = join_planning!(token, account)
      from = in_days(1)
      to = in_days(3)

      ref =
        push(socket, "start_planning", %{
          "rangeFrom" => from,
          "rangeTo" => to,
          "request" => "  something light, no fish  "
        })

      assert_reply(ref, :ok, %{"sessionId" => session_id, "status" => :active})

      session = Repo.get!(PlanningSession, session_id)
      assert session.range_from == Date.from_iso8601!(from)
      assert session.range_to == Date.from_iso8601!(to)

      # The generation started through the same call `generate_menu` makes,
      # with the dates of the session and the free text as the request.
      assert_push("generation_started", %{"runId" => run_id})
      assert %{current_run_id: ^run_id, constraints: constraints} = Server.get_status(account.id)
      assert constraints["date_from"] == from
      assert constraints["date_to"] == to
      assert constraints["request"] == "something light, no fish"

      stop_generation_server(account.id)
    end

    test "dayCount stands for rangeTo, and the free text is optional", %{
      account: account,
      token: token
    } do
      socket = join_planning!(token, account)
      from = in_days(0)

      ref = push(socket, "start_planning", %{"rangeFrom" => from, "dayCount" => 4})

      assert_reply(ref, :ok, %{"sessionId" => session_id})
      session = Repo.get!(PlanningSession, session_id)
      assert session.range_to == Date.add(Date.from_iso8601!(from), 3)

      assert_push("generation_started", %{"runId" => run_id})
      assert %{current_run_id: ^run_id, constraints: constraints} = Server.get_status(account.id)
      refute Map.has_key?(constraints, "request")

      stop_generation_server(account.id)
    end

    test "snake_case params keep working", %{account: account, token: token} do
      socket = join_planning!(token, account)

      ref =
        push(socket, "start_planning", %{
          "range_from" => in_days(1),
          "range_to" => in_days(2),
          "day_count" => 2
        })

      assert_reply(ref, :ok, %{"sessionId" => _})
      assert_push("generation_started", %{"runId" => _})
      stop_generation_server(account.id)
    end

    for {label, params} <- [
          {"no end and no day count", %{"rangeFrom" => :from}},
          {"a day count of zero", %{"rangeFrom" => :from, "dayCount" => 0}},
          {"a day count of eight", %{"rangeFrom" => :from, "dayCount" => 8}},
          {"a day count that is a string", %{"rangeFrom" => :from, "dayCount" => "3"}},
          {"a range of eight days", %{"rangeFrom" => :from, "rangeTo" => {:days, 7}}},
          {"a day count that disagrees with the end",
           %{"rangeFrom" => :from, "rangeTo" => {:days, 2}, "dayCount" => 5}},
          {"a start two days in the past", %{"rangeFrom" => {:days, -2}, "dayCount" => 2}},
          {"a start that is not a string", %{"rangeFrom" => 20_261_010, "dayCount" => 2}}
        ] do
      test "#{label} replies planning_invalid_range and starts nothing", %{
        account: account,
        token: token
      } do
        socket = join_planning!(token, account)

        params =
          Map.new(unquote(Macro.escape(params)), fn
            {key, :from} -> {key, in_days(0)}
            {key, {:days, offset}} -> {key, in_days(offset)}
            other -> other
          end)

        ref = push(socket, "start_planning", params)

        assert_error_reply(ref, :planning_invalid_range)
        assert active_sessions(account) == 0

        assert Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) ==
                 []
      end
    end

    test "today is a valid start", %{account: account, token: token} do
      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(0), "dayCount" => 1})

      assert_reply(ref, :ok, %{"sessionId" => _})
      stop_generation_server(account.id)
    end

    for {label, text} <- [
          {"a number", 42},
          {"a list", ["a"]},
          {"more than 1000 characters", String.duplicate("a", 1001)}
        ] do
      test "a free text that is #{label} replies invalid_payload and starts nothing", %{
        account: account,
        token: token
      } do
        socket = join_planning!(token, account)

        ref =
          push(socket, "start_planning", %{
            "rangeFrom" => in_days(0),
            "dayCount" => 2,
            "request" => unquote(Macro.escape(text))
          })

        assert_error_reply(ref, :invalid_payload)
        assert active_sessions(account) == 0
      end
    end

    test "a blank free text is the same as none", %{account: account, token: token} do
      socket = join_planning!(token, account)

      ref =
        push(socket, "start_planning", %{
          "rangeFrom" => in_days(0),
          "dayCount" => 2,
          "request" => "   "
        })

      assert_reply(ref, :ok, %{"sessionId" => _})
      assert_push("generation_started", %{"runId" => _})
      refute Map.has_key?(Server.get_status(account.id).constraints, "request")
      stop_generation_server(account.id)
    end

    test "a generation that cannot start replies its error, cancels the session and stops it",
         %{account: account, token: token} do
      socket = join_planning!(token, account)
      before = session_children()
      start_generation_server_stub(account.id, {:error, :invalid_date_range})

      ref =
        push(socket, "start_planning", %{
          "requestId" => "req_start_1",
          "rangeFrom" => in_days(0),
          "dayCount" => 2
        })

      assert_receive %Phoenix.Socket.Reply{ref: ^ref, status: :error, payload: payload}
      assert payload["requestId"] == "req_start_1"

      assert_push("generation_error", %{"requestId" => "req_start_1", "reason" => reason})
      assert reason == "invalid_date_range"
      assert_push("session_cancelled", %{"sessionId" => cancelled_id})

      assert Repo.get!(PlanningSession, cancelled_id).status == :cancelled
      assert active_sessions(account) == 0
      assert session_children() -- before == []
    end

    test "a run already in flight replies generation_in_progress without a topic-wide error",
         %{account: account, token: token} do
      socket = join_planning!(token, account)
      before = session_children()
      start_generation_server_stub(account.id, {:error, :already_running})

      ref =
        push(socket, "start_planning", %{
          "requestId" => "req_start_1",
          "rangeFrom" => in_days(0),
          "dayCount" => 2
        })

      payload = assert_error_reply(ref, :generation_in_progress)
      assert payload["requestId"] == "req_start_1"

      assert_push("session_cancelled", %{"sessionId" => cancelled_id})
      refute_push("generation_error", _)

      assert Repo.get!(PlanningSession, cancelled_id).status == :cancelled
      assert active_sessions(account) == 0
      assert session_children() -- before == []
    end

    @tag capture_log: true
    test "a generation server that does not answer fails the start, the channel survives",
         %{account: account, token: token} do
      socket = join_planning!(token, account)
      before = session_children()
      start_generation_server_stub(account.id, :never_replies)

      ref =
        push(socket, "start_planning", %{
          "requestId" => "req_start_1",
          "rangeFrom" => in_days(0),
          "dayCount" => 2
        })

      assert_receive %Phoenix.Socket.Reply{ref: ^ref, status: :error, payload: payload}, 8_000
      assert payload["error"]["code"] == :generation_in_progress
      assert payload["requestId"] == "req_start_1"

      assert_push("generation_error", %{"requestId" => "req_start_1"})
      assert_push("session_cancelled", %{"sessionId" => cancelled_id})
      assert Repo.get!(PlanningSession, cancelled_id).status == :cancelled
      assert active_sessions(account) == 0
      assert session_children() -- before == []
      assert Process.alive?(socket.channel_pid)
    end

    test "rangeTo null with a dayCount is accepted", %{account: account, token: token} do
      socket = join_planning!(token, account)

      ref =
        push(socket, "start_planning", %{
          "rangeFrom" => in_days(0),
          "rangeTo" => nil,
          "dayCount" => 3
        })

      assert_reply(ref, :ok, %{"sessionId" => _})
      stop_generation_server(account.id)
    end

    test "a rangeTo with dayCount null is accepted", %{account: account, token: token} do
      socket = join_planning!(token, account)

      ref =
        push(socket, "start_planning", %{
          "rangeFrom" => in_days(0),
          "rangeTo" => in_days(2),
          "dayCount" => nil
        })

      assert_reply(ref, :ok, %{"sessionId" => _})
      stop_generation_server(account.id)
    end

    # `Generation.Server` holds a window of 7 days, so the channel caps the
    # range there and refuses a longer one before any session starts.
    test "a range of seven days is the longest accepted", %{account: account, token: token} do
      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(0), "dayCount" => 7})

      assert_reply(ref, :ok, %{"sessionId" => _})
      assert_push("generation_started", %{"runId" => _})
      stop_generation_server(account.id)
    end
  end

  describe "planning context (#29)" do
    test "hands the engine a context with every signal, read back from the run", %{
      account: account,
      user: user,
      token: token
    } do
      [first, second] = favorites!(account, user, ["Lentil soup", "Veggie stew"])
      set_up_signals!(user)

      socket = join_planning!(token, account)

      ref =
        push(socket, "start_planning", %{
          "rangeFrom" => in_days(1),
          "rangeTo" => in_days(3),
          "request" => "something light",
          "favoriteRecipeIds" => [second.id, first.id]
        })

      assert_reply(ref, :ok, %{"sessionId" => _})
      assert_push("generation_started", %{"runId" => run_id})

      constraints = persisted_constraints(run_id)
      assert constraints["request"] == "something light"
      assert constraints["date_from"] == in_days(1)

      context = constraints["planning_context"]
      assert context["diet"] == "vegetarian"
      assert context["softPreferences"] == ["quick_meals"]
      assert context["cookingSkill"] == "intermediate"
      assert context["householdSize"] == 3
      assert context["favoriteRecipeIds"] == [second.id, first.id]

      assert context["slotCookingTimes"]["breakfast"] == %{
               "cooking" => "limited",
               "maxMinutes" => 15,
               "hungerLevel" => "light"
             }

      assert context["slotCookingTimes"]["dinner"] == %{
               "cooking" => "limited",
               "maxMinutes" => 45,
               "hungerLevel" => "strong"
             }

      stop_generation_server(account.id)
    end

    test "a missing snack has no constraint and a 0-minute slot is do_not_cook", %{
      account: account,
      user: user,
      token: token
    } do
      set_up_signals!(user)

      times = start_and_read_context!(token, account)["slotCookingTimes"]

      assert times["snack"] == %{
               "cooking" => "no_constraint",
               "maxMinutes" => nil,
               "hungerLevel" => nil
             }

      assert times["lunch"] == %{
               "cooking" => "do_not_cook",
               "maxMinutes" => 0,
               "hungerLevel" => "normal"
             }

      stop_generation_server(account.id)
    end

    test "the Hard restriction codes arrive as text", %{
      account: account,
      user: user,
      token: token
    } do
      set_up_signals!(user)

      codes = start_and_read_context!(token, account)["hardRestrictionCodes"]

      assert Enum.sort(codes) == ["gluten", "peanut"]
      assert Enum.all?(codes, &is_binary/1)

      stop_generation_server(account.id)
    end

    test "a User who set nothing up still starts with a complete context", %{
      account: account,
      token: token
    } do
      context = start_and_read_context!(token, account)

      assert context["diet"] == nil
      assert context["hardRestrictionCodes"] == []
      assert context["softPreferences"] == []
      assert context["cookingSkill"] == nil
      assert context["householdSize"] == nil
      assert context["favoriteRecipeIds"] == []

      assert context["slotCookingTimes"]
             |> Map.values()
             |> Enum.all?(&(&1["cooking"] == "no_constraint"))

      stop_generation_server(account.id)
    end

    test "an id that is not a favorite of the caller is dropped", %{
      account: account,
      user: user,
      token: token
    } do
      [mine] = favorites!(account, user, ["Lentil soup"])
      not_a_favorite = insert_recipe("Not starred", account_id: account.id)

      {peer, _membership} = insert_peer(account, "Ana Peer")
      peer_recipe = insert_recipe("Peer stew", account_id: account.id)

      {:ok, _favorite} =
        RecipeRepo.add_favorite(%{account_id: account.id, user_id: peer.id}, peer_recipe.id)

      context =
        start_and_read_context!(token, account, %{
          "favoriteRecipeIds" => [
            not_a_favorite.id,
            peer_recipe.id,
            Ecto.UUID.generate(),
            mine.id,
            mine.id
          ]
        })

      assert context["favoriteRecipeIds"] == [mine.id]

      stop_generation_server(account.id)
    end

    test "a start without favoriteRecipeIds still works and preselects nothing", %{
      account: account,
      user: user,
      token: token
    } do
      _ = favorites!(account, user, ["Lentil soup"])

      assert start_and_read_context!(token, account)["favoriteRecipeIds"] == []

      stop_generation_server(account.id)
    end

    test "a null favoriteRecipeIds is the same as none", %{account: account, token: token} do
      context = start_and_read_context!(token, account, %{"favoriteRecipeIds" => nil})

      assert context["favoriteRecipeIds"] == []

      stop_generation_server(account.id)
    end

    test "a favoriteRecipeIds that is not a list of strings replies invalid_payload and starts nothing",
         %{account: account, token: token} do
      socket = join_planning!(token, account)
      sessions_before = session_children()

      for malformed <- ["a-recipe-id", %{"id" => "x"}, 7, ["ok", 7], [nil], [["nested"]]] do
        ref =
          push(socket, "start_planning", %{
            "rangeFrom" => in_days(1),
            "dayCount" => 2,
            "favoriteRecipeIds" => malformed
          })

        assert_error_reply(ref, :invalid_payload)
      end

      assert active_sessions(account) == 0
      assert session_children() == sessions_before
      refute_push("generation_started", _payload)
      assert Repo.aggregate(PlanningGenerationRun, :count) == 0
    end
  end

  describe "events (T3)" do
    setup %{account: account, token: token} do
      %{socket: join_planning!(token, account)}
    end

    test "session_started carries the sessionId only", %{socket: socket, account: account} do
      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(0), "dayCount" => 2})

      assert_reply(ref, :ok, %{"sessionId" => session_id})
      assert_push("session_started", payload)
      assert payload == %{"sessionId" => session_id}

      stop_generation_server(account.id)
    end

    test "generation_started carries requestId, runId and sessionId", %{
      socket: socket,
      account: account
    } do
      ref =
        push(socket, "start_planning", %{
          "requestId" => "req_events_1",
          "rangeFrom" => in_days(0),
          "dayCount" => 2
        })

      assert_reply(ref, :ok, %{"sessionId" => session_id})
      assert_push("generation_started", payload)

      assert %{"requestId" => "req_events_1", "runId" => run_id, "sessionId" => ^session_id} =
               payload

      assert is_binary(run_id)
      assert Enum.sort(Map.keys(payload)) == ["requestId", "runId", "sessionId"]
      assert_camel_case_keys(payload)

      stop_generation_server(account.id)
    end

    test "the generation error of a run with no recipes arrives normalized", %{
      socket: socket,
      account: account
    } do
      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(0), "dayCount" => 2})
      assert_reply(ref, :ok, %{"sessionId" => _})
      assert_push("generation_started", %{"runId" => run_id})

      assert_push("generation_error", error, 10_000)

      assert Enum.sort(Map.keys(error)) == ["details", "reason", "requestId", "runId"]
      assert error["runId"] == run_id
      assert is_binary(error["reason"])
      assert is_map(error["details"])
      assert_camel_case_keys(error)

      stop_generation_server(account.id)
    end

    test "generation_error has one shape whatever the broadcaster", %{
      socket: _socket,
      account: account
    } do
      topic = "planning:#{account.id}"

      # Engine, pipeline failure: only a reason.
      Endpoint.broadcast!(topic, "generation_error", %{reason: "pipeline_error"})

      assert_push("generation_error", only_reason)

      assert only_reason == %{
               "reason" => "pipeline_error",
               "details" => %{},
               "runId" => nil,
               "requestId" => nil
             }

      # Engine, optimization failure: run, reason and details.
      Endpoint.broadcast!(topic, "generation_error", %{
        run_id: "run-1",
        reason: "optimization_failed",
        details: %{missing_slots: 2}
      })

      assert_push("generation_error", from_engine)

      assert from_engine == %{
               "reason" => "optimization_failed",
               "details" => %{"missingSlots" => 2},
               "runId" => "run-1",
               "requestId" => nil
             }

      # Channel, a command that failed: request id and reason.
      Endpoint.broadcast!(topic, "generation_error", %{request_id: "req-9", reason: "forbidden"})

      assert_push("generation_error", from_channel)

      assert from_channel == %{
               "reason" => "forbidden",
               "details" => %{},
               "runId" => nil,
               "requestId" => "req-9"
             }
    end

    test "proposal_ready carries day-by-day cards and the estimated cost, then planning_message follows",
         %{socket: _socket, account: account} do
      day_1 = in_days(1)
      day_2 = in_days(2)

      proposal =
        GenerationService.build_proposal_json([
          resolved(day_2, :dinner, "r-3", "Lentil stew", 700),
          resolved(day_1, :lunch, "r-2", "Chicken rice", 1_250),
          resolved(day_1, :breakfast, "r-1", "Oatmeal", nil)
        ])

      Endpoint.broadcast!("planning:#{account.id}", "proposal_ready", %{
        proposal_id: "prop-1",
        run_id: "run-1",
        proposal: proposal
      })

      [first, second] = next_pushes(2)

      assert {"proposal_ready", ready} = first
      assert_camel_case_keys(ready)

      assert ready == %{
               "proposalId" => "prop-1",
               "runId" => "run-1",
               "estimatedCostCents" => 1_950,
               "days" => [
                 %{
                   "date" => day_1,
                   "costCents" => 1_250,
                   "meals" => [
                     meal("breakfast", "r-1", "Oatmeal", nil),
                     meal("lunch", "r-2", "Chicken rice", 1_250)
                   ]
                 },
                 %{
                   "date" => day_2,
                   "costCents" => 700,
                   "meals" => [meal("dinner", "r-3", "Lentil stew", 700)]
                 }
               ]
             }

      assert {"planning_message", message} = second
      assert_camel_case_keys(message)

      assert message == %{
               "role" => "assistant",
               "text" => "Here is your plan for 2 days: 3 meals, estimated cost 19.50.",
               "proposalId" => "prop-1",
               "runId" => "run-1",
               "summary" => %{"dayCount" => 2, "mealCount" => 3, "estimatedCostCents" => 1_950}
             }
    end

    test "a proposal with one meal reads in the singular", %{socket: _socket, account: account} do
      proposal =
        GenerationService.build_proposal_json([
          resolved(in_days(1), :lunch, "r-2", "Chicken rice", 100)
        ])

      Endpoint.broadcast!("planning:#{account.id}", "proposal_ready", %{
        proposal_id: "p",
        run_id: "r",
        proposal: proposal
      })

      [_ready, {"planning_message", message}] =
        next_pushes(2)

      assert message["text"] == "Here is your plan for 1 day: 1 meal, estimated cost 1.00."
    end

    # The proposal of a real run (#158): the generation server builds it from
    # the answer of the optimizer and broadcasts it, nothing is injected.
    test "the proposal_ready of a generation carries the days and slots of the range", %{
      socket: socket,
      account: account
    } do
      recipe = insert_recipe("Planner recipe", suitable_for_slots: ~w(breakfast lunch dinner))
      optimizer = start_optimizer_server!()
      day_1 = in_days(1)
      day_2 = in_days(2)

      ref = push(socket, "start_planning", %{"rangeFrom" => day_1, "rangeTo" => day_2})
      assert_reply(ref, :ok, %{"sessionId" => _})
      assert_push("generation_started", %{"runId" => run_id})

      answer_optimizer_request(optimizer)

      assert_push("proposal_ready", ready, 5_000)
      assert_camel_case_keys(ready)
      assert %{"proposalId" => proposal_id, "runId" => ^run_id, "days" => days} = ready
      assert is_binary(proposal_id)
      assert Enum.map(days, & &1["date"]) == [day_1, day_2]

      for day <- days do
        assert Enum.map(day["meals"], &{&1["slot"], &1["recipeId"], &1["recipeName"]}) == [
                 {"breakfast", recipe.id, "Planner recipe"},
                 {"lunch", recipe.id, "Planner recipe"},
                 {"dinner", recipe.id, "Planner recipe"}
               ]
      end

      assert_push("planning_message", %{"proposalId" => ^proposal_id, "summary" => summary})
      assert %{"dayCount" => 2, "mealCount" => 6} = summary

      stop_generation_server(account.id)
    end

    test "a proposal_ready that is not the generation's keeps its payload", %{
      socket: _socket,
      account: account
    } do
      Endpoint.broadcast!("planning:#{account.id}", "proposal_ready", %{
        request_id: "req-1",
        proposal: %{scheduled_meals: []}
      })

      assert_push("proposal_ready", payload)
      assert payload == %{"requestId" => "req-1", "proposal" => %{"scheduledMeals" => []}}
      refute_push("planning_message", _)
    end

    test "the events of the Planner are intercepted" do
      for event <-
            ~w(session_started generation_started proposal_ready planning_message generation_error) do
        assert event in PlanningChannel.outbound_events()
      end
    end
  end

  # ==========================================================================
  # Helpers
  # ==========================================================================

  defp in_days(offset), do: Date.utc_today() |> Date.add(offset) |> Date.to_iso8601()

  defp join_planning!(token, account) do
    {:ok, socket} = connect(UserSocket, %{"token" => token})
    {:ok, _reply, socket} = subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")
    socket
  end

  defp persist_trial_window!(account) do
    started = DateTime.utc_now()
    ends = DateTime.add(started, 7 * 86_400, :second)

    {:ok, updated} =
      account
      |> Account.changeset(%{
        trial_started_at: started,
        trial_ends_at: ends
      })
      |> Repo.update()

    updated
  end

  defp owner_membership_id(account_id, user_id) do
    Repo.one!(
      from(m in AccountMembership,
        where: m.account_id == ^account_id and m.user_id == ^user_id and m.status == :active,
        select: m.id
      )
    )
  end

  defp insert_peer(account, name) do
    peer_user =
      %User{}
      |> User.changeset(%{
        email: "peer-#{System.unique_integer([:positive])}@example.com",
        name: name,
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

    {peer_user, membership}
  end

  defp insert_session(account, user, membership_id, from_offset, to_offset) do
    PlanningRepo.create_session(account.id, %{
      range_from: Date.add(Date.utc_today(), from_offset),
      range_to: Date.add(Date.utc_today(), to_offset),
      lock_owner_user_id: user.id,
      lock_owner_membership_id: membership_id,
      lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
    })
  end

  defp resolved(date, slot, recipe_id, name, price_cents) do
    %{
      date: date,
      slot: slot,
      recipe_id: recipe_id,
      recipe_name: name,
      price_cents: price_cents,
      macros: %{protein_g: 30, calories: 500, carbs_g: 60}
    }
  end

  defp meal(slot, recipe_id, name, price_cents) do
    %{
      "slot" => slot,
      "recipeId" => recipe_id,
      "recipeName" => name,
      "priceCents" => price_cents,
      "macros" => %{"proteinG" => 30, "calories" => 500, "carbsG" => 60}
    }
  end

  # The first `count` pushes of proposal_ready or planning_message, in the order they reached
  # the client. A selective `receive` with one pattern walks the mailbox in
  # arrival order, so the list is the order.
  defp next_pushes(count) do
    for _ <- 1..count do
      receive do
        %Phoenix.Socket.Message{event: event, payload: payload}
        when event in ["proposal_ready", "planning_message"] ->
          {event, payload}
      after
        1_000 -> flunk("expected #{count} proposal_ready / planning_message pushes")
      end
    end
  end

  defp active_sessions(account) do
    Repo.aggregate(
      from(s in PlanningSession, where: s.account_id == ^account.id and s.status == :active),
      :count
    )
  end

  # Registers a process as the generation server of the account. It answers
  # `reply` to the first call it receives, whatever the call is.
  defp start_generation_server_stub(account_id, reply) do
    test_pid = self()

    spawn_link(fn ->
      {:ok, _owner} =
        Registry.register(MealPlannerApi.Generation.Generations, {:generation, account_id}, nil)

      send(test_pid, :generation_server_stub_registered)

      receive do
        {:"$gen_call", _from, _request} when reply == :never_replies -> Process.sleep(:infinity)
        {:"$gen_call", from, _request} -> GenServer.reply(from, reply)
      end
    end)

    assert_receive :generation_server_stub_registered
  end

  defp session_children do
    MealPlannerApi.Generation.PlanningSessionSupervisor
    |> DynamicSupervisor.which_children()
    |> Enum.map(fn {_id, pid, _type, _modules} -> pid end)
    |> Enum.filter(&(is_pid(&1) and Process.alive?(&1)))
  end

  # Starts a plan with the given extra params, waits for the generation to
  # start and returns the Planning context persisted on its run.
  defp start_and_read_context!(token, account, extra_params \\ %{}) do
    socket = join_planning!(token, account)

    ref =
      push(
        socket,
        "start_planning",
        Map.merge(%{"rangeFrom" => in_days(1), "dayCount" => 2}, extra_params)
      )

    assert_reply(ref, :ok, %{"sessionId" => _})
    assert_push("generation_started", %{"runId" => run_id})

    persisted_constraints(run_id)["planning_context"]
  end

  defp persisted_constraints(run_id) do
    Repo.get!(PlanningGenerationRun, run_id).input_context["constraints"]
  end

  defp favorites!(account, user, names) do
    for name <- names do
      recipe = insert_recipe(name, account_id: account.id)

      {:ok, _favorite} =
        RecipeRepo.add_favorite(%{account_id: account.id, user_id: user.id}, recipe.id)

      recipe
    end
  end

  # Every onboarding signal of the Planning context, with a 0-minute lunch.
  defp set_up_signals!(user) do
    {:ok, _preferences} =
      UserPreferencesService.replace(user.id, %{
        diet: "vegetarian",
        hard_restrictions: ["gluten", "peanut"],
        soft_preferences: ["quick_meals"]
      })

    user
    |> User.profile_changeset(%{
      name: user.name,
      household_size: 3,
      cooking_skill: "intermediate"
    })
    |> Repo.update!()

    {:ok, _rows} =
      AccountRepo.replace_slot_cooking_times(user.id, %{
        breakfast: %{cooking_time_minutes: 15, hunger_level: :light},
        lunch: %{cooking_time_minutes: 0, hunger_level: :normal},
        dinner: %{cooking_time_minutes: 45, hunger_level: :strong}
      })
  end

  defp assert_error_reply(ref, code) do
    assert_receive %Phoenix.Socket.Reply{ref: ^ref, status: :error, payload: payload}
    assert %{"error" => %{"code" => ^code, "message" => message}} = payload
    assert is_binary(message) and message != ""
    payload
  end
end
