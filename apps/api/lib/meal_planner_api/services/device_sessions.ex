defmodule MealPlannerApi.Services.DeviceSessions do
  @moduledoc """
  Device sessions for the mobile app (issue #9): the refresh tokens behind
  `POST /api/auth/login/verify-code`, `POST /api/auth/signup/verify-code`,
  `POST /api/auth/refresh` and `POST /api/auth/logout`.

  Every refresh token this module hands out has one row in
  `device_sessions`, found by the SHA-256 digest of the token; the token
  itself is never stored. The refresh JWT names its row in the `sid`
  claim and carries none of the access claims.

  A refresh token is good for one rotation. Rotating it revokes its row
  and points the row at its successor, so the same token showing up a
  second time is known to be a replay: someone other than the app may
  hold it, and every session of that User on that device is revoked.

  A User has at most one session that is not revoked per device. Logins
  and refreshes of the same User on the same device take turns, so each
  one sees what the one before it left; a unique index over the rows
  that are not revoked holds the same rule in the database.

  The legacy routes mint their pairs with
  `MealPlannerApiWeb.Controllers.AccountScopeHelpers.mint_token_pair/2`
  and store nothing, so their refresh tokens are unknown here.
  """

  import Ecto.Query

  require Logger

  alias Ecto.Adapters.SQL
  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.DeviceSession
  alias MealPlannerApi.Repo

  # How long a revoked row is kept before `sweep/1` deletes it.
  @revoked_retention_days 7

  # First key of the two-key advisory lock form. The only other locks of
  # that form are the ones `EmailCodeLogin` takes under its own first
  # key; the single-key locks elsewhere live in a separate key space.
  @lock_namespace 0x4453_4553

  @type token_pair :: %{access_token: String.t(), refresh_token: String.t()}

  @type rotation_error ::
          :refresh_token_invalid
          | :refresh_token_replayed
          | :refresh_token_revoked
          | :refresh_token_expired
          | :refresh_token_session_mismatch
          | :account_not_found
          | :session_issue_failed

  @doc """
  Whether `device_id` can name the phone of a Device session: a string
  of valid UTF-8 that is not blank, has no NUL character and takes at
  most #{DeviceSession.max_device_id_bytes()} bytes.

  This is the one statement of the rule. Anything it accepts can be
  stored, so a caller that has something to lose by a failed `open/3`,
  such as an email code, asks here first.
  """
  @spec valid_device_id?(term()) :: boolean()
  def valid_device_id?(device_id) when is_binary(device_id) do
    String.valid?(device_id) and String.trim(device_id) != "" and
      not String.contains?(device_id, <<0>>) and
      byte_size(device_id) <= DeviceSession.max_device_id_bytes()
  end

  def valid_device_id?(_device_id), do: false

  @doc """
  Opens a Device session for `user` on `device_id`, scoped to
  `membership`, and returns its token pair.

  A phone holds one session per User: the session `user` already had on
  `device_id` is revoked. Sessions on other devices, and other Users'
  sessions on this one, are left alone. A login that arrives while
  another login or a refresh of the same User on the same device is in
  progress waits for it to finish.

  `{:error, :session_issue_failed}` means a token could not be signed or
  its row could not be stored, which is the answer for a `device_id`
  that `valid_device_id?/1` refuses; nothing is stored or revoked then.
  """
  @spec open(User.t(), AccountMembership.t(), String.t()) ::
          {:ok, token_pair()} | {:error, :session_issue_failed}
  def open(%User{} = user, %AccountMembership{} = membership, device_id) do
    if valid_device_id?(device_id) do
      Repo.transaction(fn -> take_over_device(user, membership, device_id) end)
    else
      {:error, :session_issue_failed}
    end
  end

  # The transaction of `open/3`: the device lock comes first, so the
  # revocation sees whatever a login or refresh before this one stored.
  defp take_over_device(user, membership, device_id) do
    :ok = lock_device(user.id, device_id)
    revoke_device(user.id, device_id, DateTime.utc_now())

    case issue(user, membership, device_id) do
      {:ok, _session, token_pair} -> token_pair
      {:error, reason} -> Repo.rollback(reason)
    end
  end

  @doc """
  Rotates `refresh_token`: its Device session is revoked and a new one,
  on the same device and scoped to the same Membership, takes its place.
  The access token of the new pair is built from the User and the
  Membership as they are now.

  Errors, in the order they are checked:

    * `{:error, :refresh_token_invalid}` — not a string, or a token with
      no Device session: malformed, signed by someone else, minted by a
      legacy route, or swept. A stored token that does not verify as a
      refresh token gets this answer too.
    * `{:error, :refresh_token_replayed}` — the token was already
      rotated. Every active session of that User on that device is
      revoked, the one that replaced this token included.
    * `{:error, :refresh_token_revoked}` — the session was ended by a
      logout, by a later login on the same device, or by a replay.
    * `{:error, :refresh_token_expired}` — the JWT or its row is past
      its expiry.
    * `{:error, :refresh_token_session_mismatch}` — the token names
      another User or another Device session than its row does.
    * `{:error, :account_not_found}` — the Membership is no longer
      active. The session is left as it was.
    * `{:error, :session_issue_failed}` — the new pair could not be
      signed or stored. Nothing changes.

  There is no grace window: of two requests carrying the same token, the
  first rotates it and the second is a replay.
  """
  @spec rotate(term()) :: {:ok, token_pair()} | {:error, rotation_error()}
  def rotate(refresh_token) when is_binary(refresh_token) do
    Repo.transaction(fn ->
      with {:ok, session} <- lock_session(refresh_token),
           now = DateTime.utc_now(),
           :ok <- check_session(session, refresh_token, now),
           {:ok, user, membership} <- load_scope(session) do
        replace(session, user, membership, now)
      end
    end)
    |> unwrap_transaction()
  end

  def rotate(_refresh_token), do: {:error, :refresh_token_invalid}

  @doc """
  Revokes the Device session of `refresh_token`, if it has an active one.

  Always `:ok`: logging out with a token that is unknown, already
  revoked or not even a string leaves nothing to do, and the caller is
  not told which it was.
  """
  @spec revoke(term()) :: :ok
  def revoke(refresh_token) when is_binary(refresh_token) do
    now = DateTime.utc_now()

    from(s in DeviceSession,
      where: s.token_hash == ^hash_token(refresh_token),
      where: is_nil(s.revoked_at)
    )
    |> Repo.update_all(set: [revoked_at: now, updated_at: now])

    :ok
  end

  def revoke(_refresh_token), do: :ok

  @doc """
  Deletes the Device sessions that can no longer matter and returns how
  many there were: rows past `expires_at`, and rows revoked more than
  #{@revoked_retention_days} days before `now`.

  A revoked row is kept for a while instead of being deleted at once
  because it is the only record that its token was rotated: while the
  row exists, that token showing up again is recognised as a replay and
  ends the session on that device. Once the row is gone the same token
  is just an unknown one.

  This is a function only. Nothing calls it on a schedule yet: scheduled
  work belongs to Oban (`docs/adr/0002-use-oban-for-background-jobs.md`),
  which is not installed.
  """
  @spec sweep(DateTime.t()) :: non_neg_integer()
  def sweep(%DateTime{} = now \\ DateTime.utc_now()) do
    revoked_before = DateTime.add(now, -@revoked_retention_days * 86_400, :second)

    {count, _rows} =
      from(s in DeviceSession,
        where: s.expires_at <= ^now or s.revoked_at <= ^revoked_before
      )
      |> Repo.delete_all()

    count
  end

  # ---------------------------------------------------------------------------
  # Rotation
  # ---------------------------------------------------------------------------

  # The row is read twice. The first read takes no lock and only learns
  # whose token this is, because the device lock is keyed by User and
  # device and has to come before any row lock. The second read locks
  # the row, and it is the one rotation decides on: while this request
  # waited for the device lock, a login or another refresh on the same
  # device may have revoked or replaced the row.
  #
  # That makes rotation single-use: a second request with the same token
  # waits here and then finds the row already replaced. The row lock
  # also keeps a logout, which takes no device lock, from landing in the
  # middle of a rotation.
  defp lock_session(refresh_token) do
    by_token = from(s in DeviceSession, where: s.token_hash == ^hash_token(refresh_token))

    with %DeviceSession{user_id: user_id, device_id: device_id} <- Repo.one(by_token),
         :ok <- lock_device(user_id, device_id),
         %DeviceSession{} = session <- Repo.one(lock(by_token, "FOR UPDATE")) do
      {:ok, session}
    else
      nil -> {:error, :refresh_token_invalid}
    end
  end

  # What the row says is checked before the token is verified: a rotated
  # or revoked token is reported as such even once its JWT has expired,
  # and a replay revokes the chain whatever state the JWT is in. A token
  # that reaches this point hashes to a stored digest, so it is one this
  # module minted.
  defp check_session(%DeviceSession{} = session, refresh_token, now) do
    cond do
      not is_nil(session.replaced_by_id) ->
        revoke_device(session.user_id, session.device_id, now)

        Logger.warning(
          "refresh token replayed, device sessions revoked user_id=#{session.user_id}"
        )

        {:error, :refresh_token_replayed}

      not is_nil(session.revoked_at) ->
        {:error, :refresh_token_revoked}

      true ->
        check_token(session, refresh_token, now)
    end
  end

  # Guardian does not check `token_type:` on decode, so `typ` is matched
  # here: only a refresh token may be rotated.
  defp check_token(%DeviceSession{} = session, refresh_token, now) do
    case Guardian.decode_and_verify(refresh_token) do
      {:ok, %{"typ" => "refresh"} = claims} -> check_claims(session, claims, now)
      {:ok, _claims} -> {:error, :refresh_token_invalid}
      {:error, :token_expired} -> {:error, :refresh_token_expired}
      {:error, _reason} -> {:error, :refresh_token_invalid}
    end
  end

  defp check_claims(%DeviceSession{} = session, claims, now) do
    cond do
      DateTime.compare(session.expires_at, now) != :gt ->
        {:error, :refresh_token_expired}

      claims["sub"] != session.user_id or claims["sid"] != session.id ->
        {:error, :refresh_token_session_mismatch}

      true ->
        :ok
    end
  end

  # The User and Membership are read again, so the new access token says
  # what is true now rather than what was true at login. As at login, a
  # Membership has to be active to carry a session.
  defp load_scope(%DeviceSession{user_id: user_id, membership_id: membership_id}) do
    with %User{} = user <- Repo.get(User, user_id),
         %AccountMembership{status: :active} = membership <-
           Repo.get(AccountMembership, membership_id) do
      {:ok, user, membership}
    else
      _missing_or_inactive -> {:error, :account_not_found}
    end
  end

  # The old row is revoked before its successor is stored, because the
  # database allows a User one row that is not revoked per device, and
  # only then pointed at the successor. A pair that cannot be issued
  # rolls the revocation back with everything else.
  defp replace(%DeviceSession{} = session, user, membership, now) do
    revoked = session |> Ecto.Changeset.change(revoked_at: now) |> Repo.update!()

    case issue(user, membership, session.device_id) do
      {:ok, successor, token_pair} ->
        revoked |> Ecto.Changeset.change(replaced_by_id: successor.id) |> Repo.update!()

        {:ok, token_pair}

      {:error, reason} ->
        Repo.rollback(reason)
    end
  end

  # ---------------------------------------------------------------------------
  # Shared helpers
  # ---------------------------------------------------------------------------

  # Mints a token pair and stores the row of its refresh token. The row id
  # is generated first, because the refresh token names it. The row
  # expires with its token, whatever the configured refresh lifetime is.
  defp issue(user, membership, device_id) do
    session_id = Ecto.UUID.generate()

    with {:ok, access_token, _claims} <-
           Guardian.encode_and_sign(
             user,
             AccountsMembership.claims_for(user, membership),
             token_type: "access"
           ),
         {:ok, refresh_token, %{"exp" => expires_at}} <-
           Guardian.encode_and_sign(user, %{"sid" => session_id}, token_type: "refresh"),
         {:ok, session} <-
           %DeviceSession{}
           |> DeviceSession.changeset(%{
             id: session_id,
             user_id: user.id,
             membership_id: membership.id,
             device_id: device_id,
             token_hash: hash_token(refresh_token),
             expires_at: DateTime.from_unix!(expires_at)
           })
           |> Repo.insert() do
      {:ok, session, %{access_token: access_token, refresh_token: refresh_token}}
    else
      _error -> {:error, :session_issue_failed}
    end
  end

  # Makes the requests that open or rotate the session of one User on one
  # device take turns, until the transaction ends. Without it, a login
  # that revokes the device's session while a refresh is replacing that
  # session does not see the successor, and both end up with a row.
  #
  # `open/3` and `rotate/1` take this lock before they lock any row, so
  # neither can hold a row the other needs while waiting for it.
  defp lock_device(user_id, device_id) do
    SQL.query!(Repo, "SELECT pg_advisory_xact_lock($1, $2)", [
      @lock_namespace,
      :erlang.phash2({user_id, device_id})
    ])

    :ok
  end

  # Revokes the session one User has on one device, if it is not revoked
  # yet. The caller holds the device lock.
  defp revoke_device(user_id, device_id, now) do
    from(s in DeviceSession,
      where: s.user_id == ^user_id and s.device_id == ^device_id,
      where: is_nil(s.revoked_at)
    )
    |> Repo.update_all(set: [revoked_at: now, updated_at: now])
  end

  # A refusal commits, because a replay has to leave its revocations
  # behind; only a pair that could not be issued rolls back. Both arrive
  # here as plain error tuples.
  defp unwrap_transaction({:ok, result}), do: result
  defp unwrap_transaction({:error, reason}), do: {:error, reason}

  defp hash_token(token), do: :sha256 |> :crypto.hash(token) |> Base.encode16(case: :lower)
end
