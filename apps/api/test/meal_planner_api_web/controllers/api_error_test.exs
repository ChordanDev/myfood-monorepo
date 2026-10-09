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

    test "maps every refresh token code to 401", %{conn: conn} do
      assert (conn |> ApiError.error(:refresh_token_invalid)).status == 401
      assert (conn |> ApiError.error(:refresh_token_revoked)).status == 401
      assert (conn |> ApiError.error(:refresh_token_replayed)).status == 401
      assert (conn |> ApiError.error(:refresh_token_expired)).status == 401
      assert (conn |> ApiError.error(:refresh_token_session_mismatch)).status == 401
    end

    test "renders a refresh token code in the envelope", %{conn: conn} do
      conn = conn |> ApiError.error(:refresh_token_replayed)

      assert %{"error" => %{"code" => "refresh_token_replayed", "message" => message}} =
               json_response(conn, 401)

      assert is_binary(message) and message != ""
    end

    test "maps the recipe detail code to its HTTP status", %{conn: conn} do
      conn = conn |> ApiError.error(:recipe_not_found)

      assert %{"error" => %{"code" => "recipe_not_found", "message" => message}} =
               json_response(conn, 404)

      assert is_binary(message) and message != ""
    end

    test "maps the Onboarding profile codes to 422", %{conn: conn} do
      assert (conn |> ApiError.error(:validation_error)).status == 422

      conn = conn |> ApiError.error(:invalid_cooking_skill)

      assert %{"error" => %{"code" => "invalid_cooking_skill", "message" => message}} =
               json_response(conn, 422)

      assert is_binary(message) and message != ""
    end

    test "maps every User preferences code to 422", %{conn: conn} do
      assert (conn |> ApiError.error(:invalid_diet)).status == 422
      assert (conn |> ApiError.error(:invalid_hard_restriction)).status == 422
    end

    test "maps the inventory code to its HTTP status", %{conn: conn} do
      conn = conn |> ApiError.error(:inventory_item_not_found)

      assert %{"error" => %{"code" => "inventory_item_not_found", "message" => message}} =
               json_response(conn, 404)

      assert is_binary(message) and message != ""
    end

    test "maps the manual Shopping item codes to their HTTP status", %{conn: conn} do
      assert (conn |> ApiError.error(:shopping_item_not_manual)).status == 422
      assert (conn |> ApiError.error(:shopping_item_not_found)).status == 404
      assert (conn |> ApiError.error(:shopping_item_not_planned)).status == 422
      assert (conn |> ApiError.error(:shopping_item_in_cart)).status == 409
    end

    test "keeps a response header set on the conn before rendering", %{conn: conn} do
      conn =
        conn
        |> put_resp_header("retry-after", "42")
        |> ApiError.error(:rate_limited)

      assert get_resp_header(conn, "retry-after") == ["42"]
      assert %{"error" => %{"code" => "rate_limited"}} = json_response(conn, 429)
    end

    test "maps the Cooking session codes to their HTTP status", %{conn: conn} do
      for {code, status} <- [
            scheduled_meal_not_found: 404,
            cooking_session_not_active: 409,
            cooking_already_finished: 409,
            cooking_chat_unavailable: 409,
            inventory_mutation_failed: 422
          ] do
        assert {code, ApiError.error(conn, code).status} == {code, status}
      end
    end

    test "maps the Slot cooking times codes to their HTTP status", %{conn: conn} do
      assert (conn |> ApiError.error(:slot_cooking_times_not_found)).status == 404
      assert (conn |> ApiError.error(:invalid_hunger_level)).status == 422
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

    test "renders the unknown_error envelope as its body", %{conn: conn} do
      conn = conn |> ApiError.server_fault()

      assert json_response(conn, 500) == json_round_trip(ApiError.unknown_error_envelope())
    end
  end

  describe "validation_error/2" do
    test "renders validation_error with 422 and halts", %{conn: conn} do
      conn = conn |> ApiError.validation_error("householdSize")

      assert conn.halted
      assert [content_type] = get_resp_header(conn, "content-type")
      assert content_type =~ "application/json"
      assert %{"error" => %{"code" => "validation_error"}} = json_response(conn, 422)
    end

    test "names the field in the message and adds nothing else to the envelope", %{conn: conn} do
      generic = ApiError.envelope(:validation_error).error.message

      for field <- ~w(displayName householdSize) do
        assert %{"error" => error} =
                 conn |> ApiError.validation_error(field) |> json_response(422)

        assert %{"code" => "validation_error", "message" => message} = error
        assert map_size(error) == 2
        assert message =~ field
        refute message == generic
      end
    end
  end

  describe "envelope/1" do
    test "returns the bare envelope map for an allowlisted code" do
      assert ApiError.envelope(:unauthenticated) == %{
               error: %{
                 code: :unauthenticated,
                 message: "Authentication is required for this request."
               }
             }
    end

    test "is the body error/2 renders, for every code", %{conn: conn} do
      for code <- ApiError.codes() do
        rendered = ApiError.error(conn, code)

        assert Jason.decode!(rendered.resp_body) == json_round_trip(ApiError.envelope(code))
      end
    end

    test "raises for a code outside the allowlist" do
      assert_raise FunctionClauseError, fn -> ApiError.envelope(:not_a_mobile_code) end
    end

    test "raises for unknown_error, which is not a domain code" do
      assert_raise FunctionClauseError, fn -> ApiError.envelope(:unknown_error) end
    end
  end

  describe "unknown_error_envelope/0" do
    test "returns the envelope used for unexpected failures" do
      assert ApiError.unknown_error_envelope() == %{
               error: %{code: :unknown_error, message: "An unexpected error occurred."}
             }
    end
  end

  describe "planning channel codes" do
    # Every deliberate error reason the planning channel replies, with the
    # HTTP status the same code would get on an HTTP route.
    @channel_codes %{
      generation_in_progress: 409,
      no_active_generation: 409,
      missing_session_id: 422,
      account_expired: 403,
      invalid_proposal_id: 422,
      not_found: 404,
      subscription_required: 403,
      invalid_range: 422,
      overlapping_range: 409,
      forbidden_intent: 422,
      unknown_intent: 422,
      invalid_payload: 422,
      session_mismatch: 409,
      no_active_session: 409,
      forbidden: 403,
      already_confirmed: 409,
      foreign_lock: 403,
      not_a_member: 403,
      missing_lock: 409,
      lost_lock: 409,
      terminal_lock: 409,
      transaction_failed: 409,
      already_active: 409,
      invalid_identity: 401,
      invalid_date: 422,
      invalid_date_range: 422,
      optimization_failed: 422,
      optimizer_unavailable: 503,
      optimizer_timeout: 504
    }

    test "have an envelope with a message each" do
      for {code, _status} <- @channel_codes do
        assert %{error: %{code: ^code, message: message}} = ApiError.envelope(code)
        assert is_binary(message) and message != ""
      end
    end

    test "map to their HTTP status", %{conn: conn} do
      for {code, status} <- @channel_codes do
        assert {code, ApiError.error(conn, code).status} == {code, status}
      end
    end

    test "are listed by codes/0 next to the codes of the HTTP routes" do
      auth_codes =
        ~w(unauthenticated access_token_expired account_not_found trial_expired invalid_email
           email_not_found rate_limited code_invalid code_expired too_many_attempts
           code_send_failed email_already_exists refresh_token_invalid refresh_token_revoked
           refresh_token_replayed refresh_token_expired refresh_token_session_mismatch)a

      profile_codes = ~w(validation_error invalid_cooking_skill)a
      slot_cooking_times_codes = ~w(slot_cooking_times_not_found invalid_hunger_level)a

      # The codes of `PUT /api/me/preferences` (issue #18) that are its own.
      preferences_codes = ~w(invalid_diet invalid_hard_restriction)a

      # The codes of the Cooking session routes (issue #35).
      cooking_codes =
        ~w(scheduled_meal_not_found cooking_session_not_active cooking_already_finished
           cooking_chat_unavailable inventory_mutation_failed)a

      assert Enum.sort(ApiError.codes()) ==
               Enum.sort(
                 auth_codes ++
                   [:recipe_not_found] ++
                   profile_codes ++
                   slot_cooking_times_codes ++
                   preferences_codes ++
                   cooking_codes ++
                   [
                     :inventory_item_not_found,
                     :shopping_item_not_manual,
                     :shopping_item_not_found,
                     :shopping_item_not_planned,
                     :shopping_item_in_cart
                   ] ++
                   Map.keys(@channel_codes)
               )
    end
  end

  # An envelope as a client reads it: string keys and a string code.
  defp json_round_trip(envelope), do: envelope |> Jason.encode!() |> Jason.decode!()
end
