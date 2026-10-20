defmodule MealPlannerApi.E2eSeedsTest do
  @moduledoc """
  `priv/repo/e2e_seeds.exs`, the data of the Maestro flows (issue #376).
  The seed runs twice and leaves the same data; the seeded User then signs
  in with the fixed `e2e` code, skips onboarding, gets a Planning proposal,
  confirms it and finds its Shopping list.

  The optimizer answers through `FakePortRunner` with what `OptimizerMock`
  picks, as in the planning channel tests; the `e2e` API runs the real
  one.
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  import Ecto.Query, only: [from: 2]
  import ExUnit.CaptureIO
  import Phoenix.ConnTest, except: [connect: 2, connect: 3]
  import Plug.Conn, only: [put_req_header: 3]

  import MealPlannerApi.Generation.ServerTestFixtures,
    only: [answer_optimizer_request: 1, start_optimizer_server!: 0, stop_generation_server: 1]

  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Planning.{PlanningSession, ScheduledMeal}
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
    {:ok, socket} = connect(UserSocket, %{"token" => token})
    {:ok, _reply, socket} = subscribe_and_join(socket, PlanningChannel, "planning:#{account_id}")

    optimizer = start_optimizer_server!()
    range_from = in_days(1)
    range_to = in_days(2)

    ref = push(socket, "start_planning", %{"rangeFrom" => range_from, "rangeTo" => range_to})
    # Starting the session writes and broadcasts before it replies.
    assert_reply(ref, :ok, %{"sessionId" => session_id}, 2_000)

    answer_optimizer_request(optimizer)
    assert_push("proposal_ready", %{"proposalId" => proposal_id, "days" => days}, 5_000)
    assert Enum.map(days, & &1["date"]) == [range_from, range_to]

    assert %{"data" => _confirmed} =
             authed(token)
             |> post("/api/planning/confirm", %{
               "proposalId" => proposal_id,
               "sessionId" => session_id
             })
             |> json_response(200)

    meals =
      Repo.all(
        from(m in ScheduledMeal,
          where: m.account_id == ^account_id
        )
      )

    assert length(meals) == 6

    stop_generation_server(account_id)
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
