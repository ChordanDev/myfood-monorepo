defmodule MealPlannerApiWeb.PlanningControllerTest do
  use MealPlannerApiWeb.ConnCase, async: true

  import Ecto.Query, only: [from: 2]
  import MealPlannerApi.AccountClockFixtures
  import MealPlannerApi.FactoryHelpers
  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Generation.Server
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.SlotFavorite
  alias MealPlannerApi.Persistence.Planning.PlanningProposal
  alias MealPlannerApi.Persistence.Planning.PlanningSession
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Persistence.Shopping.CheckoutSession
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.Casing
  alias MealPlannerApiWeb.PlannerFixtures

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.15) ───────────────────────────
  # See calendar_controller_test.exs (task 3.14) for why a tampered
  # `account_id` claim — rather than a plain "scoped JWT" — is the genuine
  # RED-discriminating case for this codebase (Guardian re-attaches
  # `account_id` straight from claims for dual-write compatibility, so a
  # well-formed claim alone can't distinguish `current_user.account_id`
  # from `current_membership.account_id`).
  describe "multi-familia tenancy scoping (task 3.15)" do
    test "GET /api/planning/weekly resolves candidates via current_membership.account_id, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "plan_weekly_tamper@example.com"}, [
          {%{plan: :family_4, name: "Planning Weekly Account A"}, :owner},
          {%{plan: :family_4, name: "Planning Weekly Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      {:ok, recipe_a} =
        Catalog.create_recipe(%{
          name: "Weekly Breakfast Only In A",
          account_id: membership_a.account_id,
          created_by_user_id: user.id,
          source: :user_created,
          servings: 1,
          calories_per_serving: 400,
          prep_time_minutes: 10,
          suitable_for_slots: [:breakfast]
        })

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/planning/weekly")

      body = json_response(conn, 200)

      breakfast_recipe_ids =
        body["data"]["days"]
        |> Enum.flat_map(& &1["meals"])
        |> Enum.filter(&(&1["slot"] == "breakfast"))
        |> Enum.map(& &1["recipeId"])

      assert recipe_a.id in breakfast_recipe_ids
    end
  end

  test "requires auth token", %{conn: conn} do
    conn = get(conn, "/api/planning/weekly")

    assert %{"error" => %{"code" => "unauthenticated"}} = json_response(conn, 401)
  end

  # Issue #230: every Account plans 1 to 7 days, whatever its plan.
  test "free User plans 7 days", %{conn: conn} do
    %{token: token} = insert_identity_with_token!(subscription_tier: :free)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/planning/weekly", %{"days" => 7})

    body = json_response(conn, 200)

    assert length(body["data"]["days"]) == 7
    assert body["data"]["maxPlanningDays"] == 7
    assert body["data"]["subscriptionTier"] == "free"
  end

  test "premium tier receives 7 planning days", %{conn: conn} do
    %{token: token} = insert_identity_with_token!(subscription_tier: :premium)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/planning/weekly")

    body = json_response(conn, 200)

    assert length(body["data"]["days"]) == 7
    assert body["data"]["maxPlanningDays"] == 7
    assert body["data"]["subscriptionTier"] == "premium"
  end

  test "free User is refused 8 days with exceeds_max_planning_days", %{conn: conn} do
    %{token: token} = insert_identity_with_token!(subscription_tier: :free)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/planning/weekly", %{"days" => 8})

    body = json_response(conn, 400)
    assert body["error"] == "exceeds_max_planning_days"
  end

  # Issue #28 — the confirm of the Planner goes through the session flow:
  # `Generation.Server.confirm/3` with the proposal and the Planning session
  # that holds the range. The `meals` list `save_plan` took is not read any
  # more.
  describe "POST /api/planning/confirm" do
    test "commits a pending proposal and tells the planning topic", %{conn: conn} do
      ctx = seed_pending_proposal()
      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{ctx.account.id}")

      body =
        conn
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => ctx.session.id
        })
        |> json_response(200)

      assert body["data"] == %{
               "proposalId" => ctx.proposal.id,
               "sessionId" => ctx.session.id,
               "status" => "committed",
               "scheduledMealsCount" => 1,
               "shoppingRebuilt" => true
             }

      assert [%ScheduledMeal{slot: :lunch}] = account_meals(ctx)
      assert Repo.get!(PlanningSession, ctx.session.id).status == :committed
      assert Repo.get!(PlanningProposal, ctx.proposal.id).status == :accepted

      proposal_id = ctx.proposal.id
      session_id = ctx.session.id

      assert_receive %Phoenix.Socket.Broadcast{
        event: "proposal_confirmed",
        payload: %{proposal_id: ^proposal_id}
      }

      assert_receive %Phoenix.Socket.Broadcast{
        event: "session_committed",
        payload:
          %{
            session_id: ^session_id,
            proposal_id: ^proposal_id,
            scheduled_meals_count: 1,
            shopping_rebuilt: true
          } = committed
      }

      # The app reads both shapes from these files (apps/mobile planner fixtures);
      # the event reaches it camelized by `PlanningChannel.handle_out/3`.
      PlannerFixtures.check!("confirmProposalReply", body["data"])
      PlannerFixtures.check!("sessionCommitted", Casing.camelize_keys(committed))
    end

    test "answers a proposal it already confirmed with the same result and writes nothing",
         %{conn: conn} do
      ctx = seed_pending_proposal()
      params = %{"proposalId" => ctx.proposal.id, "sessionId" => ctx.session.id}

      first = conn |> authorized(ctx.token) |> post("/api/planning/confirm", params)
      first_body = json_response(first, 200)
      carts = Repo.aggregate(CheckoutSession, :count)

      again = build_conn() |> authorized(ctx.token) |> post("/api/planning/confirm", params)

      assert json_response(again, 200) == first_body
      assert length(account_meals(ctx)) == 1
      assert Repo.aggregate(CheckoutSession, :count) == carts
    end

    # Jorge review of PR #278 (TR-1): a confirm whose HTTP call timed out still
    # commits in the generation server, and only the retry tells the topic, so
    # the other devices of the Account hear the commit too.
    test "tells the topic of a commit whose first reply was lost, when the confirm is retried",
         %{conn: conn} do
      ctx = seed_pending_proposal()

      [{server, _}] =
        Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, ctx.account.id})

      # The commit the first, timed-out call asked for: no session_committed.
      {:ok, _summary} = Server.confirm(server, ctx.proposal.id, ctx.session.id)
      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{ctx.account.id}")

      body =
        conn
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => ctx.session.id
        })
        |> json_response(200)

      assert %{"status" => "committed", "scheduledMealsCount" => 1} = body["data"]
      session_id = ctx.session.id
      proposal_id = ctx.proposal.id

      assert_receive %Phoenix.Socket.Broadcast{
        event: "session_committed",
        payload: %{
          session_id: ^session_id,
          proposal_id: ^proposal_id,
          scheduled_meals_count: 1,
          shopping_rebuilt: true
        }
      }

      refute_receive %Phoenix.Socket.Broadcast{event: "session_committed"}
    end

    test "answers 409 missing_lock when a confirmed proposal is retried with a session that did not commit",
         %{conn: conn} do
      ctx = seed_pending_proposal()

      conn
      |> authorized(ctx.token)
      |> post("/api/planning/confirm", %{
        "proposalId" => ctx.proposal.id,
        "sessionId" => ctx.session.id
      })
      |> json_response(200)

      later = Date.add(Date.utc_today(), 3)

      {:ok, active} =
        PlanningRepo.create_session(ctx.account.id, %{
          range_from: later,
          range_to: later,
          lock_owner_user_id: ctx.user.id,
          lock_owner_membership_id: ctx.session.lock_owner_membership_id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
        })

      Phoenix.PubSub.subscribe(MealPlannerApi.PubSub, "planning:#{ctx.account.id}")

      retry =
        build_conn()
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => active.id
        })

      assert %{"error" => %{"code" => "missing_lock"}} = json_response(retry, 409)
      refute_receive %Phoenix.Socket.Broadcast{event: "session_committed"}
    end

    test "answers 409 planning_proposal_not_pending for a rejected proposal", %{conn: conn} do
      ctx = seed_pending_proposal()
      {:ok, _} = PlanningRepo.update_proposal(ctx.proposal, %{status: :rejected})

      conn =
        conn
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => ctx.session.id
        })

      assert %{"error" => %{"code" => "planning_proposal_not_pending"}} =
               json_response(conn, 409)

      assert account_meals(ctx) == []
      assert Repo.get!(PlanningSession, ctx.session.id).status == :active
    end

    test "answers the reason of the engine when the lease of the session ran out", %{conn: conn} do
      ctx = seed_pending_proposal()

      ctx.session
      |> Ecto.Changeset.change(%{lease_expires_at: DateTime.add(DateTime.utc_now(), -1)})
      |> Repo.update!()

      conn =
        conn
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => ctx.session.id
        })

      assert %{"error" => %{"code" => "lost_lock"}} = json_response(conn, 409)
      assert account_meals(ctx) == []
    end

    test "answers 409 no_active_generation when no generation server holds the proposal",
         %{conn: conn} do
      ctx = seed_pending_proposal(start_server: false)

      conn =
        conn
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => ctx.session.id
        })

      assert %{"error" => %{"code" => "no_active_generation"}} = json_response(conn, 409)
    end

    test "answers 404 not_found for a proposal of another Account", %{conn: conn} do
      ctx = seed_pending_proposal()
      %{token: other_token} = insert_identity_with_token!(subscription_tier: :premium)

      conn =
        conn
        |> authorized(other_token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => ctx.session.id
        })

      assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
      assert account_meals(ctx) == []
    end

    # The channel's `confirm_proposal` had this test until issue #15 retired
    # it: a session of another Account is no lock for this one.
    test "answers 403 foreign_lock for a session of another Account and writes nothing",
         %{conn: conn} do
      ctx = seed_pending_proposal()
      %{user: other_user, account: other_account} = insert_identity!(plan: :family_4)

      other_membership =
        Repo.one!(
          from(m in AccountMembership,
            where: m.account_id == ^other_account.id and m.user_id == ^other_user.id
          )
        )

      {:ok, foreign_session} =
        PlanningRepo.create_session(other_account.id, %{
          range_from: ctx.session.range_from,
          range_to: ctx.session.range_to,
          lock_owner_user_id: other_user.id,
          lock_owner_membership_id: other_membership.id,
          lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
        })

      conn =
        conn
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => foreign_session.id
        })

      assert %{"error" => %{"code" => "foreign_lock"}} = json_response(conn, 403)
      assert account_meals(ctx) == []
      assert Repo.get!(PlanningProposal, ctx.proposal.id).status == :pending
      assert Repo.get!(PlanningSession, ctx.session.id).status == :active
      assert Repo.get!(PlanningSession, foreign_session.id).status == :active
    end

    test "answers 422 for a missing session id or a malformed proposal id", %{conn: conn} do
      ctx = seed_pending_proposal(start_server: false)

      missing_session =
        conn
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{"proposalId" => ctx.proposal.id})

      assert %{"error" => %{"code" => "missing_session_id"}} = json_response(missing_session, 422)

      malformed =
        build_conn()
        |> authorized(ctx.token)
        |> post("/api/planning/confirm", %{"proposalId" => "nope", "sessionId" => ctx.session.id})

      assert %{"error" => %{"code" => "invalid_proposal_id"}} = json_response(malformed, 422)
    end

    test "resolves the Account from current_membership, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "plan_confirm_tamper@example.com"}, [
          {%{plan: :family_4, name: "Planning Confirm Account A"}, :owner},
          {%{plan: :family_4, name: "Planning Confirm Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      account = Repo.get!(MealPlannerApi.Persistence.Accounts.Account, membership_a.account_id)
      ctx = seed_pending_proposal(account: account, user: user)

      conn =
        conn
        |> authorized(token)
        |> post("/api/planning/confirm", %{
          "proposalId" => ctx.proposal.id,
          "sessionId" => ctx.session.id
        })

      assert %{"data" => %{"scheduledMealsCount" => 1}} = json_response(conn, 200)
      assert [%ScheduledMeal{account_id: account_id}] = account_meals(ctx)
      assert account_id == membership_a.account_id
    end
  end

  # Issue #28 — the Planner keeps its session alive over HTTP while the screen
  # is open, as the Shopping screen keeps its Cart.
  describe "POST /api/planning/sessions/:session_id/activity" do
    test "renews the lease of the session the caller holds", %{conn: conn} do
      ctx = seed_pending_proposal(start_server: false)

      body =
        conn
        |> authorized(ctx.token)
        |> post("/api/planning/sessions/#{ctx.session.id}/activity")
        |> json_response(200)

      assert %{"sessionId" => session_id, "leaseExpiresAt" => lease} = body["data"]
      assert session_id == ctx.session.id

      {:ok, lease, _offset} = DateTime.from_iso8601(lease)
      assert DateTime.compare(lease, ctx.session.lease_expires_at) == :gt
      assert Repo.get!(PlanningSession, ctx.session.id).lease_expires_at == lease
    end

    test "answers 409 lost_lock once the lease ran out", %{conn: conn} do
      ctx = seed_pending_proposal(start_server: false)

      ctx.session
      |> Ecto.Changeset.change(%{lease_expires_at: DateTime.add(DateTime.utc_now(), -1)})
      |> Repo.update!()

      conn =
        conn |> authorized(ctx.token) |> post("/api/planning/sessions/#{ctx.session.id}/activity")

      assert %{"error" => %{"code" => "lost_lock"}} = json_response(conn, 409)
    end

    test "answers 404 not_found for an unknown or malformed session id", %{conn: conn} do
      %{token: token} = insert_identity_with_token!(subscription_tier: :premium)

      unknown =
        conn
        |> authorized(token)
        |> post("/api/planning/sessions/#{Ecto.UUID.generate()}/activity")

      assert %{"error" => %{"code" => "not_found"}} = json_response(unknown, 404)

      malformed =
        build_conn() |> authorized(token) |> post("/api/planning/sessions/nope/activity")

      assert %{"error" => %{"code" => "not_found"}} = json_response(malformed, 404)
    end
  end

  defp authorized(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)

  # The Scheduled meals of the Account of `ctx`: the only ones a confirm of its
  # proposal can write.
  defp account_meals(ctx) do
    Repo.all(from(m in ScheduledMeal, where: m.account_id == ^ctx.account.id))
  end

  # A pending proposal with one lunch, the active Planning session that holds
  # its day and, unless `start_server: false`, the generation server of the
  # Account, allowed into the test's sandbox.
  defp seed_pending_proposal(opts \\ []) do
    %{token: token, user: user, account: account} =
      case Keyword.fetch(opts, :account) do
        {:ok, account} ->
          %{token: nil, user: Keyword.fetch!(opts, :user), account: account}

        :error ->
          insert_identity_with_token!(plan: :family_4, subscription_tier: :premium)
      end

    date = Date.add(Date.utc_today(), 1)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Confirm recipe",
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
        proposal_json: %{
          slots: [
            %{
              slot_key: "#{Date.to_iso8601(date)}_lunch",
              date: Date.to_iso8601(date),
              slot: "lunch",
              recipe_id: recipe.id,
              recipe_name: "Confirm recipe",
              price_cents: 1000
            }
          ]
        }
      })

    membership =
      Repo.one!(
        from(m in AccountMembership,
          where: m.account_id == ^account.id and m.user_id == ^user.id and m.status == :active
        )
      )

    {:ok, session} =
      PlanningRepo.create_session(account.id, %{
        range_from: date,
        range_to: date,
        lock_owner_user_id: user.id,
        lock_owner_membership_id: membership.id,
        lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
      })

    if Keyword.get(opts, :start_server, true) do
      pid = start_supervised!({Server, account_id: account.id, user_id: user.id})
      Sandbox.allow(Repo, self(), pid)
    end

    %{token: token, user: user, account: account, proposal: proposal, session: session}
  end

  describe "PUT /api/planning/slots/favorite" do
    test "turns the favorite on and off for a slot with a recipe, as the calendar shows it" do
      %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account.id)

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "Slot favorite recipe",
          source: :user_created,
          servings: 1,
          calories_per_serving: 500,
          suitable_for_slots: [:lunch]
        })

      {:ok, meal} =
        Calendar.upsert_scheduled_meal(account.id, %{
          date: today,
          slot: :lunch,
          recipe_id: recipe.id
        })

      toggle = fn ->
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/planning/slots/favorite", %{
          "date" => Date.to_iso8601(today),
          "slot" => "lunch"
        })
      end

      calendar_favorite = fn ->
        conn =
          build_conn()
          |> put_req_header("authorization", "Bearer " <> token)
          |> get("/api/calendar", %{
            "start_date" => Date.to_iso8601(today),
            "end_date" => Date.to_iso8601(today)
          })

        [listed] = json_response(conn, 200)["data"]["meals"]
        assert listed["mealId"] == meal.id
        listed["isFavorite"]
      end

      refute calendar_favorite.()

      assert json_response(toggle.(), 200) == %{"isFavorite" => true}
      assert calendar_favorite.() == true

      assert json_response(toggle.(), 200) == %{"isFavorite" => false}
      assert calendar_favorite.() == false
    end

    test "answers 404 meal_not_found when the slot has no Scheduled meal" do
      %{token: token, account: account} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account.id)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/planning/slots/favorite", %{
          "date" => Date.to_iso8601(today),
          "slot" => "dinner"
        })

      assert json_response(conn, 404) == %{"error" => "meal_not_found"}
      assert Repo.aggregate(SlotFavorite, :count) == 0
    end

    test "answers 422 meal_without_recipe when the Scheduled meal has no recipe" do
      %{token: token, account: account} = insert_identity_with_token!(plan: :family_4)
      today = pin_account_to_midday!(account.id)

      {:ok, _meal} = Calendar.upsert_scheduled_meal(account.id, %{date: today, slot: :snack})

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/planning/slots/favorite", %{
          "date" => Date.to_iso8601(today),
          "slot" => "snack"
        })

      assert json_response(conn, 422) == %{"error" => "meal_without_recipe"}
      assert Repo.aggregate(SlotFavorite, :count) == 0
    end
  end
end
