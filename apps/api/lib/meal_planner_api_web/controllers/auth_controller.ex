defmodule MealPlannerApiWeb.AuthController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.DeviceSessions
  alias MealPlannerApiWeb.ApiError

  @doc """
  `POST /api/auth/refresh` — body `{ "refreshToken" }`.

  Rotates the Device session of the presented refresh token and answers
  `200 { "accessToken", "refreshToken", "tokenType": "Bearer" }`, without
  `me`. A token that cannot be rotated gets `refresh_token_invalid`,
  `refresh_token_replayed`, `refresh_token_revoked`,
  `refresh_token_expired` or `refresh_token_session_mismatch`, and a
  session whose Membership is no longer active gets `account_not_found`;
  all of them answer `401`. See `MealPlannerApi.Services.DeviceSessions.rotate/1`
  for what each one means.

  Only tokens handed out by the mobile verify routes can be rotated: a
  refresh token minted without a Device session gets
  `refresh_token_invalid`.
  """
  def refresh(conn, params) do
    case DeviceSessions.rotate(params["refreshToken"]) do
      {:ok, tokens} ->
        json(conn, %{
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenType: "Bearer"
        })

      {:error, :refresh_token_invalid} ->
        conn |> ApiError.error(:refresh_token_invalid)

      {:error, :refresh_token_replayed} ->
        conn |> ApiError.error(:refresh_token_replayed)

      {:error, :refresh_token_revoked} ->
        conn |> ApiError.error(:refresh_token_revoked)

      {:error, :refresh_token_expired} ->
        conn |> ApiError.error(:refresh_token_expired)

      {:error, :refresh_token_session_mismatch} ->
        conn |> ApiError.error(:refresh_token_session_mismatch)

      {:error, :account_not_found} ->
        conn |> ApiError.error(:account_not_found)

      {:error, :session_issue_failed} ->
        conn |> ApiError.server_fault()
    end
  end

  @doc """
  `POST /api/auth/logout` — body `{ "refreshToken" }`.

  Revokes the Device session of the presented refresh token and answers
  `204` with no body. The route takes no access token, so the app can log
  out after its access token expired, and it answers the same `204` for a
  token that is unknown, already revoked or missing.
  """
  def logout(conn, params) do
    DeviceSessions.revoke(params["refreshToken"])
    send_resp(conn, :no_content, "")
  end
end
