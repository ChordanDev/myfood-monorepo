defmodule MealPlannerApiWeb.AccountTimezoneControllerTest do
  @moduledoc """
  `PUT /api/account/timezone` through the router (issue #62): the device
  keeps the Account's IANA timezone in sync. Request bodies are sent as JSON
  text, so a value keeps the JSON type the client wrote.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  import MealPlannerApiWeb.ChannelHelpers,
    only: [persist_trial_window!: 2, with_enforcement_enabled!: 1]

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Repo

  @path "/api/account/timezone"

  setup do
    user =
      user_with_memberships(%{email: "account_timezone@example.com", name: "Zone"}, [
        {%{plan: :individual, name: "Account Timezone", timezone: "Europe/Madrid"}, :owner}
      ])

    [membership] = user.memberships
    %{user: user, membership: membership, token: issue_access_v2_token(user, membership)}
  end

  describe "PUT /api/account/timezone" do
    test "stores the zone and answers the account object", %{
      conn: conn,
      membership: membership,
      token: token
    } do
      assert conn |> put_timezone(token, %{"timezone" => "Asia/Tokyo"}) |> json_response(200) ==
               %{"account" => %{"id" => membership.account_id, "timezone" => "Asia/Tokyo"}}

      assert Repo.get!(Account, membership.account_id).timezone == "Asia/Tokyo"
    end

    test "GET /api/me returns the stored zone afterwards", %{conn: conn, token: token} do
      conn |> put_timezone(token, %{"timezone" => "Asia/Tokyo"}) |> json_response(200)

      me =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/me")
        |> json_response(200)

      assert me["account"]["timezone"] == "Asia/Tokyo"
    end

    test "the Account's today follows the new zone", %{
      conn: conn,
      membership: membership,
      token: token
    } do
      # 04:00 on Oct 9 in Madrid, but still 19:00 on Oct 8 in Los Angeles.
      now = ~U[2026-10-09 02:00:00Z]
      assert AccountClock.today(membership.account_id, now) == ~D[2026-10-09]

      conn |> put_timezone(token, %{"timezone" => "America/Los_Angeles"}) |> json_response(200)

      assert AccountClock.today(membership.account_id, now) == ~D[2026-10-08]
    end

    test "last write wins", %{conn: conn, membership: membership, token: token} do
      conn |> put_timezone(token, %{"timezone" => "Asia/Tokyo"}) |> json_response(200)

      conn
      |> put_timezone(token, %{"timezone" => "America/Argentina/Buenos_Aires"})
      |> json_response(200)

      assert Repo.get!(Account, membership.account_id).timezone ==
               "America/Argentina/Buenos_Aires"
    end

    for {label, body} <- [
          {"an unknown zone", %{"timezone" => "Mars/Olympus"}},
          {"a blank zone", %{"timezone" => "   "}},
          {"an empty zone", %{"timezone" => ""}},
          {"a null zone", %{"timezone" => nil}},
          {"a missing zone", %{}},
          {"a non-string zone", %{"timezone" => 5}}
        ] do
      test "#{label} answers 422 and keeps the stored zone", %{
        conn: conn,
        membership: membership,
        token: token
      } do
        body = unquote(Macro.escape(body))

        assert %{"error" => %{"code" => "validation_error", "message" => message}} =
                 conn |> put_timezone(token, body) |> json_response(422)

        assert message =~ "timezone"
        assert Repo.get!(Account, membership.account_id).timezone == "Europe/Madrid"
      end
    end

    test "an unauthenticated request gets the 401 envelope", %{conn: conn} do
      conn =
        conn
        |> put_req_header("content-type", "application/json")
        |> put(@path, Jason.encode!(%{"timezone" => "Asia/Tokyo"}))

      assert %{"error" => %{"code" => _}} = json_response(conn, 401)
    end

    test "an expired Account still writes with capability enforcement enabled", %{
      conn: conn,
      membership: membership,
      token: token
    } do
      Account |> Repo.get!(membership.account_id) |> persist_trial_window!(:expired)

      with_enforcement_enabled!(fn ->
        assert %{"account" => %{"timezone" => "Asia/Tokyo"}} =
                 conn |> put_timezone(token, %{"timezone" => "Asia/Tokyo"}) |> json_response(200)
      end)

      assert Repo.get!(Account, membership.account_id).timezone == "Asia/Tokyo"
    end
  end

  defp put_timezone(conn, token, body) do
    conn
    |> put_req_header("authorization", "Bearer " <> token)
    |> put_req_header("content-type", "application/json")
    |> put(@path, Jason.encode!(body))
  end
end
