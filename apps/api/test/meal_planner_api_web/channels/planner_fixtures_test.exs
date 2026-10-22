defmodule MealPlannerApiWeb.PlannerFixturesTest do
  @moduledoc """
  Records the frozen payloads of the Planner (issue #25) and compares them
  with the JSON fixtures the mobile app reads
  (`apps/mobile/src/features/planner/fixtures`).

  The planning agent replaced `start_planning` on the channel (issue #423),
  so the fixtures recorded from it (`startPlanningReply`, `sessionStarted`,
  `generationStarted`, `generationError`, `planningContext`,
  `planningInvalidRangeError`, `planningRangeLockedError`) are no longer
  re-recorded; the mobile planner keeps reading them until its agent screen
  (#424) replaces it. The legacy `proposal_ready` broadcast is still
  recorded.

  Without `UPDATE_FIXTURES=1` the test fails when a committed fixture differs
  from the fresh payload. See `MealPlannerApiWeb.PlannerFixtures` and
  `apps/api/docs/CHANNELS.md` ("Planner fixtures").
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  import MealPlannerApiWeb.ChannelHelpers, only: [issue_identity_and_token: 2]

  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.GenerationService
  alias MealPlannerApiWeb.{Endpoint, PlannerFixtures, PlanningChannel, UserSocket}

  @moduletag :capture_log

  @run_id "00000000-0000-4000-8000-000000000002"
  @proposal_id "00000000-0000-4000-8000-000000000003"
  @recipe_ids [
    "00000000-0000-4000-8000-0000000000a1",
    "00000000-0000-4000-8000-0000000000a2",
    "00000000-0000-4000-8000-0000000000a3"
  ]

  setup do
    {:ok, user, account, token} = issue_identity_and_token("u_planner_fx", "acct_planner_fx")
    _ = persist_trial_window!(account)

    on_exit(fn ->
      for {pid, _value} <-
            Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) do
        DynamicSupervisor.terminate_child(MealPlannerApi.Generation.ServerSupervisor, pid)
      end
    end)

    %{user: user, account: account, token: token, socket: join_planning!(token, account)}
  end

  test "proposal_ready and planning_message", %{account: account} do
    [day_1, day_2] = [in_days(1), in_days(2)]
    [r1, r2, r3] = @recipe_ids

    proposal =
      GenerationService.build_proposal_json([
        resolved(day_2, :dinner, r3, "Lentil stew", 700, %{
          protein_g: 12.5,
          calories: 500,
          carbs_g: 60
        }),
        resolved(day_1, :lunch, r2, "Chicken rice", 1_250),
        resolved(day_1, :breakfast, r1, "Oatmeal", nil, %{
          protein_g: 30,
          calories: 500,
          carbs_g: nil
        })
      ])

    Endpoint.broadcast!("planning:#{account.id}", "proposal_ready", %{
      proposal_id: @proposal_id,
      run_id: @run_id,
      proposal: proposal
    })

    assert_push("proposal_ready", ready)
    assert_push("planning_message", message)

    stable = %{day_1 => "2030-01-01", day_2 => "2030-01-02"}

    PlannerFixtures.check!("proposalReady", ready, stable)
    PlannerFixtures.check!("planningMessage", message, stable)
  end

  defp in_days(offset), do: Date.utc_today() |> Date.add(offset) |> Date.to_iso8601()

  defp join_planning!(token, account) do
    {:ok, socket} = connect(UserSocket, %{"token" => token})
    {:ok, _reply, socket} = subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")
    socket
  end

  defp persist_trial_window!(account) do
    started = DateTime.utc_now()

    {:ok, updated} =
      account
      |> Account.changeset(%{
        trial_started_at: started,
        trial_ends_at: DateTime.add(started, 7 * 86_400, :second)
      })
      |> Repo.update()

    updated
  end

  # `macros` carry a fractional value and a missing one in some meals: the real
  # producer sends decimals and `nil`.
  defp resolved(date, slot, recipe_id, name, price_cents, macros \\ nil) do
    %{
      date: date,
      slot: slot,
      recipe_id: recipe_id,
      recipe_name: name,
      price_cents: price_cents,
      macros: macros || %{protein_g: 30, calories: 500, carbs_g: 60}
    }
  end
end
