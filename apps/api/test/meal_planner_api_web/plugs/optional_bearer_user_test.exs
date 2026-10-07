defmodule MealPlannerApiWeb.Plugs.OptionalBearerUserTest do
  @moduledoc """
  Coverage for `MealPlannerApiWeb.Plugs.OptionalBearerUser` (the optional
  bearer decoder in front of `POST /api/auth/email-code/verify`).

  Issue #1 ("Error envelope helper"): an invalid bearer is rejected with
  the mobile envelope `401 unauthenticated`; the pass-through paths are
  unchanged.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApiWeb.Plugs.OptionalBearerUser

  describe "through POST /api/auth/email-code/verify" do
    test "an invalid bearer is rejected with 401 unauthenticated before the service runs",
         %{conn: conn} do
      conn =
        conn
        |> put_req_header("authorization", "Bearer not-a-real-jwt-token")
        |> post("/api/auth/email-code/verify", %{"email" => "x@example.com", "code" => "000000"})

      assert conn.halted

      assert %{"error" => %{"code" => "unauthenticated", "message" => _}} =
               json_response(conn, 401)
    end
  end

  describe "call/2" do
    test "a non-Bearer Authorization scheme is rejected with 401 unauthenticated", %{conn: conn} do
      conn =
        conn
        |> put_req_header("authorization", "Basic abc")
        |> OptionalBearerUser.call([])

      assert conn.halted

      assert %{"error" => %{"code" => "unauthenticated", "message" => _}} =
               json_response(conn, 401)
    end

    test "no Authorization header passes through without an assignment", %{conn: conn} do
      conn = OptionalBearerUser.call(conn, [])

      refute conn.halted
      refute Map.has_key?(conn.assigns, :optional_current_user_id)
    end

    test "a valid bearer assigns the decoded subject", %{conn: conn} do
      user =
        user_with_memberships(%{email: "optional-bearer@example.com"}, [
          {%{plan: :individual, name: "Optional Bearer"}, :owner}
        ])

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)
      {:ok, %{"sub" => sub}} = Guardian.decode_and_verify(token)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> OptionalBearerUser.call([])

      refute conn.halted
      assert conn.assigns.optional_current_user_id == sub
    end
  end
end
