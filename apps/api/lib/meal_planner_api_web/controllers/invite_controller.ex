defmodule MealPlannerApiWeb.InviteController do
  @moduledoc """
  Owner-invites-member + invitee-accepts flows (Phase A — Tenancy
  Refactor, PR 3a tasks 3.3 / 3.4). See `specs/invite-and-accept.md`.
  """

  use MealPlannerApiWeb, :controller

  require Logger

  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApiWeb.ClientIp
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers
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
  `POST /api/invites/:token/accept` — body `{}` for an existing User
  (identified via an optional `Authorization` header — this route is
  deliberately NOT behind the `:auth` pipeline because the "new User"
  case has no account/token yet, per `specs/invite-and-accept.md`
  §"New User accepts") or `{"name": ...}` for a brand new User. Any
  other key in the body is ignored. A `name` only claims the stub User
  the invite created for an email nobody has signed in with; an invite
  bound to any other User needs that User's Bearer token, or
  `{"code": ...}`: the code `request_code/2` mailed to the invited email,
  which any invitee can accept with. A body with a `code` key always takes
  this path, whatever the value: `code` wins over `name` and over the
  `Authorization` header, and a `code` that is not a non-empty string
  answers `422 code_invalid`. Errors:
  `401 unauthorized` (no `name` and no valid Bearer token, or a `name`
  for an invite bound to a registered User), `403 invite_for_another_user`
  (a Bearer token of a User the invite is not bound to),
  `410 invite_token_used`,
  `410 invite_token_expired`, and for a `code`: `422 code_invalid`,
  `401 code_expired`, `429 too_many_attempts` and `429 rate_limited` (the
  client IP has too many failed code checks; with a `retry-after` header).
  """
  def accept(conn, %{"token" => token} = params) do
    case resolve_invitee(conn, params) do
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

          # A `name` for an invite bound to a User who is not an unclaimed
          # invite stub: that User has to accept with their own token.
          {:error, :invitee_authentication_required} ->
            Logger.warning("invite accept rejected reason=invitee_authentication_required")
            conn |> put_status(:unauthorized) |> json(%{error: "unauthorized"})

          {:error, :rate_limited, retry_after} ->
            rate_limited(conn, retry_after)

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

  # Email-code path: {"code": ...} needs no prior auth either; the code
  # proves the caller owns the invited email. Any `code` key selects it,
  # so a malformed code is refused as a code and never falls through to
  # the name or Bearer path.
  defp resolve_invitee(conn, %{"code" => code}) do
    {:ok, %{code: code, client_ip: ClientIp.resolve(conn)}}
  end

  # New User path: {"name": ...} needs no prior auth — the invitee has
  # no account/token yet. A non-empty string `name` selects this path;
  # no other key of the body is read.
  defp resolve_invitee(_conn, %{"name" => name}) when is_binary(name) and name != "" do
    {:ok, %{name: name}}
  end

  # Existing User path: the body carries no usable `name` — identify the
  # caller via an optional Authorization header (manual decode, NOT the
  # `:auth` pipeline, since this route must also serve unauthenticated
  # new Users).
  #
  # Post-review fix pass, item 8 (security): Guardian's
  # `decode_and_verify/1` never checks `typ` on its own — without the
  # explicit `claims["typ"] in supported_typs()` assertion below, a
  # `refresh`-typed token presented as this Bearer header would
  # authenticate the caller just like a real access token.
  defp resolve_invitee(conn, _params) do
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
  defp error_status(_), do: :unprocessable_entity
end
