defmodule MealPlannerApi.Services.EmailCodeAuth do
  @moduledoc """
  Shared building blocks of authentication with an email code.

  The module has no request or verify entry point of its own: the mobile
  contract lives in `MealPlannerApi.Services.EmailCodeLogin` and
  `MealPlannerApi.Services.EmailCodeSignup`. What those two share is
  here:

    * `normalize_email/1`, `mint_code/0` and `hash_code/1` — the
      canonical email, the six-digit code and the SHA-256 digest that
      is the only form of a code ever stored.
    * `reserve_request_slots/2` and `reserve_ip_request_slot/1` — the
      rolling 1-hour request counters (5 per email, 20 per IP), kept in
      `email_auth_events` and serialized by Postgres advisory locks so
      concurrent requesters cannot collectively exceed them.
    * `max_code_attempts/0` — the failed attempts after which a code is
      locked for good.
    * `code_email/3` — the verification-code email.
    * `load_active_memberships/1` — the `:active` Memberships of a User.

  It also owns the account-selection continuation that
  `POST /api/auth/switch-account` accepts in place of a bearer token:
  `hash_continuation/1` and `exchange_continuation/3`, the locked
  single-use exchange that delegates to
  `MealPlannerApi.AccountsMembership.switch_account/2` and mints the
  access token inside the same transaction as the `consumed_at` UPDATE.
  No production code mints a continuation; `mint_test_continuation/3`
  builds one for the tests of the exchange.
  """

  import Ecto.Query

  alias Ecto.Adapters.SQL
  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Mailer.EmailCodeEmail
  alias MealPlannerApi.Persistence.Accounts.AccountMembership, as: PersistenceAccountMembership
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Persistence.Auth.AccountSelectionContinuation
  alias MealPlannerApi.Persistence.Auth.AccountSelectionContinuationMembership
  alias MealPlannerApi.Persistence.Auth.EmailAuthEvent
  alias MealPlannerApi.Repo

  @window_seconds 3600
  @max_per_email_per_window 5
  @max_per_ip_per_window 20
  @code_length 6
  @max_code_attempts 5
  @continuation_ttl_seconds 300
  # Per-IP bucket of the requests whose client address is not an IP.
  @unresolved_ip_key "unresolved"

  # Lock keys are 64-bit signed integers fed to `pg_advisory_xact_lock`.
  # We hash the normalized inputs so neither key collides with another
  # in a way that serializes unrelated work.
  @email_lock_salt 0x4D45_6C70_6861_756C
  @ip_lock_salt 0x4D45_6C70_5F69_705F
  # Salt for the continuation-exchange advisory lock so concurrent
  # exchange attempts on the same continuation token serialize cleanly
  # without starving the request-path locks.
  @continuation_lock_salt 0x4D45_6C70_5F63_7478

  @type rate_limited :: {:error, :rate_limited, non_neg_integer()}

  @type exchange_result ::
          {:ok,
           %{
             user: PersistenceUser.t(),
             account: term(),
             membership: PersistenceAccountMembership.t(),
             claims: map(),
             access_token: String.t()
           }}
          | {:error,
             :invalid_continuation
             | :expired_continuation
             | :consumed_continuation
             | :foreign_bearer
             | :invalid_bearer
             | :not_in_continuation_set
             | :membership_not_found
             | :not_your_membership
             | :membership_not_active
             | :token_refresh_failed}

  @doc """
  Returns the SHA-256 lower-case hex digest of `code`. Exposed so tests
  can build fixtures with the exact same hash the service uses to
  compare plaintext submissions; never use this on untrusted data.
  """
  @spec hash_code(String.t()) :: String.t()
  def hash_code(code) when is_binary(code) do
    :telemetry.execute([:meal_planner_api, :email_code_auth, :hash_code], %{}, %{})
    :crypto.hash(:sha256, code) |> Base.encode16(case: :lower)
  end

  @doc """
  Reserves one slot in the rolling 1-hour request window for `email`
  (already normalized) and one for `client_ip`. Returns
  `{:error, :rate_limited, retry_after}` when either counter is
  exhausted.

  `client_ip` is an IPv4 or IPv6 address as text. One that is not (`nil`
  included) is not let through uncounted: all such requests draw from a
  single shared bucket.

  Must run inside a `Repo.transaction/2`: the advisory locks that
  serialize concurrent requesters are transaction-scoped. Called by
  `MealPlannerApi.Services.EmailCodeLogin.issue_code/4` for login and
  sign-up requests alike, so both draw from the same counters.
  """
  @spec reserve_request_slots(String.t(), String.t() | nil) :: :ok | rate_limited()
  def reserve_request_slots(email, client_ip) when is_binary(email) do
    reserve_slots(email, normalize_client_ip(client_ip))
  end

  @doc """
  Reserves one slot in the rolling 1-hour request window for `client_ip`
  alone, in the same per-IP counter `reserve_request_slots/2` draws
  from. No per-email event is recorded. Returns
  `{:error, :rate_limited, retry_after}` when the counter is exhausted.
  A `client_ip` that is not an IP address (`nil` included) draws from the
  same shared bucket as in `reserve_request_slots/2`.

  Must run inside a `Repo.transaction/2`, like `reserve_request_slots/2`.
  Used by `MealPlannerApi.Services.EmailCodeLogin` to count requests for
  emails that have no User.
  """
  @spec reserve_ip_request_slot(String.t() | nil) :: :ok | rate_limited()
  def reserve_ip_request_slot(client_ip) do
    ip = normalize_client_ip(client_ip)

    SQL.query!(Repo, "SELECT pg_advisory_xact_lock($1)", [ip_lock_key(ip)])
    reserve_ip_slot(ip)
  end

  @doc """
  Failed attempts after which a verification code is locked for good.
  `MealPlannerApi.Services.EmailCodeLogin` counts the attempts and
  enforces the limit, for sign-up codes too.
  """
  @spec max_code_attempts() :: pos_integer()
  def max_code_attempts, do: @max_code_attempts

  # ---------------------------------------------------------------------------
  # Rate limiting
  # ---------------------------------------------------------------------------

  # Reserves a slot in the rolling 1-hour window for the email and the
  # IP (an address or the shared unresolved bucket). The two counters
  # are serialized by hash-derived advisory locks so concurrent
  # requesters cannot race past the limit on the same key.
  defp reserve_slots(email, ip) do
    SQL.query!(Repo, "SELECT pg_advisory_xact_lock($1)", [email_lock_key(email)])

    SQL.query!(Repo, "SELECT pg_advisory_xact_lock($1)", [ip_lock_key(ip)])

    with :ok <- reserve_email_slot(email) do
      reserve_ip_slot(ip)
    end
  end

  defp reserve_email_slot(email) do
    now = DateTime.utc_now()
    window_start = DateTime.add(now, -@window_seconds, :second)

    if count_events("request", email, nil, window_start) >= @max_per_email_per_window do
      retry_after = compute_retry_after(email, "request", nil, window_start)
      {:error, :rate_limited, retry_after}
    else
      :ok = insert_event("request", email, nil, now)
      :ok
    end
  end

  defp reserve_ip_slot(ip) do
    now = DateTime.utc_now()
    window_start = DateTime.add(now, -@window_seconds, :second)

    if count_events("request", nil, ip, window_start) >= @max_per_ip_per_window do
      retry_after = compute_retry_after(nil, "request", ip, window_start)
      {:error, :rate_limited, retry_after}
    else
      :ok = insert_event("request", nil, ip, now)
      :ok
    end
  end

  defp compute_retry_after(email, kind, ip, window_start) do
    base = from(e in EmailAuthEvent, where: e.kind == ^kind, where: e.occurred_at > ^window_start)

    scoped =
      base
      |> add_optional_eq(:email, email)
      |> add_optional_eq(:client_ip, ip)

    earliest =
      scoped
      |> select([e], e.occurred_at)
      |> order_by([e], asc: e.occurred_at)
      |> limit(1)
      |> Repo.one()

    case earliest do
      nil ->
        @window_seconds

      %DateTime{} = dt ->
        max(@window_seconds - DateTime.diff(DateTime.utc_now(), dt, :second), 1)
    end
  end

  defp add_optional_eq(query, _field, nil), do: query

  defp add_optional_eq(query, field, value) do
    from(e in query, where: field(e, ^field) == ^value)
  end

  defp insert_event(kind, email, ip, now) do
    %EmailAuthEvent{}
    |> Ecto.Changeset.change(%{
      kind: kind,
      email: email || "unknown",
      client_ip: ip,
      occurred_at: now
    })
    |> Repo.insert()
    |> case do
      {:ok, _} -> :ok
      {:error, _} = err -> err
    end
  end

  defp count_events(kind, email, ip, window_start) do
    base = from(e in EmailAuthEvent, where: e.kind == ^kind, where: e.occurred_at > ^window_start)

    base
    |> add_optional_eq(:email, email)
    |> add_optional_eq(:client_ip, ip)
    |> Repo.aggregate(:count)
  end

  # ---------------------------------------------------------------------------
  # Lock-key hashing
  # ---------------------------------------------------------------------------

  defp email_lock_key(email) do
    (@email_lock_salt + truncated_hash(email)) |> Integer.mod(1_000_000_007)
  end

  defp ip_lock_key(ip) do
    (@ip_lock_salt + truncated_hash(ip)) |> Integer.mod(1_000_000_007)
  end

  defp truncated_hash(value) when is_binary(value) do
    <<top::64, _::binary>> = :crypto.hash(:sha256, value)
    top
  end

  defp truncated_hash(_), do: 0

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  @doc """
  Canonical form of an email address as stored on verification codes
  and rate-limit events: trimmed and lower-cased.
  """
  @spec normalize_email(String.t()) :: String.t()
  def normalize_email(email) when is_binary(email) do
    email |> String.trim() |> String.downcase()
  end

  # Coerce the IP into a stable rate-limit key that fits the schema's
  # `:string` column: the canonical text of an IPv4 or IPv6 address, so
  # two spellings of one address share a bucket. Anything else (`nil`,
  # garbage, oversized input) collapses to one fixed key, so a request
  # whose address cannot be resolved is still counted.
  defp normalize_client_ip(ip) when is_binary(ip) do
    ip |> String.trim() |> canonical_ip() || @unresolved_ip_key
  end

  defp normalize_client_ip(_), do: @unresolved_ip_key

  # `:inet.parse_strict_address/1` takes a charlist (given a binary it
  # answers `{:error, :einval}`) and, unlike `:inet.parse_address/1`,
  # refuses short forms such as "1.2.3". The length guard keeps
  # oversized input away from the parser; 45 bytes is the longest
  # textual IPv6 address.
  defp canonical_ip(ip) when byte_size(ip) <= 45 do
    with {:ok, address} <- ip |> String.to_charlist() |> :inet.parse_strict_address(),
         rendered when is_list(rendered) <- :inet.ntoa(address) do
      List.to_string(rendered)
    else
      _ -> nil
    end
  end

  defp canonical_ip(_ip), do: nil

  @doc """
  Mints a fresh six-digit plaintext code. The caller stores only its
  `hash_code/1` digest and never logs the plaintext.
  """
  @spec mint_code() :: String.t()
  def mint_code do
    # Six numeric digits in [100000, 999999], zero-padded.
    min = 100_000
    max = 999_999

    :telemetry.execute([:meal_planner_api, :email_code_auth, :mint_code], %{}, %{})
    code_int = min + :rand.uniform(max - min + 1) - 1
    code_int |> Integer.to_string() |> String.pad_leading(@code_length, "0")
  end

  @doc """
  Builds the verification-code email for `user` at `email`, addressed
  by the User's name when it has one. Delivery is left to the caller.
  """
  @spec code_email(PersistenceUser.t(), String.t(), String.t()) :: Bamboo.Email.t()
  def code_email(%PersistenceUser{} = user, email, code) do
    name =
      case is_binary(user.name) and user.name != "" do
        true -> user.name
        false -> nil
      end

    build_email(email, code, name)
  end

  defp build_email(email, code, nil), do: EmailCodeEmail.build(email, code)

  defp build_email(email, code, name) do
    # Use the named variant by re-importing Bamboo.Email and overriding
    # the `:to` field; the address and code remain unchanged.
    email_record = EmailCodeEmail.build(email, code)

    %{email_record | to: {name, email}}
  end

  # ---------------------------------------------------------------------------
  # Memberships
  # ---------------------------------------------------------------------------

  @doc """
  Loads the User's `:active` AccountMembership rows, preloaded with
  `:account`. Pure-Repo, no side effects.
  """
  @spec load_active_memberships(Ecto.UUID.t()) :: [PersistenceAccountMembership.t()]
  def load_active_memberships(user_id) do
    from(m in PersistenceAccountMembership,
      where: m.user_id == ^user_id,
      where: m.status == :active,
      preload: [:account]
    )
    |> Repo.all()
  end

  # ---------------------------------------------------------------------------
  # Continuations
  # ---------------------------------------------------------------------------

  @doc """
  Test-only fixture constructor. Mints a continuation for `user_id`
  bound to `membership_ids` and returns its plaintext: 32 random bytes
  base64url-encoded without padding. Only the SHA-256 digest of the
  plaintext is stored (`token_hash`).

  `:expires_at` defaults to five minutes from now; a test of the expired
  path passes a past instant instead of sleeping. No production code
  mints a continuation.
  """
  @spec mint_test_continuation(Ecto.UUID.t(), [Ecto.UUID.t()], keyword()) :: String.t()
  def mint_test_continuation(user_id, membership_ids, opts \\ []) do
    expires_at =
      Keyword.get(
        opts,
        :expires_at,
        DateTime.add(DateTime.utc_now(), @continuation_ttl_seconds, :second)
      )

    plaintext = generate_url_safe_token(32)
    hash = hash_continuation(plaintext)

    Repo.transaction(fn ->
      {:ok, row} =
        %AccountSelectionContinuation{}
        |> Ecto.Changeset.change(%{
          user_id: user_id,
          token_hash: hash,
          expires_at: expires_at
        })
        |> Repo.insert()

      Enum.each(membership_ids, fn membership_id ->
        {:ok, _link} =
          %AccountSelectionContinuationMembership{}
          |> Ecto.Changeset.change(%{
            continuation_id: row.id,
            membership_id: membership_id
          })
          |> Repo.insert()
      end)

      :ok
    end)

    plaintext
  end

  @doc """
  Hashes a continuation plaintext token (SHA-256 lower-case hex), the
  form `MealPlannerApiWeb.Plugs.SwitchAccountAuth` looks a continuation
  up by. Mirrors the public-API pattern of `InviteService.hash_token/1`.
  """
  @spec hash_continuation(String.t()) :: String.t()
  def hash_continuation(plaintext) when is_binary(plaintext) do
    :crypto.hash(:sha256, plaintext) |> Base.encode16(case: :lower)
  end

  @doc """
  Exchanges a continuation plaintext for a single
  `AccountMembership`. The exchange runs inside one
  `Repo.transaction/1`:

      1. Hash the plaintext and look up the row under
         `SELECT … FOR UPDATE` so concurrent exchange attempts
         serialize on the same row.
      2. Validate: not consumed, not expired, and (when supplied) the
         `principal` User matches the row's `user_id`.
      3. Verify the requested `target_membership_id` is in the
         continuation's allowed membership set via the join table.
      4. Delegate to `AccountsMembership.switch_account/2`, which
         enforces ownership and `:active` status.
      5. Mint the `access_v2` JWT inside the same transaction.
      6. Mark `consumed_at` and commit together.

  Pre-mint failures (steps 2–4) leave `consumed_at` NULL — the
  transaction rolls back. Concurrent / replayed exchange sees
  `:consumed_continuation` and returns no token.
  """
  @spec exchange_continuation(String.t(), String.t(), keyword()) :: exchange_result()
  def exchange_continuation(plaintext, target_membership_id, opts \\ [])
      when is_binary(plaintext) and is_binary(target_membership_id) and is_list(opts) do
    hash = hash_continuation(plaintext)
    principal = Keyword.get(opts, :principal, nil)

    with :ok <- assert_exchange_principal(principal) do
      Repo.transaction(
        fn -> exchange_under_lock(hash, principal, target_membership_id) end,
        timeout: :timer.seconds(5)
      )
      |> normalize_exchange_tx_result()
    end
  end

  # Runs inside the caller's transaction: the advisory lock is held until it
  # ends.
  defp exchange_under_lock(hash, principal, target_membership_id) do
    SQL.query!(Repo, "SELECT pg_advisory_xact_lock($1)", [
      continuation_lock_key(hash)
    ])

    with {:ok, row} <- lookup_continuation_for_exchange(hash),
         :ok <- assert_continuation_unconsumed(row),
         :ok <- assert_continuation_unexpired(row),
         :ok <- assert_continuation_bearer(principal, row),
         :ok <- assert_continuation_set(row, target_membership_id),
         {:ok, switch_payload} <- delegate_to_switch(row.user_id, target_membership_id),
         {:ok, access_token} <- mint_exchange_token(switch_payload) do
      consume_continuation(row)

      {:ok,
       Map.merge(switch_payload, %{
         access_token: access_token
       })}
    end
  end

  # Pre-flight guard so an unparseable bearer short-circuits before the
  # advisory lock — the lock is a Postgres round-trip we don't need to
  # pay for a token that the plug already rejected.
  defp assert_exchange_principal(:invalid_bearer), do: {:error, :invalid_bearer}
  defp assert_exchange_principal(_), do: :ok

  defp lookup_continuation_for_exchange(hash) do
    case from(c in AccountSelectionContinuation,
           where: c.token_hash == ^hash,
           lock: "FOR UPDATE"
         )
         |> Repo.one() do
      nil -> {:error, :invalid_continuation}
      %AccountSelectionContinuation{} = row -> {:ok, row}
    end
  end

  defp assert_continuation_unconsumed(%AccountSelectionContinuation{consumed_at: consumed})
       when not is_nil(consumed),
       do: {:error, :consumed_continuation}

  defp assert_continuation_unconsumed(_), do: :ok

  defp assert_continuation_unexpired(%AccountSelectionContinuation{expires_at: expires_at}) do
    if DateTime.compare(expires_at, DateTime.utc_now()) == :lt do
      {:error, :expired_continuation}
    else
      :ok
    end
  end

  # `nil` (bearerless) and `:invalid_bearer` are pre-filtered by
  # `assert_exchange_principal/1`. A non-nil principal that doesn't
  # match the row's `user_id` is `:foreign_bearer`.
  defp assert_continuation_bearer(nil, _row), do: :ok

  defp assert_continuation_bearer(principal_user_id, %AccountSelectionContinuation{
         user_id: user_id
       })
       when not is_nil(principal_user_id) do
    if principal_user_id == user_id, do: :ok, else: {:error, :foreign_bearer}
  end

  defp assert_continuation_set(
         %AccountSelectionContinuation{id: continuation_id},
         target_membership_id
       ) do
    case Ecto.UUID.cast(target_membership_id) do
      :error ->
        {:error, :not_in_continuation_set}

      {:ok, uuid} ->
        if Repo.exists?(
             from(m in AccountSelectionContinuationMembership,
               where: m.continuation_id == ^continuation_id,
               where: m.membership_id == ^uuid
             )
           ) do
          :ok
        else
          {:error, :not_in_continuation_set}
        end
    end
  end

  defp delegate_to_switch(user_id, target_membership_id) do
    user = Repo.get!(PersistenceUser, user_id)

    case AccountsMembership.switch_account(user, target_membership_id) do
      {:ok, payload} -> {:ok, payload}
      {:error, _} = err -> err
    end
  end

  defp mint_exchange_token(%{user: user, claims: claims}) do
    case Guardian.encode_and_sign(user, claims, token_type: "access") do
      {:ok, token, _verified_claims} -> {:ok, token}
      _ -> {:error, :token_refresh_failed}
    end
  end

  defp consume_continuation(%AccountSelectionContinuation{id: row_id}) do
    {1, _} =
      Repo.update_all(
        from(c in AccountSelectionContinuation, where: c.id == ^row_id),
        set: [consumed_at: DateTime.utc_now()]
      )

    :ok
  end

  defp normalize_exchange_tx_result({:ok, {:ok, payload}}), do: {:ok, payload}
  defp normalize_exchange_tx_result({:ok, {:error, _} = err}), do: err
  defp normalize_exchange_tx_result(other), do: other

  defp continuation_lock_key(hash) do
    (@continuation_lock_salt + truncated_hash(hash)) |> Integer.mod(1_000_000_007)
  end

  # Token-mint helper of `mint_test_continuation/3`. 32 random bytes →
  # ~43 base64url chars.
  defp generate_url_safe_token(byte_size) do
    byte_size
    |> :crypto.strong_rand_bytes()
    |> Base.url_encode64(padding: false)
  end
end
