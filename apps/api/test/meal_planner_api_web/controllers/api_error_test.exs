defmodule MealPlannerApiWeb.ApiErrorTest do
  @moduledoc """
  Unit coverage for `MealPlannerApiWeb.ApiError`, the single renderer for
  the mobile error envelope `{"error": {"code": ..., "message": ...}}`
  (issue #1, "Error envelope helper").
  """
  use MealPlannerApiWeb.ConnCase, async: true

  alias MealPlannerApiWeb.ApiError

  describe "error/2" do
    test "renders the envelope with the status mapped for the code and halts", %{conn: conn} do
      conn = conn |> ApiError.error(:unauthenticated)

      assert conn.halted
      assert conn.status == 401
      assert [content_type] = get_resp_header(conn, "content-type")
      assert content_type =~ "application/json"

      assert %{"error" => %{"code" => "unauthenticated", "message" => message}} =
               json_response(conn, 401)

      assert is_binary(message) and message != ""
    end

    test "maps every T1 code to its HTTP status", %{conn: conn} do
      assert (conn |> ApiError.error(:access_token_expired)).status == 401
      assert (conn |> ApiError.error(:account_not_found)).status == 401
      assert (conn |> ApiError.error(:trial_expired)).status == 403
    end

    test "raises for a code outside the mobile allowlist", %{conn: conn} do
      assert_raise FunctionClauseError, fn ->
        ApiError.error(conn, :not_a_mobile_code)
      end
    end
  end

  describe "server_fault/1" do
    test "renders unknown_error with 500", %{conn: conn} do
      conn = conn |> ApiError.server_fault()

      assert conn.halted
      assert %{"error" => %{"code" => "unknown_error", "message" => _}} = json_response(conn, 500)
    end
  end
end
