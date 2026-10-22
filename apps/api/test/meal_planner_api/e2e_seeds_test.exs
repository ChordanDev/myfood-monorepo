defmodule MealPlannerApi.E2eSeedsTest do
  @moduledoc """
  `priv/repo/e2e_seeds.exs`, the data of the Maestro flows (issue #376).
  The seed runs twice and leaves the same data; the seeded User then signs
  in with the fixed `e2e` code, skips onboarding, plans with the planning
  agent (issue #423), confirms its Proposal and finds its Shopping list.

  The agent runs the scripted model and the optimizer answers with what
  `OptimizerMock` picks, as in the planning agent tests; the `e2e` API runs
  the real ones.
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  import Ecto.Query, only: [from: 2]
  import ExUnit.CaptureIO
  import Phoenix.ConnTest, except: [connect: 2, connect: 3]
  import Plug.Conn, only: [put_req_header: 3]

  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Catalog.Recipe

  alias MealPlannerApi.Persistence.Planning.{
    PlanningConfirmation,
    PlanningConsent,
    PlanningSession,
    ScheduledMeal
  }

  alias MealPlannerApi.PlanningAgent.Model.Scripted
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.{PlanningChannel, UserSocket}

  @moduletag :capture_log

  @seed_script Path.expand("../../priv/repo/e2e_seeds.exs", __DIR__)
  @email "e2e-user@example.test"
  @code "123456"

  # Every table the seed writes, as rows without their timestamps.
  @seeded_tables ~w(accounts users account_memberships recipes recipe_steps recipe_ingredients
                    ingredients user_preferences user_dietary_profiles user_slot_cooking_times)

  setup do
    previous_email = System.get_env("E2E_LOGIN_EMAIL")
    previous_login = Application.fetch_env(:meal_planner_api, :e2e_login)

    System.put_env("E2E_LOGIN_EMAIL", @email)
    Application.put_env(:meal_planner_api, :e2e_login, email: @email, code: @code)

    on_exit(fn ->
      if previous_email,
        do: System.put_env("E2E_LOGIN_EMAIL", previous_email),
        else: System.delete_env("E2E_LOGIN_EMAIL")

      case previous_login do
        {:ok, value} -> Application.put_env(:meal_planner_api, :e2e_login, value)
        :error -> Application.delete_env(:meal_planner_api, :e2e_login)
      end
    end)

    :ok
  end

  test "running the seed twice leaves the same data" do
    seed!()
    first = snapshot()
    seed!()

    assert snapshot() == first
    assert [%User{}] = Repo.all(User)
  end

  test "a second run clears what a journey left behind" do
    seed!()
    %{account_id: account_id} = sign_in!()
    confirm_a_plan!(account_id)

    seed!()

    assert Repo.aggregate(ScheduledMeal, :count) == 0
    assert Repo.aggregate(PlanningSession, :count) == 0
    assert Repo.aggregate(PlanningConfirmation, :count) == 0
    assert Repo.aggregate(PlanningConsent, :count) == 0
  end

  # The optimizer allows one Recipe at most twice in any 7 days and never in
  # the same slot on consecutive days, so the default 7-day Planning Range
  # needs at least 4 Recipes per Meal slot (Jorge F2 on #447).
  test "seeds at least 4 Recipes for every Meal slot" do
    seed!()

    for slot <- ~w(breakfast lunch dinner) do
      count =
        Repo.aggregate(
          from(r in Recipe,
            where: like(r.name, "E2E %"),
            where: is_nil(r.account_id),
            where: ^slot in r.suitable_for_slots
          ),
          :count
        )

      assert count >= 4, "#{slot} has #{count} E2E Recipes"
    end
  end

  test "the seeded User signs in, skips onboarding, plans and finds its Shopping list" do
    seed!()

    %{token: token, account_id: account_id} = sign_in!()

    assert %{"onboarding" => %{"isComplete" => true}} =
             authed(token) |> get("/api/me") |> json_response(200)

    confirm_a_plan!(account_id, token)

    assert %{"data" => %{"planned" => planned, "totals" => %{"needed" => 6}}} =
             authed(token) |> get("/api/shopping-list") |> json_response(200)

    assert planned |> Enum.map(& &1["name"]) |> Enum.sort() ==
             ~w(Arroz Avena Banana Fideos Pollo Tomate)
  end

  defp confirm_a_plan!(account_id, token \\ nil) do
    token = token || sign_in!().token
    script_the_agent!()

    {:ok, socket} = connect(UserSocket, %{"token" => token})
    {:ok, _reply, socket} = subscribe_and_join(socket, PlanningChannel, "planning:#{account_id}")

    ref = push(socket, "start_session", %{"rangeFrom" => in_days(1), "rangeTo" => in_days(2)})
    assert_reply(ref, :ok, %{"sessionId" => _session_id, "consentRequired" => true}, 2_000)

    ref = push(socket, "give_consent", %{})
    assert_reply(ref, :ok, %{"status" => "granted"})

    ref = push(socket, "send_message", %{"text" => "Plan these two days"})
    assert_reply(ref, :ok, %{"status" => "accepted"})

    assert_push(
      "agent_event",
      %{"type" => "proposal", "proposalId" => proposal_id, "meals" => meals},
      5_000
    )

    assert meals |> Enum.map(& &1["date"]) |> Enum.uniq() == [in_days(1), in_days(2)]

    ref = push(socket, "confirm", %{"proposalId" => proposal_id})
    assert_reply(ref, :ok, %{"mealsCount" => 6}, 5_000)

    meals = Repo.all(from(m in ScheduledMeal, where: m.account_id == ^account_id))
    assert length(meals) == 6
  end

  # One plan, then text: what the scripted model answers in this journey.
  defp script_the_agent! do
    previous = Application.get_env(:meal_planner_api, :planning_agent)

    script = [
      {:tool_calls, [{"run_optimizer", %{}}]},
      {:tool_calls, [{"present_proposal", %{}}]},
      {:text, "Here is your plan."}
    ]

    Application.put_env(
      :meal_planner_api,
      :planning_agent,
      Keyword.put(previous, :model, {Scripted, script: script})
    )

    on_exit(fn -> Application.put_env(:meal_planner_api, :planning_agent, previous) end)
  end

  defp sign_in! do
    assert %{} =
             build_conn()
             |> post("/api/auth/login/request-code", %{"email" => @email})
             |> json_response(200)

    assert %{"accessToken" => token} =
             build_conn()
             |> post("/api/auth/login/verify-code", %{
               "email" => @email,
               "code" => @code,
               "deviceId" => Ecto.UUID.generate()
             })
             |> json_response(200)

    %{token: token, account_id: Repo.get_by!(User, email: @email).account_id}
  end

  defp authed(token), do: build_conn() |> put_req_header("authorization", "Bearer " <> token)

  defp seed!, do: capture_io(fn -> Code.eval_file(@seed_script) end)

  defp snapshot do
    Map.new(@seeded_tables, fn table ->
      %{rows: rows} =
        Repo.query!(
          "SELECT (to_jsonb(t) - 'inserted_at' - 'updated_at')::text AS row FROM #{table} t ORDER BY 1"
        )

      {table, rows}
    end)
  end

  defp in_days(offset), do: Date.utc_today() |> Date.add(offset) |> Date.to_iso8601()
end
