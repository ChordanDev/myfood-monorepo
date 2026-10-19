defmodule MealPlannerApi.Services.EmailCodeAuth do
  @moduledoc """
  Shared building blocks of authentication with an email code.

  The module has no request or verify entry point of its own: the mobile
  contract lives in `MealPlannerApi.Services.EmailCodeLogin` and
  `MealPlannerApi.Services.EmailCodeSignup`. What those two share is
  here:

    * `mint_code/0` and `hash_code/1` — the six-digit code and the
      SHA-256 digest that is the only form of a code ever stored. The
      canonical email is `MealPlannerApi.Persistence.Accounts.UserEmail.normalize/1`.
    * `reserve_request_slots/2` and `reserve_ip_request_slot/1` — the
      rolling 1-hour request counters (5 per email, 20 per IP bucket and,
      for an IPv6 client, 100 per /56), kept in `email_auth_events` and
      serialized by Postgres advisory locks so concurrent requesters cannot
      collectively exceed them.
    * `reserve_verify_failure/1` — the rolling 1-hour counter of failed
      code verifications (20 per IP bucket), kept in the same table under
      its own kind. Only failed checks read or write it, so a code that
      verifies is never refused by it.
    * `max_code_attempts/0` — the failed attempts after which a code is
      locked for good.
    * `code_email/4` — the verification-code email.
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
  @max_per_ipv6_56_per_window 100
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
  @verify_failure_lock_salt 0x4D45_6C70_5F76_6661

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
  (already normalized) and one for each bucket of `client_ip`. Returns
  `{:error, :rate_limited, retry_after}` when any of those counters is
  exhausted, with the `retry_after` of the full one, and then reserves
  none: a refused request spends no slot.

  `client_ip` is an IPv4 or IPv6 address as text. An IPv4 address has a
  counter of its own; an IPv6 address shares one with its whole /64
  prefix (#{@max_per_ip_per_window} an hour) and also draws from the
  counter of its /56 (#{@max_per_ipv6_56_per_window} an hour), so a client
  delegated a /56 or wider cannot rotate /64s for fresh slots. An
  IPv4-mapped address (`::ffff:a.b.c.d`) counts as its IPv4 address. One
  that is not an address (`nil` included) is not let through uncounted:
  all such requests draw from a single shared bucket.

  Must run inside a `Repo.transaction/2`: the advisory locks that
  serialize concurrent requesters are transaction-scoped. Called by
  `MealPlannerApi.Services.EmailCodeLogin.issue_code/4` for login and
  sign-up requests alike, so both draw from the same counters.
  """
  @spec reserve_request_slots(String.t(), String.t() | nil) :: :ok | rate_limited()
  def reserve_request_slots(email, client_ip) when is_binary(email) do
    reserve_slots(email, request_buckets(client_ip))
  end

  @doc """
  Reserves one slot in the rolling 1-hour request window for `client_ip`
  alone, in the same per-IP counters `reserve_request_slots/2` draws
  from (the /64 and the /56 of an IPv6 client). No per-email event is
  recorded. Returns `{:error, :rate_limited, retry_after}` when a counter
  is exhausted, and then reserves nothing.
  A `client_ip` that is not an IP address (`nil` included) draws from the
  same shared bucket as in `reserve_request_slots/2`.

  Must run inside a `Repo.transaction/2`, like `reserve_request_slots/2`.
  Used by `MealPlannerApi.Services.EmailCodeLogin` to count requests for
  emails that have no User.
  """
  @spec reserve_ip_request_slot(String.t() | nil) :: :ok | rate_limited()
  def reserve_ip_request_slot(client_ip) do
    buckets = request_buckets(client_ip)
    now = DateTime.utc_now()

    lock_in_order!(ip_lock_keys(buckets))

    with :ok <- check_ip_slots(buckets, now) do
      insert_ip_events(buckets, now)
    end
  end

  @doc """
  Reserves one failed code verification for `client_ip`, or answers
  `{:error, :rate_limited, retry_after}` and records nothing when the IP
  already has #{@max_verify_failures_per_ip_per_window} in the rolling
  1-hour window.

  `client_ip` is bucketed as in `reserve_request_slots/2`: an IPv4
  address on its own, an IPv6 address with its whole /64 prefix, and
  anything that is not an address (`nil` included) in one shared bucket.
  The /56 counter of code requests does not apply to failures.

  Call it only once a code check has failed, never before the code is
  matched: a code that verifies must log in whatever the bucket holds,
  so one client cannot lock out others sharing its IP (or the
  unresolved bucket) by spending its failures.

  Must run inside a `Repo.transaction/2`: the transaction holds the lock
  of this IP's failure counter until it ends, so concurrent failures
  from one IP cannot run past the limit together. Successful
  verifications never take it.
  """
  @spec reserve_verify_failure(String.t() | nil) :: :ok | rate_limited()
  def reserve_verify_failure(client_ip) do
    ip = normalize_client_ip(client_ip)
    now = DateTime.utc_now()

    lock!(verify_failure_lock_key(ip))

    with :ok <-
           check_slot(
             "verification_failure",
             nil,
             ip,
             @max_verify_failures_per_ip_per_window,
             now
           ) do
      insert_event("verification_failure", nil, ip, now)
    end
  end

  @doc """
  Failed attempts after which a verification code is locked for good.
  `MealPlannerApi.Services.EmailCodeLogin` counts the attempts and
  enforces the limit, for sign-up codes too.
  """
  @spec max_code_attempts() :: pos_integer()
  def max_code_attempts, do: @max_code_attempts

  @doc """
  Failed code verifications per IP bucket (see `reserve_verify_failure/1`)
  in the rolling 1-hour window after which `reserve_verify_failure/1`
  refuses that bucket's further failures.
  """
  @spec max_verify_failures_per_ip() :: pos_integer()
  def max_verify_failures_per_ip, do: @max_verify_failures_per_ip_per_window

  # ---------------------------------------------------------------------------
  # Rate limiting
  # ---------------------------------------------------------------------------

  # Reserves a slot in the rolling 1-hour window for the email and every
  # IP bucket (an address, an IPv6 /64 and its /56, or the shared
  # unresolved bucket), or none: every counter is checked before any
  # event is written. The counters are serialized by hash-derived
  # advisory locks so concurrent requesters cannot race past the limit on
  # the same key.
  defp reserve_slots(email, buckets) do
    now = DateTime.utc_now()

    lock_in_order!([email_lock_key(email) | ip_lock_keys(buckets)])

    with :ok <- check_slot("request", email, nil, @max_per_email_per_window, now),
         :ok <- check_ip_slots(buckets, now),
         :ok <- insert_event("request", email, nil, now) do
      insert_ip_events(buckets, now)
    end
  end

  # `:ok` while every bucket has room, or the refusal of the first full
  # one, so its `retry_after` is that bucket's.
  defp check_ip_slots(buckets, now) do
    Enum.reduce_while(buckets, :ok, fn {ip, max}, :ok ->
      case check_slot("request", nil, ip, max, now) do
        :ok -> {:cont, :ok}
        refused -> {:halt, refused}
      end
    end)
  end

  defp insert_ip_events(buckets, now) do
    Enum.each(buckets, fn {ip, _max} -> insert_event("request", nil, ip, now) end)
  end

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

  # Takes several locks in ascending key order, the one order every
  # caller shares, so two transactions that need overlapping keys (an
  # email and a /56, or two hashes that collide) cannot deadlock.
  defp lock_in_order!(keys), do: keys |> Enum.uniq() |> Enum.sort() |> Enum.each(&lock!/1)

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

  defp ip_lock_keys(buckets), do: Enum.map(buckets, fn {ip, _max} -> ip_lock_key(ip) end)

  defp verify_failure_lock_key(ip) do
    (@verify_failure_lock_salt + truncated_hash(ip)) |> Integer.mod(1_000_000_007)
  end

  defp truncated_hash(value) when is_binary(value) do
    <<top::64, _::binary>> = :crypto.hash(:sha256, value)
    top
  end

  defp truncated_hash(_), do: 0

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  # Coerce the IP into a stable rate-limit key that fits the schema's
  # `:string` column: the canonical text of an IPv4 address, or of the
  # /64 prefix of an IPv6 address, so two spellings of one address share
  # a bucket. Anything else (`nil`, garbage, oversized input) collapses
  # to one fixed key, so a request whose address cannot be resolved is
  # still counted.
  defp normalize_client_ip(client_ip) do
    case parse_client_ip(client_ip) do
      {:ok, address} -> address |> bucket_address() |> render_bucket()
      :error -> @unresolved_ip_key
    end
  end

  # The `{key, max}` buckets a code request from `client_ip` draws from:
  # its own, plus the /56 of an IPv6 /64. An IPv4 address, an IPv4-mapped
  # one and an unresolved one keep a single bucket.
  defp request_buckets(client_ip) do
    case parse_client_ip(client_ip) do
      {:ok, address} ->
        bucket = bucket_address(address)
        [{render_bucket(bucket), @max_per_ip_per_window} | wide_request_buckets(bucket)]

      :error ->
        [{@unresolved_ip_key, @max_per_ip_per_window}]
    end
  end

  # ISPs and hosting providers commonly delegate a /56 to one customer,
  # 256 /64s that would each be a fresh bucket of their own.
  defp wide_request_buckets({:prefix64, {a, b, c, d, 0, 0, 0, 0}}) do
    prefix56 = {a, b, c, Bitwise.band(d, 0xFF00), 0, 0, 0, 0}
    [{List.to_string(:inet.ntoa(prefix56)) <> "/56", @max_per_ipv6_56_per_window}]
  end

  defp wide_request_buckets(_ipv4), do: []

  # `:inet.parse_strict_address/1` takes a charlist (given a binary it
  # answers `{:error, :einval}`) and, unlike `:inet.parse_address/1`,
  # refuses short forms such as "1.2.3". The length guard keeps
  # oversized input away from the parser; 45 bytes is the longest
  # textual IPv6 address.
  defp parse_client_ip(ip) when is_binary(ip) do
    trimmed = String.trim(ip)

    with true <- byte_size(trimmed) <= 45,
         {:ok, address} <- trimmed |> String.to_charlist() |> :inet.parse_strict_address() do
      {:ok, address}
    else
      _ -> :error
    end
  end

  defp parse_client_ip(_), do: :error

  # An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is the IPv4 client
  # `a.b.c.d` as a dual-stack listener reports it, so it counts as that
  # address. Left to the /64 rule, every one of them would share `::/64`.
  defp bucket_address({0, 0, 0, 0, 0, 0xFFFF, _, _} = mapped),
    do: :inet.ipv4_mapped_ipv6_address(mapped)

  # A single IPv6 subscriber is handed a whole /64 and can rotate its
  # source address inside it for free, so the prefix is the bucket.
  defp bucket_address({a, b, c, d, _, _, _, _}), do: {:prefix64, {a, b, c, d, 0, 0, 0, 0}}
  defp bucket_address(ipv4), do: ipv4

  defp render_bucket({:prefix64, prefix}), do: List.to_string(:inet.ntoa(prefix)) <> "/64"
  defp render_bucket(ipv4), do: List.to_string(:inet.ntoa(ipv4))

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
  by the User's name when it has one. `kind` is the wording
  (`MealPlannerApi.Mailer.EmailCodeEmail.build/3`). Delivery is left to
  the caller.
  """
  @spec code_email(PersistenceUser.t(), String.t(), String.t(), EmailCodeEmail.kind()) ::
          Bamboo.Email.t()
  def code_email(%PersistenceUser{} = user, email, code, kind \\ :sign_in) do
    name =
      case is_binary(user.name) and user.name != "" do
        true -> user.name
        false -> nil
      end

    build_email(email, code, name, kind)
  end

  defp build_email(email, code, nil, kind), do: EmailCodeEmail.build(email, code, kind)

  defp build_email(email, code, name, kind) do
    # Use the named variant by re-importing Bamboo.Email and overriding
    # the `:to` field; the address and code remain unchanged.
    email_record = EmailCodeEmail.build(email, code, kind)

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
