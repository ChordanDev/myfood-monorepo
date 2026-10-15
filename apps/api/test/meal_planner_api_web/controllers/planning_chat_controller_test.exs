defmodule MealPlannerApiWeb.PlanningChatControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false
  import Ecto.Query, warn: false
  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Planning.{PlanningGenerationRun, PlanningProposal}
  alias MealPlannerApi.Repo

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.19) ───────────────────────────
  # See calendar_controller_test.exs (task 3.14) for why a tampered
  # `account_id` claim is the genuine RED-discriminating case here.
  describe "multi-familia tenancy scoping (task 3.19)" do
    test "GET /api/planning/favorites resolves favorites via current_membership.account_id, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "chat_tamper@example.com"}, [
          {%{plan: :family_4, name: "Chat Tamper Account A"}, :owner},
          {%{plan: :family_4, name: "Chat Tamper Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: membership_a.account_id,
          created_by_user_id: user.id,
          name: "Chat Tamper Favorite Recipe",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:lunch]
        })

      {:ok, _favorite} = Calendar.toggle_favorite(membership_a.account_id, user.id, recipe.id)

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/planning/favorites")

      body = json_response(conn, 200)
      recipe_ids = Enum.map(body["data"], & &1["recipeId"])

      assert recipe.id in recipe_ids
    end
  end

  # PR3 of issue #35 — the legacy HTTP `POST
  # /api/planning/proposals/:proposal_id/confirm` path is RETIRED so
  # only the atomic channel path remains. Confirmations now flow
  # exclusively through the `confirm_proposal` channel event, which
  # runs inside the same `Repo.transaction/1` as the meal/cart writes
  # (AC #4). Any HTTP attempt must now be a 404 (no route) — clients
  # that still try the old endpoint get a deterministic "not found"
  # rather than silently bypassing the lock.
  test "POST /api/planning/proposals/:proposal_id/confirm is retired (404, no route)",
       %{conn: conn} do
    %{token: token} = insert_identity_with_token!()
    fake_proposal_id = Ecto.UUID.generate()

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/planning/proposals/#{fake_proposal_id}/confirm")

    assert conn.status == 404
  end

  test "planning chat creates a proposal (PR3 retired HTTP confirm)", %{conn: conn} do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    {:ok, breakfast_recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Avena chat",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:breakfast]
      })

    {:ok, lunch_recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Tacos vegetarianos",
        source: :user_created,
        servings: 4,
        suitable_for_slots: [:lunch]
      })

    {:ok, dinner_recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Sopa chat",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/planning/chat", %{
        "message" => "Necesito menu para la semana",
        "date_from" => "2026-03-23",
        "date_to" => "2026-03-24",
        "requested_recipe_ids" => [breakfast_recipe.id, lunch_recipe.id, dinner_recipe.id],
        "kcal_target" => 2200,
        "weekly_budget_cents" => 90_000
      })

    body = json_response(conn, 200)

    proposal_id = body["data"]["proposalId"]

    assert is_binary(proposal_id)
    assert length(body["data"]["proposal"]["scheduledMeals"]) == 6
    assert is_map(body["data"]["proposal"]["weeklyPlan"])
    assert length(body["data"]["proposal"]["weeklyPlan"]["days"]) >= 2
  end

  # Issue #28 — reject goes through the session flow: the generation server
  # of the Account rejects the proposal and tells the planning topic. The
  # controller answers only a pending proposal.
  describe "POST /api/planning/proposals/:proposal_id/reject" do
    test "rejects a pending proposal through the generation server and tells the topic",
         %{conn: conn} do
      %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)
      proposal = insert_pending_proposal(account, user)

      start_supervised!(
        {MealPlannerApi.Generation.Server, account_id: account.id, user_id: user.id}
      )

      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{account.id}")

      body =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/planning/proposals/#{proposal.id}/reject")
        |> json_response(200)

      assert %{"proposalId" => proposal_id, "status" => "rejected"} = body["data"]
      assert proposal_id == proposal.id
      assert Repo.get!(PlanningProposal, proposal.id).status == :rejected

      assert_receive %Phoenix.Socket.Broadcast{
        event: "proposal_rejected",
        payload: %{proposal_id: ^proposal_id}
      }
    end

    test "rejects a pending proposal and tells the topic when no generation server is running",
         %{conn: conn} do
      %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)
      proposal = insert_pending_proposal(account, user)
      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{account.id}")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/planning/proposals/#{proposal.id}/reject")

      assert %{"data" => %{"status" => "rejected"}} = json_response(conn, 200)
      assert Repo.get!(PlanningProposal, proposal.id).status == :rejected
      proposal_id = proposal.id

      assert_receive %Phoenix.Socket.Broadcast{
        event: "proposal_rejected",
        payload: %{proposal_id: ^proposal_id}
      }
    end

    for status <- [:rejected, :accepted] do
      test "answers 409 planning_proposal_not_pending for a proposal #{status}", %{conn: conn} do
        %{token: token, user: user, account: account} =
          insert_identity_with_token!(plan: :family_4)

        proposal = insert_pending_proposal(account, user)
        proposal |> Ecto.Changeset.change(%{status: unquote(status)}) |> Repo.update!()

        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> post("/api/planning/proposals/#{proposal.id}/reject")

        assert %{"error" => %{"code" => "planning_proposal_not_pending"}} =
                 json_response(conn, 409)

        assert Repo.get!(PlanningProposal, proposal.id).status == unquote(status)
      end
    end

    test "answers 404 not_found for a proposal of another Account", %{conn: conn} do
      %{user: user, account: account} = insert_identity_with_token!(plan: :family_4)
      proposal = insert_pending_proposal(account, user)
      %{token: other_token} = insert_identity_with_token!(plan: :family_4)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> other_token)
        |> post("/api/planning/proposals/#{proposal.id}/reject")

      assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
      assert Repo.get!(PlanningProposal, proposal.id).status == :pending
    end

    # Jorge review of PR #278: a confirm still running in the generation server
    # (its HTTP call timed out) must not be overwritten by a reject that read the
    # proposal as pending before the confirm committed.
    test "waits for a confirm in flight and answers 409 once it accepted the proposal",
         %{conn: conn} do
      %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)
      proposal = insert_pending_proposal(account, user)
      server = start_busy_generation_server(account.id)

      request =
        Task.async(fn ->
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> post("/api/planning/proposals/#{proposal.id}/reject")
        end)

      # The server is still busy with the confirm, which commits meanwhile.
      assert_receive {:busy_server_called, ^server, :get_status}
      proposal |> Ecto.Changeset.change(%{status: :accepted}) |> Repo.update!()
      send(server, :finish_confirm)

      conn = Task.await(request)

      assert %{"error" => %{"code" => "planning_proposal_not_pending"}} =
               json_response(conn, 409)

      assert Repo.get!(PlanningProposal, proposal.id).status == :accepted
      refute_receive {:busy_server_cast, ^server, {:reject, _proposal_id}}
    end

    test "answers 500 and rejects nothing when the generation server cannot be reached",
         %{conn: conn} do
      %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)
      proposal = insert_pending_proposal(account, user)
      server = start_busy_generation_server(account.id, exit_on_call: true)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/planning/proposals/#{proposal.id}/reject")

      assert %{"error" => %{"code" => "unknown_error"}} = json_response(conn, 500)
      assert Repo.get!(PlanningProposal, proposal.id).status == :pending
      refute_receive {:busy_server_cast, ^server, _cast}
    end

    # Native review R4-001: the reply must say what the server did, not that a
    # reject was sent. A server that drops the cast leaves the proposal pending.
    test "answers 500 when the generation server did not apply the reject", %{conn: conn} do
      %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)
      proposal = insert_pending_proposal(account, user)
      server = start_busy_generation_server(account.id, hold_first_call: false)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/planning/proposals/#{proposal.id}/reject")

      assert %{"error" => %{"code" => "unknown_error"}} = json_response(conn, 500)
      assert_received {:busy_server_cast, ^server, {:reject, _proposal_id}}
      assert Repo.get!(PlanningProposal, proposal.id).status == :pending
    end

    test "answers 422 invalid_proposal_id for a malformed id", %{conn: conn} do
      %{token: token} = insert_identity_with_token!(plan: :family_4)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/planning/proposals/nope/reject")

      assert %{"error" => %{"code" => "invalid_proposal_id"}} = json_response(conn, 422)
    end
  end

  # Registers a process as the generation server of the Account. It holds the
  # first call it gets until the test sends `:finish_confirm`, as a server still
  # running a confirm would, then answers every later call at once. With
  # `hold_first_call: false` it answers every call at once, and with
  # `exit_on_call: true` it dies on the first call instead. It applies no cast
  # and reports every call and cast it gets to the test.
  defp start_busy_generation_server(account_id, opts \\ []) do
    test_pid = self()

    pid =
      spawn(fn ->
        {:ok, _owner} =
          Registry.register(MealPlannerApi.Generation.Generations, {:generation, account_id}, nil)

        send(test_pid, :busy_server_registered)

        busy_server_loop(
          test_pid,
          Keyword.get(opts, :exit_on_call, false),
          Keyword.get(opts, :hold_first_call, true)
        )
      end)

    assert_receive :busy_server_registered
    on_exit(fn -> Process.exit(pid, :kill) end)
    pid
  end

  defp busy_server_loop(test_pid, exit_on_call?, held?) do
    receive do
      {:"$gen_call", from, request} ->
        send(test_pid, {:busy_server_called, self(), request})
        if exit_on_call?, do: exit(:boom)
        if held?, do: receive(do: (:finish_confirm -> :ok))
        GenServer.reply(from, %{})
        busy_server_loop(test_pid, exit_on_call?, false)

      {:"$gen_cast", request} ->
        send(test_pid, {:busy_server_cast, self(), request})
        busy_server_loop(test_pid, exit_on_call?, held?)
    end
  end

  defp insert_pending_proposal(account, user) do
    run =
      Repo.insert!(%PlanningGenerationRun{
        account_id: account.id,
        user_id: user.id,
        status: :completed,
        input_context: %{},
        started_at: DateTime.utc_now(),
        completed_at: DateTime.utc_now()
      })

    Repo.insert!(%PlanningProposal{
      generation_run_id: run.id,
      proposal_json: %{"slots" => []},
      status: :pending
    })
  end

  describe "POST /api/planning/chat date range limit (issue #87)" do
    test "a range longer than seven days answers 422 and creates no rows", %{conn: conn} do
      %{token: token, account: %{id: account_id}} = insert_identity_with_token!()

      # Every User plans seven days at most; the first range is eight days,
      # the second two years.
      for {date_from, date_to} <- [{"2026-03-23", "2026-03-30"}, {"2026-01-01", "2027-12-31"}] do
        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> post("/api/planning/chat", %{
            "message" => "Necesito menu",
            "date_from" => date_from,
            "date_to" => date_to
          })

        assert json_response(conn, 422) == %{
                 "error" => %{
                   "code" => "date_range_too_long",
                   "message" => "The date range must not be longer than 7 days.",
                   "details" => %{"maxDays" => 7}
                 }
               }
      end

      assert planning_row_counts(account_id) == %{generation_runs: 0, proposals: 0}
    end

    test "a range that ends before it starts still answers invalid_date_range", %{conn: conn} do
      %{token: token, account: %{id: account_id}} = insert_identity_with_token!()

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/planning/chat", %{
          "message" => "Necesito menu",
          "date_from" => "2026-03-29",
          "date_to" => "2026-03-23"
        })

      assert json_response(conn, 422) == %{"error" => "invalid_date_range"}
      assert planning_row_counts(account_id) == %{generation_runs: 0, proposals: 0}
    end

    for subscription_tier <- [:free, :premium] do
      test "a range of seven days still creates a proposal for a #{subscription_tier} User", %{
        conn: conn
      } do
        %{token: token, account: %{id: account_id}} =
          insert_identity_with_token!(subscription_tier: unquote(subscription_tier))

        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> post("/api/planning/chat", %{
            "message" => "Necesito menu para la semana",
            "date_from" => "2026-03-23",
            "date_to" => "2026-03-29"
          })

        body = json_response(conn, 200)

        assert is_binary(body["data"]["proposalId"])
        assert body["data"]["dateFrom"] == "2026-03-23"
        assert body["data"]["dateTo"] == "2026-03-29"

        assert planning_row_counts(account_id) == %{generation_runs: 1, proposals: 1}
      end
    end
  end

  test "favorites endpoint returns user starred recipes", %{conn: conn} do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Empanadas de choclo",
        source: :user_created,
        servings: 8,
        suitable_for_slots: [:dinner]
      })

    {:ok, true} = Calendar.toggle_favorite(account_id, user_id, recipe.id)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/planning/favorites?limit=5")

    body = json_response(conn, 200)

    assert Enum.any?(body["data"], &(&1["recipeId"] == recipe.id))
  end

  test "favorites endpoint follows the favorites added and removed over HTTP", %{conn: conn} do
    %{token: token, user: %{id: user_id}, account: %{id: account_id}} =
      insert_identity_with_token!(plan: :family_4)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account_id,
        created_by_user_id: user_id,
        name: "Tarta de zapallitos",
        source: :user_created,
        servings: 4,
        suitable_for_slots: [:lunch]
      })

    authed = put_req_header(conn, "authorization", "Bearer " <> token)

    planner_favorite_ids = fn ->
      authed
      |> get("/api/planning/favorites")
      |> json_response(200)
      |> Map.fetch!("data")
      |> Enum.map(& &1["recipeId"])
    end

    assert planner_favorite_ids.() == []

    authed
    |> put_req_header("content-type", "application/json")
    |> post("/api/me/favorites", %{recipeId: recipe.id})
    |> json_response(200)

    assert planner_favorite_ids.() == [recipe.id]

    authed |> delete("/api/me/favorites/#{recipe.id}") |> response(204)

    assert planner_favorite_ids.() == []
  end

  # The generation runs of the Account and the proposals made from them.
  # Issue #312: an optimizer answer outside the candidates answers 422
  # `optimization_failed` on both planning routes and writes nothing.
  describe "optimizer answer outside the candidates (issue #312)" do
    setup do
      previous_client = Application.get_env(:meal_planner_api, :planning_optimizer_client)

      on_exit(fn ->
        Application.put_env(:meal_planner_api, :planning_optimizer_client, previous_client)
        Application.delete_env(:meal_planner_api, :out_of_candidate_recipe_id)
      end)

      Application.put_env(
        :meal_planner_api,
        :planning_optimizer_client,
        MealPlannerApi.TestSupport.OutOfCandidateOptimizer
      )

      Application.put_env(:meal_planner_api, :out_of_candidate_recipe_id, Ecto.UUID.generate())

      %{token: token, user: user, account: account} = insert_identity_with_token!()

      {:ok, _breakfast} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "Out of candidates breakfast",
          source: :user_created,
          servings: 1,
          suitable_for_slots: [:breakfast]
        })

      %{token: token, account_id: account.id}
    end

    test "POST /api/planning/chat answers 422 and creates no rows", %{
      conn: conn,
      token: token,
      account_id: account_id
    } do
      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/planning/chat", %{
          "message" => "Necesito menu",
          "date_from" => "2026-03-23",
          "date_to" => "2026-03-29"
        })

      assert json_response(conn, 422) == %{"error" => "optimization_failed"}
      assert planning_row_counts(account_id) == %{generation_runs: 0, proposals: 0}
    end

    test "GET /api/planning/weekly answers 422", %{conn: conn, token: token} do
      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/planning/weekly")

      assert json_response(conn, 422) == %{"error" => "optimization_failed"}
    end
  end

  defp planning_row_counts(account_id) do
    runs = from(r in PlanningGenerationRun, where: r.account_id == ^account_id)

    proposals =
      from(p in PlanningProposal,
        join: r in assoc(p, :generation_run),
        where: r.account_id == ^account_id
      )

    %{
      generation_runs: Repo.aggregate(runs, :count),
      proposals: Repo.aggregate(proposals, :count)
    }
  end
end
