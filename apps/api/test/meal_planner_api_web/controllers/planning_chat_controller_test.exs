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

  describe "POST /api/planning/chat date range limit (issue #87)" do
    test "a range longer than the plan maximum answers 422 and creates no rows", %{conn: conn} do
      %{token: token, account: %{id: account_id}} = insert_identity_with_token!()

      # A free User plans five days at most; the second range is two years.
      for {date_from, date_to} <- [{"2026-03-23", "2026-03-28"}, {"2026-01-01", "2027-12-31"}] do
        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> post("/api/planning/chat", %{
            "message" => "Necesito menu",
            "date_from" => date_from,
            "date_to" => date_to
          })

        assert json_response(conn, 422) == %{"error" => "invalid_date_range"}
      end

      assert planning_row_counts(account_id) == %{generation_runs: 0, proposals: 0}
    end

    test "a range of the plan maximum still creates a proposal", %{conn: conn} do
      %{token: token, account: %{id: account_id}} =
        insert_identity_with_token!(subscription_tier: :premium)

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

  # The generation runs of the Account and the proposals made from them.
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
