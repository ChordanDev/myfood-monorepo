defmodule MealPlannerApiWeb.AuthController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Accounts
  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Services.DeviceSessions
  alias MealPlannerApi.Services.RevenuecatService
  alias MealPlannerApi.Services.SubscriptionService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers

  def social(conn, %{"provider" => provider, "id_token" => id_token} = params) do
    requested_tier =
      SubscriptionService.normalize_tier(Map.get(params, "subscription_tier", "free"))

    with {:ok, identity} <- social_verifier().verify(provider, id_token, social_opts()),
         identity_params <- social_identity_to_params(identity, params),
         {:ok, %{user: user, account: account}} <-
           Accounts.find_or_create_identity(identity_params) do
      issue_auth_response(conn, user, account, requested_tier)
    else
      {:error, reason}
      when reason in [
             :unsupported_provider,
             :invalid_social_token,
             :invalid_issuer,
             :invalid_audience,
             :token_expired,
             :email_not_verified,
             :facebook_not_configured,
             :social_provider_unavailable
           ] ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: Atom.to_string(reason)})

      _ ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "unable_to_issue_token"})
    end
  end

  def social(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "invalid_social_payload"})
  end

  def password(conn, params) when is_map(params) do
    requested_tier =
      SubscriptionService.normalize_tier(Map.get(params, "subscription_tier", "free"))

    result =
      case Map.get(params, "mode", "login") do
        "register" -> Accounts.register_with_password(params)
        "login" -> Accounts.authenticate_with_password(params)
        _ -> {:error, :invalid_auth_mode}
      end

    case result do
      {:ok, %{user: user, account: account, membership: membership}} ->
        issue_auth_response(
          conn,
          user,
          account,
          requested_tier,
          issuance_typ(membership),
          membership
        )

      {:error, reason}
      when reason in [
             :invalid_email,
             :invalid_password,
             :password_too_short,
             :invalid_auth_mode
           ] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason)})

      {:error, reason}
      when reason in [
             :invalid_credentials,
             :email_already_registered
           ] ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: Atom.to_string(reason)})

      _ ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "unable_to_issue_token"})
    end
  end

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

  Only tokens handed out by the mobile verify routes can be rotated: the
  pairs the legacy routes of this controller mint have no Device session.
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

  # Phase A — Tenancy Refactor (PR 3a task 3.8): `password/2` (register +
  # login modes) picks `:access_v2` only when the flag is on AND a real
  # `AccountMembership` row came back from `Accounts.register_with_password/1`
  # / `Accounts.authenticate_with_password/1`. Without a membership row
  # (e.g. a legacy User with no matching membership on this Account yet)
  # falls back to `:access` rather than crashing `AccountsMembership.claims_for/2`.
  defp issuance_typ(%AccountMembership{}) do
    if tenancy_v2_only?(), do: :access_v2, else: :access
  end

  defp issuance_typ(_membership), do: :access

  defp tenancy_v2_only? do
    Application.get_env(:meal_planner_api, :tenancy_v2_only, false)
  end

  # `issue_auth_response/6` — the `typ:`-and-`membership` arguments control
  # which claim builder mints the token pair. `social/2` still calls the
  # 4-arg form (defaults to `:access`, `nil` membership) — social auth is
  # out of Phase A scope (design.md does not mention it). Both clauses
  # delegate the actual mint to `AccountScopeHelpers.mint_token_pair/2`
  # (post-review fix pass item 4 — single canonical implementation).
  defp issue_auth_response(conn, user, account, requested_tier, typ \\ :access, membership \\ nil)

  defp issue_auth_response(
         conn,
         user,
         account,
         requested_tier,
         :access_v2,
         %AccountMembership{} = membership
       ) do
    with resolved_tier <- RevenuecatService.resolve_tier(account.id, requested_tier),
         account <- Map.put(account, :subscription_tier, resolved_tier),
         claims <- AccountsMembership.claims_for(user, membership),
         user <- Map.put(user, :subscription_tier, resolved_tier),
         {:ok, access_token, refresh_token} <- mint_token_pair(user, claims) do
      render_auth_json(conn, user, account, resolved_tier, access_token, refresh_token)
    end
  end

  defp issue_auth_response(conn, user, account, requested_tier, _typ, _membership) do
    with resolved_tier <- RevenuecatService.resolve_tier(account.id, requested_tier),
         user <- Map.put(user, :subscription_tier, resolved_tier),
         account <- Map.put(account, :subscription_tier, resolved_tier),
         claims <- Accounts.claims_for(user, account),
         {:ok, access_token, refresh_token} <- mint_token_pair(user, claims) do
      render_auth_json(conn, user, account, resolved_tier, access_token, refresh_token)
    end
  end

  defp render_auth_json(conn, user, account, resolved_tier, access_token, refresh_token) do
    subscription =
      account.id
      |> SubscriptionService.policy_for_account()
      |> Map.put(:tier, Atom.to_string(resolved_tier))

    json(conn, %{
      access_token: access_token,
      refresh_token: refresh_token,
      token_type: "Bearer",
      user: Accounts.serialize_user(user),
      account: Accounts.serialize_account(account),
      subscription: subscription,
      websocket: %{
        path: "/socket/websocket",
        params: %{token: access_token}
      }
    })
  end

  # Post-review fix pass item 4: delegates to the single canonical
  # implementation in `AccountScopeHelpers`, shared with
  # `render_membership_auth_response/5`, instead of reimplementing
  # "mint access + mint refresh with typ stripped, else :error" here.
  defp mint_token_pair(user, claims), do: AccountScopeHelpers.mint_token_pair(user, claims)

  defp social_identity_to_params(identity, params) do
    provider = Map.get(identity, :provider)
    provider_user_id = Map.get(identity, :provider_user_id)
    stable_identity = "social:" <> provider <> ":" <> provider_user_id

    %{
      "user_id" => stable_identity,
      "account_id" => stable_identity,
      "account_type" => Map.get(params, "account_type", "individual"),
      "email" => Map.get(identity, :email),
      "name" => Map.get(identity, :name)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp social_verifier,
    do:
      Application.get_env(:meal_planner_api, :social_verifier, MealPlannerApi.Auth.SocialVerifier)

  defp social_opts do
    [
      google_client_ids: Application.get_env(:meal_planner_api, :google_oauth_client_ids, []),
      apple_client_ids: Application.get_env(:meal_planner_api, :apple_oauth_client_ids, []),
      google_tokeninfo_url:
        Application.get_env(
          :meal_planner_api,
          :google_tokeninfo_url,
          "https://oauth2.googleapis.com/tokeninfo"
        ),
      apple_jwks_url:
        Application.get_env(
          :meal_planner_api,
          :apple_jwks_url,
          "https://appleid.apple.com/auth/keys"
        ),
      facebook_app_id: Application.get_env(:meal_planner_api, :facebook_app_id),
      facebook_app_secret: Application.get_env(:meal_planner_api, :facebook_app_secret),
      facebook_graph_url:
        Application.get_env(
          :meal_planner_api,
          :facebook_graph_url,
          "https://graph.facebook.com"
        )
    ]
  end
end
