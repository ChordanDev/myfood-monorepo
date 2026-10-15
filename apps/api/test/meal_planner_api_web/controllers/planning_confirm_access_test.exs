defmodule MealPlannerApiWeb.PlanningConfirmAccessTest do
  @moduledoc """
  The capability check of `POST /api/planning/confirm` (issue #15). The
  channel's `confirm_proposal` refused an expired Account before confirming;
  the HTTP route refuses it through the `:enforce_capability` pipeline.

  Not async: the test turns `:revenuecat_access_enforcement` on, a global
  setting.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query, only: [from: 2]
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership}
  alias MealPlannerApi.Persistence.Planning.{PlanningProposal, PlanningSession, ScheduledMeal}
  alias MealPlannerApi.Repo

  setup do
    previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
    Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

    on_exit(fn ->
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, previous)
    end)
  end

  test "an expired Account is refused with 403 trial_expired and nothing is confirmed", %{
    conn: conn
  } do
    %{user: user, account: account, token: token} =
      insert_identity_with_token!(plan: :family_4, subscription_tier: :premium)

    now = DateTime.utc_now()

    account
    |> Account.changeset(%{
      trial_started_at: DateTime.add(now, -86_400, :second),
      trial_ends_at: DateTime.add(now, -1, :second)
    })
    |> Repo.update!()

    {proposal, session} = seed_pending_proposal(account, user)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/planning/confirm", %{
        "proposalId" => proposal.id,
        "sessionId" => session.id
      })

    assert %{"error" => %{"code" => "trial_expired"}} = json_response(conn, 403)
    assert Repo.get!(PlanningProposal, proposal.id).status == :pending
    assert Repo.get!(PlanningSession, session.id).status == :active
    assert Repo.all(from(m in ScheduledMeal, where: m.account_id == ^account.id)) == []
  end

  # A pending proposal and the active session that holds its day. No
  # generation server is started: the request never reaches the controller.
  defp seed_pending_proposal(account, user) do
    date = Date.add(Date.utc_today(), 1)

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

    {proposal, session}
  end
end
