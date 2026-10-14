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

  A verified code ends in a Device session opened by
  `MealPlannerApi.Services.DeviceSessions` (issue #9); its refresh token
  is rotated and revoked by `POST /api/auth/refresh` and
  `POST /api/auth/logout` in `MealPlannerApiWeb.AuthController`.
  """
  use MealPlannerApiWeb, :controller

  require Logger

  alias MealPlannerApi.Services.DeviceSessions
  alias MealPlannerApi.Services.EmailCodeAuth
  alias MealPlannerApi.Services.EmailCodeLogin
  alias MealPlannerApi.Services.EmailCodeSignup
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.ClientIp
  alias MealPlannerApiWeb.CurrentMe

  @max_verify_failures_per_ip EmailCodeAuth.max_verify_failures_per_ip()

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
  `code_expired`, `too_many_attempts`, `account_not_found`, or
  `rate_limited` (with a `retry-after` header in whole seconds) once the
  client IP (for IPv6, its whole /64 prefix) has
  #{@max_verify_failures_per_ip} failed verifications in the last hour.

  The session is opened in the transaction that consumes the code: when
  it cannot be opened, the code stays pending and the user can retry.

  `deviceId` must be one `MealPlannerApi.Services.DeviceSessions.valid_device_id?/1`
  accepts: a string that is not blank, in practice the UUID the app
  generates. It names the phone the Device session belongs to: the
  session is stored with it, and it replaces the one this User already
  had on that phone. A request without a valid `deviceId` is answered
  `code_invalid` before the code is looked at, so it neither spends the
  code nor counts as an attempt.
  """
  def verify_login_code(conn, params) do
    client_ip = ClientIp.resolve(conn)

    conn
    |> open_session(params, &EmailCodeLogin.verify_code(&1, &2, client_ip, &3))
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
    conn |> open_session(params, &EmailCodeSignup.verify_code/3)
  end

  # `verify` checks the code and opens the session through the function
  # it is given, in the transaction that consumes the code.
  defp open_session(conn, params, verify) do
    device_id = params["deviceId"]

    with :ok <- validate_device_id(device_id),
         {:ok, %{me: me, tokens: tokens}} <-
           verify.(params["email"], params["code"], &build_session(&1, &2, device_id)) do
      json(conn, %{
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: "Bearer",
        me: me
      })
    else
      {:error, :rate_limited, retry_after} ->
        conn
        |> put_resp_header("retry-after", Integer.to_string(retry_after))
        |> ApiError.error(:rate_limited)

      {:error, :device_id_invalid} ->
        conn |> ApiError.error(:code_invalid)

      {:error, :code_invalid} ->
        conn |> ApiError.error(:code_invalid)

      {:error, :code_expired} ->
        conn |> ApiError.error(:code_expired)

      {:error, :too_many_attempts} ->
        conn |> ApiError.error(:too_many_attempts)

      {:error, :account_not_found} ->
        conn |> ApiError.error(:account_not_found)

      {:error, :email_already_exists} ->
        conn |> ApiError.error(:email_already_exists)

      {:error, :registration_failed} ->
        conn |> ApiError.server_fault()

      {:error, :session_issue_failed} ->
        conn |> ApiError.server_fault()

      {:error, unexpected} ->
        Logger.error("verify-code failed with an unexpected error: #{describe_error(unexpected)}")
        conn |> ApiError.server_fault()
    end
  end

  # Only an atom is logged as it is: any other reason may carry the email
  # or other request data.
  defp describe_error(reason) when is_atom(reason), do: inspect(reason)
  defp describe_error(_reason), do: "a non-atom reason"

  # The `me` payload and the Device session of a verified code.
  defp build_session(user, membership, device_id) do
    with {:ok, me} <- CurrentMe.load(user, membership),
         {:ok, tokens} <- DeviceSessions.open(user, membership, device_id) do
      {:ok, %{me: me, tokens: tokens}}
    end
  end

  # The rule is `DeviceSessions.valid_device_id?/1`; it is asked first so
  # that a `deviceId` no session could be stored with never costs a code.
  defp validate_device_id(device_id) do
    if DeviceSessions.valid_device_id?(device_id), do: :ok, else: {:error, :device_id_invalid}
  end
end
