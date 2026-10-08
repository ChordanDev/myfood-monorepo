defmodule MealPlannerApiWeb.MobileAuthController do
  @moduledoc """
  Mobile login (issue #7) and sign-up (issue #8) with an email code:

    * `POST /api/auth/login/request-code` — body `{ "email" }`
    * `POST /api/auth/login/verify-code` — body `{ "email", "code", "deviceId" }`
    * `POST /api/auth/signup/request-code` — body `{ "email" }`
    * `POST /api/auth/signup/verify-code` — body `{ "email", "code", "deviceId" }`

  A thin translator over `MealPlannerApi.Services.EmailCodeLogin` and
  `MealPlannerApi.Services.EmailCodeSignup`: it reads the camelCase body,
  and renders either the success body typed in
  `apps/mobile/src/features/auth/types/auth.ts` or the error envelope
  through `MealPlannerApiWeb.ApiError`.
  """
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Services.EmailCodeLogin
  alias MealPlannerApi.Services.EmailCodeSignup
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.ClientIp
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers
  alias MealPlannerApiWeb.CurrentMe

  @doc """
  `POST /api/auth/login/request-code`.

  `200 { "status": "code_sent", "expiresInSeconds", "resendAvailableInSeconds" }`,
  or `invalid_email`, `email_not_found`, `rate_limited` (with a `retry-after`
  header in whole seconds) or `code_send_failed`.
  """
  def request_login_code(conn, params) do
    conn
    |> render_code_request(EmailCodeLogin.request_code(params["email"], ClientIp.resolve(conn)))
  end

  @doc """
  `POST /api/auth/signup/request-code`.

  Same answers as `request_login_code/2`, except that the email must not
  have a User yet: one that does gets `email_already_exists` instead of
  `email_not_found`.
  """
  def request_signup_code(conn, params) do
    conn
    |> render_code_request(EmailCodeSignup.request_code(params["email"], ClientIp.resolve(conn)))
  end

  defp render_code_request(conn, result) do
    case result do
      {:ok, sent} ->
        json(conn, %{
          status: "code_sent",
          expiresInSeconds: sent.expires_in_seconds,
          resendAvailableInSeconds: sent.resend_available_in_seconds
        })

      {:error, :rate_limited, retry_after} ->
        conn
        |> put_resp_header("retry-after", Integer.to_string(retry_after))
        |> ApiError.error(:rate_limited)

      {:error, :invalid_email} ->
        conn |> ApiError.error(:invalid_email)

      {:error, :email_not_found} ->
        conn |> ApiError.error(:email_not_found)

      {:error, :email_already_exists} ->
        conn |> ApiError.error(:email_already_exists)

      {:error, :code_send_failed} ->
        conn |> ApiError.error(:code_send_failed)
    end
  end

  @doc """
  `POST /api/auth/login/verify-code`.

  `200 { "accessToken", "refreshToken", "tokenType": "Bearer", "me" }`, where
  `me` is the same payload `GET /api/me` returns, or `code_invalid`,
  `code_expired`, `too_many_attempts` or `account_not_found`.

  `deviceId` must be a non-empty string. It is not stored yet: Device
  sessions start persisting it with the refresh-rotation work. A request
  without it is answered `code_invalid` before the code is looked at, so it
  neither spends the code nor counts as an attempt.
  """
  def verify_login_code(conn, params) do
    conn |> open_session(params, &EmailCodeLogin.verify_code/2)
  end

  @doc """
  `POST /api/auth/signup/verify-code`.

  The body and the `200` answer of `verify_login_code/2`: a sign-up ends
  in the same session a login does. A right code creates the User, their
  Account, the owner Membership and the Trial before the session opens.
  Errors are `code_invalid`, `code_expired`, `too_many_attempts`, or
  `email_already_exists` when the email got a User after the code was sent.
  """
  def verify_signup_code(conn, params) do
    conn |> open_session(params, &EmailCodeSignup.verify_code/2)
  end

  # `verify` checks the code and answers the User and Membership the
  # session is for.
  defp open_session(conn, params, verify) do
    with :ok <- validate_device_id(params["deviceId"]),
         {:ok, %{user: user, membership: membership}} <-
           verify.(params["email"], params["code"]),
         {:ok, me} <- CurrentMe.load(user, membership),
         {:ok, access_token, refresh_token} <-
           AccountScopeHelpers.mint_token_pair(
             user,
             AccountsMembership.claims_for(user, membership)
           ) do
      json(conn, %{
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenType: "Bearer",
        me: me
      })
    else
      {:error, :device_id_required} -> conn |> ApiError.error(:code_invalid)
      {:error, :code_invalid} -> conn |> ApiError.error(:code_invalid)
      {:error, :code_expired} -> conn |> ApiError.error(:code_expired)
      {:error, :too_many_attempts} -> conn |> ApiError.error(:too_many_attempts)
      {:error, :account_not_found} -> conn |> ApiError.error(:account_not_found)
      {:error, :email_already_exists} -> conn |> ApiError.error(:email_already_exists)
      {:error, :registration_failed} -> conn |> ApiError.server_fault()
      {:error, :token_refresh_failed} -> conn |> ApiError.server_fault()
    end
  end

  defp validate_device_id(device_id) when is_binary(device_id) do
    if String.trim(device_id) == "", do: {:error, :device_id_required}, else: :ok
  end

  defp validate_device_id(_device_id), do: {:error, :device_id_required}
end
