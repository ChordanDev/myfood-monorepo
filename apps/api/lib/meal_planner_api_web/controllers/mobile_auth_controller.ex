defmodule MealPlannerApiWeb.MobileAuthController do
  @moduledoc """
  Mobile login with an email code (issue #7):

    * `POST /api/auth/login/request-code` — body `{ "email" }`
    * `POST /api/auth/login/verify-code` — body `{ "email", "code", "deviceId" }`

  A thin translator over `MealPlannerApi.Services.EmailCodeLogin`: it reads
  the camelCase body, and renders either the success body typed in
  `apps/mobile/src/features/auth/types/auth.ts` or the error envelope
  through `MealPlannerApiWeb.ApiError`.
  """
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Services.EmailCodeLogin
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers
  alias MealPlannerApiWeb.CurrentMe

  @doc """
  `POST /api/auth/login/request-code`.

  `200 { "status": "code_sent", "expiresInSeconds", "resendAvailableInSeconds" }`,
  or `invalid_email`, `email_not_found`, `rate_limited` (with a `retry-after`
  header in whole seconds) or `code_send_failed`.
  """
  def request_login_code(conn, params) do
    case EmailCodeLogin.request_code(params["email"], client_ip(conn)) do
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
    with :ok <- validate_device_id(params["deviceId"]),
         {:ok, %{user: user, membership: membership}} <-
           EmailCodeLogin.verify_code(params["email"], params["code"]),
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
      {:error, :token_refresh_failed} -> conn |> ApiError.server_fault()
    end
  end

  defp validate_device_id(device_id) when is_binary(device_id) do
    if String.trim(device_id) == "", do: {:error, :device_id_required}, else: :ok
  end

  defp validate_device_id(_device_id), do: {:error, :device_id_required}

  # Same client address rule as `EmailCodeAuthController`, so both request
  # routes count against one per-IP bucket: the first `x-forwarded-for`
  # entry when present, else the socket address as a dotted IPv4.
  defp client_ip(conn) do
    case get_req_header(conn, "x-forwarded-for") do
      [ip | _] when byte_size(ip) > 0 -> String.trim(ip)
      _ -> format_remote_ip(conn.remote_ip)
    end
  end

  defp format_remote_ip({a, b, c, d}), do: "#{a}.#{b}.#{c}.#{d}"
  defp format_remote_ip(_), do: nil
end
