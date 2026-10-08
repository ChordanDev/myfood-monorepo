defmodule MealPlannerApi.Services.EmailCodeLogin do
  @moduledoc """
  Email-code login for the mobile app (issue #7), served by
  `POST /api/auth/login/request-code` and `POST /api/auth/login/verify-code`.

  It lives beside `MealPlannerApi.Services.EmailCodeAuth` instead of inside
  it because the two contracts disagree on purpose: the legacy flow never
  reveals whether an email has a User and reports an expired code as an
  invalid one, while the mobile contract answers `email_not_found` and
  tells `code_expired` from `code_invalid`.

  Both flows share the `email_verification_codes` table, the SHA-256 code
  digest, the hourly request counters in `email_auth_events` and the mailer.
  What is specific to login:

    * a 60-second resend cooldown per email;
    * a new code consumes every earlier pending code for that email, so
      only the latest code can ever verify;
    * failed attempts are counted on the code row itself, and a code locks
      for good once it reaches the limit;
    * verification resolves a single Membership for the User, so the
      answer has one shape however many Accounts the User belongs to.

  The plaintext code is never returned or logged; the email is the only
  delivery channel.
  """

  import Ecto.Query

  require Logger

  alias Ecto.Adapters.SQL
  alias MealPlannerApi.Mailer
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth

  @ttl_seconds 600
  @resend_cooldown_seconds 60
  @max_attempts EmailCodeAuth.max_code_attempts()

  # First key of the two-key advisory lock form, which lives in a separate
  # key space from the single-key locks `EmailCodeAuth` takes.
  @lock_namespace 0x4C4F_4749

  @email_format ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/

  @type code_sent :: %{
          expires_in_seconds: pos_integer(),
          resend_available_in_seconds: pos_integer()
        }

  @doc """
  Issues a login code for `email` and mails it.

  Errors:

    * `{:error, :invalid_email}` — not a string, or not shaped like an email.
    * `{:error, :email_not_found}` — no User has this email. No code is
      stored and nothing is sent, but the request still spends one of the
      caller's hourly per-IP slots, so emails cannot be probed without limit.
    * `{:error, :rate_limited, retry_after}` — a code was issued for this
      email less than #{@resend_cooldown_seconds} seconds ago, or the hourly
      per-email or per-IP request limit is exhausted. An exhausted IP gets
      this answer for unknown emails too. `retry_after` is in whole seconds,
      at least 1.
    * `{:error, :code_send_failed}` — the mailer refused the message or
      never answered. The whole request is rolled back, so the caller may
      retry at once.
  """
  @spec request_code(term(), String.t() | nil) ::
          {:ok, code_sent()}
          | {:error, :invalid_email | :email_not_found | :code_send_failed}
          | {:error, :rate_limited, pos_integer()}
  def request_code(email, client_ip) when is_binary(email) do
    normalized_email = EmailCodeAuth.normalize_email(email)

    if Regex.match?(@email_format, normalized_email) do
      issue_code(normalized_email, client_ip)
    else
      {:error, :invalid_email}
    end
  end

  def request_code(_email, _client_ip), do: {:error, :invalid_email}

  defp issue_code(email, client_ip) do
    Repo.transaction(
      fn ->
        lock_email(email)
        now = DateTime.utc_now()

        with {:ok, user} <- fetch_known_user(email, client_ip),
             :ok <- check_resend_cooldown(email, now),
             :ok <- EmailCodeAuth.reserve_request_slots(email, client_ip) do
          code = EmailCodeAuth.mint_code()
          consume_pending_codes(email, now)
          insert_code!(user, email, code, now)

          case deliver(user, email, code) do
            :ok -> {:ok, code_sent()}
            :error -> Repo.rollback(:code_send_failed)
          end
        end
      end,
      timeout: :timer.seconds(5)
    )
    |> unwrap_transaction()
  end

  defp code_sent do
    %{
      expires_in_seconds: @ttl_seconds,
      resend_available_in_seconds: @resend_cooldown_seconds
    }
  end

  # A request for an unknown email is still counted against the caller's
  # IP, in the bucket known emails draw from, so the answer cannot be used
  # to probe emails without limit. The event is kept because the
  # transaction commits on this error.
  defp fetch_known_user(email, client_ip) do
    case Repo.one(from(u in User, where: u.email == ^email, limit: 1)) do
      %User{} = user ->
        {:ok, user}

      nil ->
        with :ok <- EmailCodeAuth.reserve_ip_request_slot(client_ip) do
          {:error, :email_not_found}
        end
    end
  end

  defp check_resend_cooldown(email, now) do
    last_issued_at =
      Repo.one(
        from(c in EmailVerificationCode, where: c.email == ^email, select: max(c.inserted_at))
      )

    elapsed = last_issued_at && DateTime.diff(now, last_issued_at, :second)

    if is_nil(elapsed) or elapsed >= @resend_cooldown_seconds do
      :ok
    else
      {:error, :rate_limited, max(@resend_cooldown_seconds - elapsed, 1)}
    end
  end

  defp consume_pending_codes(email, now) do
    from(c in EmailVerificationCode, where: c.email == ^email, where: is_nil(c.consumed_at))
    |> Repo.update_all(set: [consumed_at: now])
  end

  defp insert_code!(user, email, code, now) do
    Repo.insert!(%EmailVerificationCode{
      user_id: user.id,
      email: email,
      code_hash: EmailCodeAuth.hash_code(code),
      expires_at: DateTime.add(now, @ttl_seconds, :second)
    })
  end

  # ---------------------------------------------------------------------------
  # Verification
  # ---------------------------------------------------------------------------

  @doc """
  Verifies `code` against the latest pending code for `email` and, on a
  match, consumes it and resolves the Membership the session is scoped to.

  Errors:

    * `{:error, :code_invalid}` — no pending code for this email (unknown
      email, never requested, already used, or replaced by a newer code),
      or the code does not match.
    * `{:error, :code_expired}` — the pending code is past its expiry.
    * `{:error, :too_many_attempts}` — the pending code has reached
      #{@max_attempts} failed attempts, this one included. Only a new code
      lifts the lockout; the right code is refused too.
    * `{:error, :account_not_found}` — the code was right and is now
      consumed, but the User has no active Membership.

  A mismatch is the only outcome that counts as an attempt.
  """
  @spec verify_code(term(), term()) ::
          {:ok, %{user: User.t(), membership: AccountMembership.t()}}
          | {:error, :code_invalid | :code_expired | :too_many_attempts | :account_not_found}
  def verify_code(email, code) when is_binary(email) and is_binary(code) do
    normalized_email = EmailCodeAuth.normalize_email(email)

    Repo.transaction(
      fn ->
        lock_email(normalized_email)
        now = DateTime.utc_now()

        with {:ok, row} <- latest_pending_code(normalized_email),
             :ok <- check_code(row, code, now) do
          consume_code(row, now)
          resolve_session(row.user_id)
        end
      end,
      timeout: :timer.seconds(5)
    )
    |> unwrap_transaction()
  end

  def verify_code(_email, _code), do: {:error, :code_invalid}

  defp latest_pending_code(email) do
    query =
      from(c in EmailVerificationCode,
        where: c.email == ^email,
        where: is_nil(c.consumed_at),
        order_by: [desc: c.inserted_at],
        limit: 1
      )

    case Repo.one(query) do
      %EmailVerificationCode{} = row -> {:ok, row}
      nil -> {:error, :code_invalid}
    end
  end

  defp check_code(%EmailVerificationCode{} = row, code, now) do
    cond do
      row.attempts >= @max_attempts ->
        {:error, :too_many_attempts}

      DateTime.compare(row.expires_at, now) != :gt ->
        {:error, :code_expired}

      Plug.Crypto.secure_compare(row.code_hash, EmailCodeAuth.hash_code(code)) ->
        :ok

      true ->
        record_failed_attempt(row)
    end
  end

  # The email lock makes the read-then-increment safe: no other
  # verification of this email runs until the transaction ends.
  defp record_failed_attempt(%EmailVerificationCode{id: id, attempts: attempts}) do
    Repo.update_all(from(c in EmailVerificationCode, where: c.id == ^id), inc: [attempts: 1])

    if attempts + 1 >= @max_attempts do
      {:error, :too_many_attempts}
    else
      {:error, :code_invalid}
    end
  end

  defp consume_code(%EmailVerificationCode{id: id}, now) do
    Repo.update_all(from(c in EmailVerificationCode, where: c.id == ^id),
      set: [consumed_at: now]
    )
  end

  defp resolve_session(user_id) do
    user = Repo.get!(User, user_id)

    case user_id |> EmailCodeAuth.load_active_memberships() |> preferred_membership() do
      %AccountMembership{} = membership -> {:ok, %{user: user, membership: membership}}
      nil -> {:error, :account_not_found}
    end
  end

  # The Membership a login lands on: an owned Account first, then the one
  # the User has belonged to the longest.
  defp preferred_membership(memberships) do
    Enum.min_by(memberships, &{&1.role != :owner, member_since(&1)}, fn -> nil end)
  end

  # Rows that predate `joined_at` have none; their creation time stands in.
  defp member_since(%AccountMembership{joined_at: joined_at, inserted_at: inserted_at}) do
    DateTime.to_unix(joined_at || inserted_at, :microsecond)
  end

  # ---------------------------------------------------------------------------
  # Shared helpers
  # ---------------------------------------------------------------------------

  # An adapter can answer `{:error, _}`, raise, or exit (HTTP adapters do
  # all three; a client timeout is an exit); either way the code never
  # reached the user. The failure detail is not logged: provider errors
  # echo the request, which carries the plaintext code.
  defp deliver(user, email, code) do
    case Mailer.deliver_now(EmailCodeAuth.code_email(user, email, code)) do
      {:ok, _email} ->
        :ok

      {:error, _reason} ->
        Logger.error("login code delivery failed")
        :error
    end
  rescue
    exception ->
      Logger.error("login code delivery raised #{inspect(exception.__struct__)}")
      :error
  catch
    :exit, _reason ->
      Logger.error("login code delivery exited")
      :error
  end

  # Serializes every login operation on one email for the rest of the
  # transaction, so two concurrent requests cannot both pass the cooldown
  # and two concurrent verifications cannot both spend the same attempt.
  defp lock_email(email) do
    SQL.query!(Repo, "SELECT pg_advisory_xact_lock($1, $2)", [
      @lock_namespace,
      :erlang.phash2(email)
    ])
  end

  # The transaction commits on every domain error except a failed delivery,
  # which rolls back; both arrive here as plain error tuples.
  defp unwrap_transaction({:ok, result}), do: result
  defp unwrap_transaction({:error, reason}), do: {:error, reason}
end
