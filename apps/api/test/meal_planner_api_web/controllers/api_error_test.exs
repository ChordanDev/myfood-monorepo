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

    test "maps every mobile login code to its HTTP status", %{conn: conn} do
      assert (conn |> ApiError.error(:invalid_email)).status == 422
      assert (conn |> ApiError.error(:email_not_found)).status == 404
      assert (conn |> ApiError.error(:rate_limited)).status == 429
      assert (conn |> ApiError.error(:code_invalid)).status == 422
      assert (conn |> ApiError.error(:code_expired)).status == 401
      assert (conn |> ApiError.error(:too_many_attempts)).status == 429
      assert (conn |> ApiError.error(:code_send_failed)).status == 502
    end

    test "maps the mobile sign-up code to its HTTP status", %{conn: conn} do
      conn = conn |> ApiError.error(:email_already_exists)

      assert %{"error" => %{"code" => "email_already_exists"}} = json_response(conn, 409)
    end

    test "keeps a response header set on the conn before rendering", %{conn: conn} do
      conn =
        conn
        |> put_resp_header("retry-after", "42")
        |> ApiError.error(:rate_limited)

      assert get_resp_header(conn, "retry-after") == ["42"]
      assert %{"error" => %{"code" => "rate_limited"}} = json_response(conn, 429)
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
