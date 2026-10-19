defmodule MealPlannerApi.Services.InviteService do
  @moduledoc """
  Token minting and invite row creation for `AccountMembership` invites.

  Phase A — Tenancy Refactor, PR 2a task 2.7. Per design §6.1, design
  §10 (Q7), and `specs/invite-and-accept.md`:

    * `mint_token/0` produces `{plaintext, hash}`. Plaintext is 32 bytes
      from `:crypto.strong_rand_bytes/1`, URL-safe base64 (no padding) →
      ~43-char string. Hash is `SHA-256(plaintext)` encoded as lower-case
      hex (64 chars).
    * `hash_token/1` exposes the hashing algorithm so external callers
      (e.g. tests) can reproduce the hash without re-minting.
    * `create_invite_row/2` inserts an `:invited` `AccountMembership`
      with `invite_token_hash`, `invite_expires_at = now + 7d`,
      `invited_by_user_id`, `role: :member`. Used by the
      `AccountsMembership.invite/3` use case.

  Accepting an invite lives in `AccountsMembership.accept_invite/2`,
  which also checks who is allowed to accept it.
  """

  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Persistence.Accounts.UserEmail
  alias MealPlannerApi.Repo

  @invite_ttl_days 7

  @doc """
  Returns `{plaintext, hash}` for a fresh invite token.

  Plaintext is ~43 URL-safe base64 chars (no padding) from 32 random
  bytes; hash is 64-char lower-case hex (SHA-256).
  """
  @spec mint_token() :: {String.t(), String.t()}
  def mint_token do
    plaintext = generate_url_safe_token(32)
    {plaintext, hash_token(plaintext)}
  end

  @doc """
  Hashes an invite plaintext token (SHA-256 lower-case hex). Pure — no
  IO — usable by callers that need to reproduce the hash for an existing
  token without minting a new one.
  """
  @spec hash_token(String.t()) :: String.t()
  def hash_token(plaintext) when is_binary(plaintext) do
    :crypto.hash(:sha256, plaintext) |> Base.encode16(case: :lower)
  end

  @doc """
  Inserts an `:invited` `AccountMembership` for `email` under the
  account identified by `owner_membership`. Returns the membership and
  the plaintext token (single use — caller is responsible for emitting
  it exactly once in the response).

  Hash is stored (never plaintext). Expiry = `now + @invite_ttl_days`.
  The transaction wraps a `SELECT … FOR UPDATE` on the Account row
  indirectly via the FK insert + the seat-cap check the caller runs
  before calling this function (see `AccountsMembership.invite/3`).

  ## User resolution

  The `account_memberships.user_id` FK requires a real `User` row. If
  the invitee email already maps to a `User`, that User's id is used.
  Otherwise a stub `User` is created with the email, `role: :member`,
  the email as a placeholder `name` and `invite_stub: true`. Only a stub
  can be claimed by an accept that carries a `name` and no Bearer token
  (see `AccountsMembership.accept_invite/2`); an existing User has to
  accept with their own token.
  """
  @spec create_invite_row(AccountMembership.t(), String.t()) ::
          {:ok, %{membership: AccountMembership.t(), token: String.t()}}
          | {:error, Ecto.Changeset.t()}
  def create_invite_row(%AccountMembership{} = owner_membership, email)
      when is_binary(email) do
    with {:ok, user} <- resolve_or_create_user(email),
         {:ok, plaintext, hash, expires_at} <- fresh_token() do
      attrs = %{
        account_id: owner_membership.account_id,
        user_id: user.id,
        role: :member,
        status: :invited,
        invited_by_user_id: owner_membership.user_id,
        invite_token_hash: hash,
        invite_expires_at: expires_at,
        joined_at: nil
      }

      case %AccountMembership{}
           |> AccountMembership.changeset(attrs)
           |> Repo.insert() do
        {:ok, membership} ->
          {:ok, %{membership: membership, token: plaintext}}

        {:error, _} = error ->
          error
      end
    end
  end

  # Reuses the user whose email matches regardless of case, like sign-up
  # and login do, and stores a new invitee's email normalized.
  # `UserEmail.get_user/1` normalizes on its own; the email is normalized
  # up front for the create branch, which stores it.
  defp resolve_or_create_user(email) do
    email = UserEmail.normalize(email)

    case UserEmail.get_user(email) do
      %PersistenceUser{} = user ->
        {:ok, user}

      nil ->
        # Stub User with `name: email` so the `name` NOT NULL check is
        # satisfied at insert time. The name is filled in when the invitee
        # claims the stub at accept time.
        %PersistenceUser{}
        |> PersistenceUser.changeset(%{email: email, name: email, role: :member})
        |> Ecto.Changeset.put_change(:invite_stub, true)
        |> Repo.insert()
    end
  end

  defp fresh_token do
    {plaintext, hash} = mint_token()
    expires_at = DateTime.add(DateTime.utc_now(), @invite_ttl_days * 86_400, :second)
    {:ok, plaintext, hash, expires_at}
  end

  defp generate_url_safe_token(byte_size) do
    byte_size
    |> :crypto.strong_rand_bytes()
    |> Base.url_encode64(padding: false)
  end
end
