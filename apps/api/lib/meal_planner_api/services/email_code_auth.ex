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
    * `check_verify_failures/1` and `record_verify_failure/1` — the
      rolling 1-hour counter of failed code verifications (20 per IP),
      kept in the same table under its own kind.
    * `max_code_attempts/0` — the failed attempts after which a code is
      locked for good.
    * `code_email/3` — the verification-code email.
    * `load_active_memberships/1` — the `:active` Memberships of a User.
  """

  import Ecto.Query

  alias Ecto.Adapters.SQL
  alias MealPlannerApi.Mailer.EmailCodeEmail
  alias MealPlannerApi.Persistence.Accounts.AccountMembership, as: PersistenceAccountMembership
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Persistence.Auth.EmailAuthEvent
  alias MealPlannerApi.Repo

  @window_seconds 3600
  @max_per_email_per_window 5
  @max_per_ip_per_window 20
  @max_verify_failures_per_ip_per_window 20
  @code_length 6
  @max_code_attempts 5
  # Per-IP bucket of the requests whose client address is not an IP.
  @unresolved_ip_key "unresolved"

  # Lock keys are 64-bit signed integers fed to `pg_advisory_xact_lock`.
  # We hash the normalized inputs so neither key collides with another
  # in a way that serializes unrelated work.
  @email_lock_salt 0x4D45_6C70_6861_756C
  @ip_lock_salt 0x4D45_6C70_5F69_705F

  @type rate_limited :: {:error, :rate_limited, non_neg_integer()}

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
  exhausted, and then reserves neither: a refused request spends no
  slot.

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
    now = DateTime.utc_now()

    lock!(ip_lock_key(ip))

    with :ok <- check_ip_slot(ip, now) do
      insert_event("request", nil, ip, now)
    end
  end

  @doc """
  Answers `{:error, :rate_limited, retry_after}` when `client_ip` has
  #{@max_verify_failures_per_ip_per_window} failed code verifications in
  the rolling 1-hour window, `:ok` otherwise. Nothing is recorded; the
  caller records each failure with `record_verify_failure/1`.

  A `client_ip` that is not an IP address (`nil` included) draws from one
  shared bucket, as in `reserve_request_slots/2`.

  No lock is taken, so verifications from one IP never wait on each
  other. Failures that land at the same moment may each pass the check
  and run the counter a few past the limit; every later verification from
  that IP is refused all the same.
  """
  @spec check_verify_failures(String.t() | nil) :: :ok | rate_limited()
  def check_verify_failures(client_ip) do
    check_slot(
      "verification_failure",
      nil,
      normalize_client_ip(client_ip),
      @max_verify_failures_per_ip_per_window,
      DateTime.utc_now()
    )
  end

  @doc """
  Records one failed code verification against `client_ip`, in the
  counter `check_verify_failures/1` reads.
  """
  @spec record_verify_failure(String.t() | nil) :: :ok
  def record_verify_failure(client_ip) do
    insert_event("verification_failure", nil, normalize_client_ip(client_ip), DateTime.utc_now())
  end

  @doc """
  Failed attempts after which a verification code is locked for good.
  `MealPlannerApi.Services.EmailCodeLogin` counts the attempts and
  enforces the limit, for sign-up codes too.
  """
  @spec max_code_attempts() :: pos_integer()
  def max_code_attempts, do: @max_code_attempts

  @doc """
  Failed code verifications per client IP in the rolling 1-hour window
  after which `check_verify_failures/1` refuses that IP.
  """
  @spec max_verify_failures_per_ip() :: pos_integer()
  def max_verify_failures_per_ip, do: @max_verify_failures_per_ip_per_window

  # ---------------------------------------------------------------------------
  # Rate limiting
  # ---------------------------------------------------------------------------

  # Reserves a slot in the rolling 1-hour window for the email and the
  # IP (an address or the shared unresolved bucket), or neither: both
  # counters are checked before either event is written. The two
  # counters are serialized by hash-derived advisory locks so concurrent
  # requesters cannot race past the limit on the same key.
  defp reserve_slots(email, ip) do
    now = DateTime.utc_now()

    lock!(email_lock_key(email))
    lock!(ip_lock_key(ip))

    with :ok <- check_slot("request", email, nil, @max_per_email_per_window, now),
         :ok <- check_ip_slot(ip, now),
         :ok <- insert_event("request", email, nil, now) do
      insert_event("request", nil, ip, now)
    end
  end

  defp check_ip_slot(ip, now), do: check_slot("request", nil, ip, @max_per_ip_per_window, now)

  # `:ok` while the counter of `kind` scoped to `email` or `ip` holds
  # fewer than `max` events in the window ending at `now`.
  defp check_slot(kind, email, ip, max, now) do
    window_start = DateTime.add(now, -@window_seconds, :second)

    if count_events(kind, email, ip, window_start) >= max do
      {:error, :rate_limited, compute_retry_after(email, kind, ip, window_start)}
    else
      :ok
    end
  end

  defp lock!(key), do: SQL.query!(Repo, "SELECT pg_advisory_xact_lock($1)", [key])

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
    Repo.insert!(%EmailAuthEvent{
      kind: kind,
      email: email || "unknown",
      client_ip: ip,
      occurred_at: now
    })

    :ok
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
end
