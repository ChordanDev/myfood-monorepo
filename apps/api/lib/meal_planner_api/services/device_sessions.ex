defmodule MealPlannerApi.Services.DeviceSessions do
  @moduledoc """
  Device sessions for the mobile app (issue #9): the refresh tokens behind
  `POST /api/auth/login/verify-code`, `POST /api/auth/signup/verify-code`,
  `POST /api/auth/refresh` and `POST /api/auth/logout`.

  Every refresh token this module hands out has one row in
  `device_sessions`, found by the SHA-256 digest of the token; the token
  itself is never stored. The refresh JWT names its row in the `sid`
  claim and carries none of the access claims.

  Rotating a refresh token revokes its row and points the row at its
  successor, so the same token showing up a second time is recognised.
  That is a replay: someone other than the app may hold the token, and
  every session of that User on that device is revoked.

  One case is not a replay. A rotation is committed before its answer
  reaches the phone, and when that answer is lost the app is left with
  the token that was just rotated. For `refresh_retry_window_seconds`
  after the rotation (issue #57) that token is accepted again as a
  retry, as long as the session that replaced it has not been used or
  ended since: the pair nobody received is revoked and a new one takes
  its place. The cost is that a stolen token presented inside the window
  is accepted too, without ending the session.

  A User has at most one session that is not revoked per device. Logins
  and refreshes of the same User on the same device take turns, so each
  one sees what the one before it left; a unique index over the rows
  that are not revoked holds the same rule in the database.

  `POST /api/auth/switch-account` and `POST /api/invites/:token/accept`
  mint their pairs in `MealPlannerApiWeb.Controllers.AccountScopeHelpers`
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
  # that form are the ones `EmailCodeLogin` and `CookingService` take under
  # their own first keys; the single-key locks elsewhere live in a separate
  # key space.
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

  A token that was already rotated is rotated again when it is a retry,
  which takes all of this:

    * `refresh_retry_window_seconds` is greater than zero;
    * `now` is no later than that many seconds after the token was
      rotated;
    * the session that replaced it is still the active one: it was not
      used, logged out or taken over by a login.

  A retry revokes the session that replaced the token, whose pair the
  app never received, and answers with a new pair. The window counts
  from the first rotation, so retrying does not extend it. The session
  a retry revokes is a rotated token like any other and follows the
  same rule.

  `now` is the time the request is judged at, and the time written on
  the sessions it revokes.

  Errors, in the order they are checked:

    * `{:error, :refresh_token_invalid}` — not a string, or a token with
      no Device session: malformed, signed by someone else, minted by a
      route that opens no Device session, or swept. A stored token that
      does not verify as a refresh token gets this answer too.
    * `{:error, :refresh_token_replayed}` — the token was already
      rotated and this is not a retry. Every active session of that
      User on that device is revoked, the one that replaced this token
      included.
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

  A retry is verified like a first rotation and can be refused like
  one; the token and the session that replaced it are then left as they
  were.

  Of two requests carrying the same token, the first rotates it and the
  second waits for the first to finish. It is then judged by the rule
  above: a retry inside the window, a replay otherwise.
  """
  @spec rotate(term(), DateTime.t()) :: {:ok, token_pair()} | {:error, rotation_error()}
  def rotate(refresh_token, now \\ DateTime.utc_now())

  def rotate(refresh_token, %DateTime{} = now) when is_binary(refresh_token) do
    Repo.transaction(fn ->
      with {:ok, session} <- lock_session(refresh_token),
           {:ok, active} <- check_session(session, refresh_token, now),
           {:ok, user, membership} <- load_scope(session) do
        replace(session, active, user, membership, now)
      end
    end)
    |> unwrap_transaction()
  end

  def rotate(_refresh_token, %DateTime{}), do: {:error, :refresh_token_invalid}

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
  # A second request with the same token waits here and then finds the
  # row already replaced, which makes it a retry or a replay and never a
  # second first rotation. The row lock also keeps a logout, which takes
  # no device lock, from landing in the middle of a rotation.
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

  # What the row says is checked before the token is verified: a replayed
  # or revoked token is reported as such even once its JWT has expired,
  # and a replay revokes the chain whatever state the JWT is in. A token
  # that reaches this point hashes to a stored digest, so it is one this
  # module minted.
  #
  # The answer for a token that may be rotated is the row holding the
  # one place a User has on a device, which the rotation has to revoke
  # before it stores a new row: the presented row itself, or on a retry
  # the row that replaced it.
  defp check_session(%DeviceSession{} = session, refresh_token, now) do
    cond do
      not is_nil(session.replaced_by_id) ->
        check_rotated(session, refresh_token, now)

      not is_nil(session.revoked_at) ->
        {:error, :refresh_token_revoked}

      true ->
        with :ok <- check_token(session, refresh_token, now), do: {:ok, session}
    end
  end

  # A token that was already rotated is a retry or a replay, and the row
  # decides which before the token is looked at. A retry is then verified
  # like a first rotation; a token that fails there is refused without
  # revoking anything, because inside the window it is taken to be the
  # app's own.
  defp check_rotated(%DeviceSession{} = session, refresh_token, now) do
    case lock_retried_successor(session, now) do
      %DeviceSession{} = successor ->
        with :ok <- check_token(session, refresh_token, now), do: {:ok, successor}

      nil ->
        revoke_device(session.user_id, session.device_id, now)

        Logger.warning(
          "refresh token replayed, device sessions revoked user_id=#{session.user_id}"
        )

        {:error, :refresh_token_replayed}
    end
  end

  # The row that replaced `session`, when presenting `session` again is a
  # retry: inside the window, and with that row still active. A successor
  # that was rotated, logged out or taken over by a login is revoked, and
  # then nothing is found.
  #
  # The successor is locked. A logout takes no device lock, and without
  # the row lock one could revoke the successor after it was found active
  # here; the retry would then open a session for someone who had just
  # logged out. It is looked up on the User and device of `session`,
  # which are the ones the device lock held here covers.
  defp lock_retried_successor(%DeviceSession{} = session, now) do
    if within_retry_window?(session, now) do
      from(s in DeviceSession,
        where: s.id == ^session.replaced_by_id,
        where: s.user_id == ^session.user_id and s.device_id == ^session.device_id,
        where: is_nil(s.revoked_at),
        lock: "FOR UPDATE"
      )
      |> Repo.one()
    end
  end

  # Whether `now` is no later than the retry window after `session` was
  # rotated, the last second included. A rotated row keeps the
  # `revoked_at` of its first rotation, so the window is not extended by
  # the retries themselves.
  #
  # The window is read on every request. Anything but a positive whole
  # number of seconds means there is no window, so a setting that is
  # missing or wrong refuses retries instead of accepting them.
  defp within_retry_window?(%DeviceSession{revoked_at: %DateTime{} = rotated_at}, now) do
    case Application.get_env(:meal_planner_api, :refresh_retry_window_seconds, 0) do
      seconds when is_integer(seconds) and seconds > 0 ->
        DateTime.compare(now, DateTime.add(rotated_at, seconds, :second)) != :gt

      _off_or_invalid ->
        false
    end
  end

  # A row that points at a successor without being revoked is not one a
  # rotation wrote, and has no rotation to count from.
  defp within_retry_window?(%DeviceSession{revoked_at: nil}, _now), do: false

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

  # Issues the pair that takes the place of `presented`. `active` is the
  # row `check_session/3` answered with: `presented` itself on a first
  # rotation, the row that replaced it on a retry.
  #
  # The active row is revoked before its successor is stored, because
  # the database allows a User one row that is not revoked per device.
  # Only then is it pointed at the successor, and on a retry the
  # presented row with it, so both lead to the new row. The presented
  # row of a retry keeps its `revoked_at`. A pair that cannot be issued
  # rolls the revocation back with everything else.
  defp replace(%DeviceSession{} = presented, %DeviceSession{} = active, user, membership, now) do
    revoked = active |> Ecto.Changeset.change(revoked_at: now) |> Repo.update!()

    case issue(user, membership, presented.device_id) do
      {:ok, successor, token_pair} ->
        [revoked, presented]
        |> Enum.uniq_by(& &1.id)
        |> Enum.each(fn replaced ->
          replaced |> Ecto.Changeset.change(replaced_by_id: successor.id) |> Repo.update!()
        end)

        log_retry(presented, active)

        {:ok, token_pair}

      {:error, reason} ->
        Repo.rollback(reason)
    end
  end

  # A retry is logged with the User alone. A first rotation, where the
  # presented row is the active one, is not logged.
  defp log_retry(%DeviceSession{id: id}, %DeviceSession{id: id}), do: :ok

  defp log_retry(%DeviceSession{user_id: user_id}, %DeviceSession{}) do
    Logger.info("refresh retried inside the retry window, successor replaced user_id=#{user_id}")
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
  # `open/3` and `rotate/2` take this lock before they lock any row, so
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
