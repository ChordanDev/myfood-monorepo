defmodule MealPlannerApiWeb.InviteController do
  @moduledoc """
  Owner-invites-member + invitee-accepts flows (Phase A — Tenancy
  Refactor, PR 3a tasks 3.3 / 3.4). See `specs/invite-and-accept.md`.
  """

  use MealPlannerApiWeb, :controller

  require Logger

  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Services.DeviceSessions
  alias MealPlannerApiWeb.ClientIp
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers
  alias MealPlannerApiWeb.CurrentMe
  alias MealPlannerApiWeb.Plugs.VerifyTokenType

  @doc """
  `POST /api/accounts/:account_id/invites` — owner-only. Body:
  `{"email": "..."}`. Returns `201 {invite: {token, expires_at,
  membership_id, email}}`. Errors per spec §6.1: `403 not_owner`,
  `409 seat_cap_reached`, `409 already_invited`, `409 already_a_member`.
  """
  def create(conn, %{"account_id" => account_id, "email" => email}) do
    actor = conn.assigns.current_membership

    with {:ok, account} <- AccountScopeHelpers.load_account(account_id),
         {:ok, result} <- AccountsMembership.invite(account, actor, email) do
      conn
      |> put_status(:created)
      |> json(%{
        invite: %{
          token: result.token,
          expires_at: result.expires_at,
          membership_id: result.membership_id,
          email: result.email
        }
      })
    else
      {:error, :account_not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "account_not_found"})

      {:error, reason} ->
        conn |> put_status(error_status(reason)) |> json(%{error: Atom.to_string(reason)})
    end
  end

  @doc """
  `POST /api/invites/:token/code` — no auth, body ignored. Mails a code to
  the email the invite was sent to, never to an address from the request,
  for an accept with `{"code"}` (issue #297). Returns `200 {status:
  "code_sent", expires_in_seconds, resend_available_in_seconds}`. Errors:
  `404 invite_token_unknown`, `410 invite_token_used`,
  `410 invite_token_expired`, `429 rate_limited` (with a `retry-after`
  header in whole seconds: the resend cooldown or an hourly request limit
  of the email-code login) and `502 code_send_failed`.
  """
  def request_code(conn, %{"token" => token}) do
    case AccountsMembership.request_invite_code(token, ClientIp.resolve(conn)) do
      {:ok, sent} ->
        json(conn, %{
          status: "code_sent",
          expires_in_seconds: sent.expires_in_seconds,
          resend_available_in_seconds: sent.resend_available_in_seconds
        })

      {:error, :rate_limited, retry_after} ->
        rate_limited(conn, retry_after)

      {:error, reason} ->
        conn |> put_status(error_status(reason)) |> json(%{error: Atom.to_string(reason)})
    end
  end

  @doc """
  `POST /api/invites/:token/accept` — no `:auth` pipeline: an invitee
  with no session proves the invited email with `{"code": ...,
  "deviceId": ...}`, the code `request_code/2` mailed to it (issues #297
  and #274), and an existing User with a session may instead send `{}`
  with their Bearer token in the `Authorization` header. Holding the
  token alone is never enough to join. Any other key in the body is
  ignored. A body with a `code` key always takes the code path, whatever
  the value: `code` wins over the `Authorization` header, and a `code`
  that is not a non-empty string answers `422 code_invalid`. The code
  accept also reads an optional `name`: a non-empty string becomes the
  name of the invited User while it is still the stub the invite created
  for an email nobody has signed in with, and is ignored for a registered
  User. The name is trimmed and follows the rules of a profile name: any
  other `name`, including a blank one, one longer than 64 graphemes or 255
  code points, or one with a NUL character, is ignored like an unknown key. A code accept
  signs the invitee in as the email-code login does: it answers the `200`
  of `POST /api/auth/login/verify-code` (`accessToken`, `refreshToken`,
  `tokenType`, `me`) and opens a Device session on `deviceId`, validated
  as the login validates it (an invalid one is `422 code_invalid` before
  the code is looked at). Errors:
  `401 unauthorized` (no `code` and no valid Bearer token, a `name`
  included), `403 invite_for_another_user`
  (a Bearer token of a User the invite is not bound to),
  `410 invite_token_used`,
  `410 invite_token_expired`, and for a `code`: `422 code_invalid`,
  `401 code_expired`, `429 too_many_attempts` and `429 rate_limited` (a
  wrong, expired or locked code from a client IP that has too many failed
  code checks in the last hour; with a `retry-after` header). The right
  digits of a code that is still valid are never refused by that limit.
  """
  def accept(conn, %{"token" => token, "code" => code} = params) do
    device_id = params["deviceId"]

    with :ok <- validate_device_id(device_id),
         {:ok, %{session: %{me: me, tokens: tokens}}} <-
           AccountsMembership.accept_invite(token, %{
             code: code,
             name: claim_name(params["name"]),
             client_ip: ClientIp.resolve(conn),
             open_session: &build_session(&1, &2, device_id)
           }) do
      json(conn, %{
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: "Bearer",
        me: me
      })
    else
      {:error, :device_id_invalid} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "code_invalid"})

      {:error, :rate_limited, retry_after} ->
        rate_limited(conn, retry_after)

      {:error, %Ecto.Changeset{} = changeset} ->
        Logger.warning(
          "invite accept rejected reason=membership_conflict errors=#{inspect(changeset.errors)}"
        )

        conn |> put_status(:conflict) |> json(%{error: "already_a_member"})

      {:error, reason} ->
        Logger.warning("invite code accept rejected reason=#{reason}")
        conn |> put_status(error_status(reason)) |> json(%{error: Atom.to_string(reason)})
    end
  end

  def accept(conn, %{"token" => token}) do
    case resolve_invitee(conn) do
      {:ok, invitee_arg} ->
        case AccountsMembership.accept_invite(token, invitee_arg) do
          {:ok, %{user: user, account: account, membership: membership, claims: claims}} ->
            AccountScopeHelpers.render_membership_auth_response(
              conn,
              user,
              account,
              membership,
              claims
            )

          {:error, reason}
          when reason in [:invite_token_used, :invite_token_expired, :invite_token_unknown] ->
            Logger.warning("invite accept rejected reason=#{reason}")
            conn |> put_status(error_status(reason)) |> json(%{error: Atom.to_string(reason)})

          # Second post-review fix pass: `accept_invite_with_lookup/2`'s
          # `Repo.update/1` call can fail the
          # `account_memberships_active_account_user_unique_index` partial
          # unique constraint (e.g. two `:invited` rows for the same
          # (account_id, user_id) — a retried/duplicate invite, or a
          # concurrent-accept race), propagating `{:error, %Ecto.Changeset{}}`
          # instead of an atom. `Atom.to_string/1` on a `%Ecto.Changeset{}`
          # raises `ArgumentError`. Treat it as the same conflict outcome as
          # `:already_a_member` (409) — a duplicate accept is conceptually
          # the same thing, just detected one layer down.
          {:error, %Ecto.Changeset{} = changeset} ->
            Logger.warning(
              "invite accept rejected reason=membership_conflict errors=#{inspect(changeset.errors)}"
            )

            conn |> put_status(:conflict) |> json(%{error: "already_a_member"})

          {:error, reason} ->
            conn |> put_status(error_status(reason)) |> json(%{error: Atom.to_string(reason)})
        end

      :unauthenticated ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "unauthorized"})
    end
  end

  # The `me` payload and the Device session of a code accept, as
  # `MealPlannerApiWeb.MobileAuthController` builds them for a login.
  defp build_session(user, membership, device_id) do
    with {:ok, me} <- CurrentMe.load(user, membership),
         {:ok, tokens} <- DeviceSessions.open(user, membership, device_id) do
      {:ok, %{me: me, tokens: tokens}}
    end
  end

  # Asked first, as the login asks it, so that a `deviceId` no session
  # could be stored with never costs a code.
  defp validate_device_id(device_id) do
    if DeviceSessions.valid_device_id?(device_id), do: :ok, else: {:error, :device_id_invalid}
  end

  # Only a non-empty string is passed on; anything else is ignored.
  # `AccountsMembership.accept_invite/2` trims the string and also ignores
  # one a profile name could not be (blank, longer than 64 graphemes or 255
  # code points, with a NUL character).
  defp claim_name(name) when is_binary(name) and name != "", do: name
  defp claim_name(_name), do: nil

  # Bearer path: identify the caller via an optional Authorization header
  # (manual decode, NOT the `:auth` pipeline, since this route must also
  # serve code accepts with no session). A body without a `code` and
  # without a valid Bearer token is refused, whatever else it carries.
  #
  # Post-review fix pass, item 8 (security): Guardian's
  # `decode_and_verify/1` never checks `typ` on its own — without the
  # explicit `claims["typ"] in supported_typs()` assertion below, a
  # `refresh`-typed token presented as this Bearer header would
  # authenticate the caller just like a real access token.
  defp resolve_invitee(conn) do
    with [header] <- Plug.Conn.get_req_header(conn, "authorization"),
         "Bearer " <> raw_token <- header,
         {:ok, claims} <- Guardian.decode_and_verify(raw_token),
         true <-
           Map.get(claims, "typ") in VerifyTokenType.supported_typs(),
         {:ok, user} <- Guardian.resource_from_claims(claims) do
      {:ok, user}
    else
      _ -> :unauthenticated
    end
  end

  defp rate_limited(conn, retry_after) do
    conn
    |> put_resp_header("retry-after", Integer.to_string(retry_after))
    |> put_status(:too_many_requests)
    |> json(%{error: "rate_limited"})
  end

  # The code errors answer with the statuses of the email-code login
  # (`MealPlannerApiWeb.ApiError`).
  defp error_status(:not_owner), do: :forbidden
  defp error_status(:seat_cap_reached), do: :conflict
  defp error_status(:already_invited), do: :conflict
  defp error_status(:already_a_member), do: :conflict
  defp error_status(:invite_token_used), do: :gone
  defp error_status(:invite_token_expired), do: :gone
  defp error_status(:invite_token_unknown), do: :not_found
  defp error_status(:invalid_invitee), do: :bad_request
  defp error_status(:invite_for_another_user), do: :forbidden
  defp error_status(:code_invalid), do: :unprocessable_entity
  defp error_status(:code_expired), do: :unauthorized
  defp error_status(:too_many_attempts), do: :too_many_requests
  defp error_status(:code_send_failed), do: :bad_gateway
  defp error_status(:session_issue_failed), do: :internal_server_error
  defp error_status(_), do: :unprocessable_entity
end
