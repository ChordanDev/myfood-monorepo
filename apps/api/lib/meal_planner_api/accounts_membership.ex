defmodule MealPlannerApi.AccountsMembership do
  @moduledoc """
  Application-layer use cases for multi-familia tenancy.

  Phase A — Tenancy Refactor (PR 2a, tasks 2.1–2.8). This module owns the
  invitation lifecycle, seat-cap enforcement, roster listing, leave/switch
  flows, and the `access_v2` JWT claim builder. Persistence queries live in
  `MealPlannerApi.Persistence.Accounts.*` and `MealPlannerApi.Repo` —
  schemas are dumb data per Clean Architecture.

  See `specs/account-membership.md`, `invite-and-accept.md`,
  `multi-familia-switch-account.md`, and `guardian-jwt-claims.md`.
  """

  require Logger

  alias MealPlannerApi.Accounts
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.AccountMembershipQueries
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Persistence.Accounts.UserEmail
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeLogin
  alias MealPlannerApi.Services.InviteService

  import Ecto.Query

  @plan_capacities %{individual: 1, family_4: 4, family_6: 6, trial: 6}

  @doc """
  Builds the `access_v2` JWT claim map for the given user + membership
  pair. The result matches design §3.2 exactly (Guardian adds `iat` and
  `exp` at sign time — those are NOT application claims).

  Phase 3 (issue #31 task 3.2) added the explicit `"user_id"` claim, so
  the claim map names its User without the caller re-loading the User
  struct.

  ## Examples

      iex> claims = AccountsMembership.claims_for(user, membership)
      iex> claims["typ"]
      "access_v2"
  """
  @spec claims_for(PersistenceUser.t(), AccountMembership.t()) :: map()
  def claims_for(%PersistenceUser{} = user, %AccountMembership{} = membership) do
    plan = membership_plan(membership)

    %{
      "typ" => "access_v2",
      "user_id" => to_string(user.id),
      "membership_id" => to_string(membership.id),
      "account_id" => to_string(membership.account_id),
      "role" => Atom.to_string(membership.role),
      "plan" => Atom.to_string(plan),
      "status" => Atom.to_string(membership.status),
      "email" => user.email,
      "name" => user.name
    }
  end

  @doc """
  Phase 3 (issue #31 task 3.2) — zero-membership claims builder.

  Builds an `access_v2` claim map for a User that has zero `:active`
  memberships. The map intentionally OMITS `"membership_id"` (and every
  other membership-scoped field) so `LoadCurrentMembership` halts with
  `401 membership_id_required` on a JWT minted from it, which is the
  client's cue to route to invite acceptance.

  `iat` and `exp` are Guardian-managed (added at sign time) and are not
  the responsibility of this builder.
  """
  @spec claims_for(PersistenceUser.t()) :: map()
  def claims_for(%PersistenceUser{} = user) do
    %{
      "typ" => "access_v2",
      "user_id" => to_string(user.id),
      "email" => user.email,
      "name" => user.name
    }
  end

  @doc """
  Returns the seat usage for an Account:

      %{active: N, invited: M, capacity: C}

  where `active` is the count of `:active` memberships, `invited` is the
  count of `:invited` memberships, and `capacity` is the plan's seat cap
  (1 for `:individual`, 4 for `:family_4`, 6 for `:family_6` and `:trial`).

  Per `specs/account-membership.md` §"Seat cap per Account.plan" the cap
  applies to `:active + :invited` rows.
  """
  @spec seat_usage(Account.t()) :: %{
          active: non_neg_integer(),
          invited: non_neg_integer(),
          capacity: pos_integer()
        }
  def seat_usage(%Account{plan: plan} = account) do
    query =
      from(m in AccountMembership,
        where: m.account_id == ^account.id,
        where: m.status in [:active, :invited],
        group_by: m.status,
        select: {m.status, count(m.id)}
      )

    counts =
      case Repo.all(query) do
        rows when is_list(rows) -> Map.new(rows)
        _ -> %{}
      end

    %{
      active: Map.get(counts, :active, 0),
      invited: Map.get(counts, :invited, 0),
      capacity: Map.fetch!(@plan_capacities, plan)
    }
  end

  @doc """
  Enforces the seat cap for an Account. Returns `:ok` when
  `active + invited + count_to_add` is at or below capacity, otherwise
  `{:error, :seat_cap_reached}`.

  Called inside the invite transaction (design §6.1) under
  `SELECT … FOR UPDATE` on the Account row to prevent the seat-cap race
  (proposal §"Risks").
  """
  @spec enforce_seat_cap(Account.t(), pos_integer()) ::
          :ok | {:error, :seat_cap_reached}
  def enforce_seat_cap(account, count_to_add \\ 1)
      when is_integer(count_to_add) and count_to_add >= 1 do
    %{active: active, invited: invited, capacity: capacity} = seat_usage(account)

    if active + invited + count_to_add > capacity do
      {:error, :seat_cap_reached}
    else
      :ok
    end
  end

  @doc """
  Invites a new email to an Account. Owner-only. Wraps
  `InviteService.create_invite_row/2` and `enforce_seat_cap/2` so the
  seat cap is checked atomically with the row insert.

  Refuses with:
    * `:not_owner` — `actor.role != :owner`
    * `:seat_cap_reached` — Account has reached the plan's seat cap
    * `:already_invited` — an `:invited` row already exists for the email
    * `:already_a_member` — an `:active` row already exists for the email

  On success returns `{:ok, %{token, expires_at, membership_id, email}}`
  where `token` is the plaintext (returned exactly once — caller is
  responsible for never logging or persisting it).
  """
  @spec invite(Account.t(), AccountMembership.t(), String.t()) ::
          {:ok,
           %{
             token: String.t(),
             expires_at: DateTime.t(),
             membership_id: String.t(),
             email: String.t()
           }}
          | {:error, atom()}
  def invite(%Account{} = account, %AccountMembership{role: role} = actor, email)
      when role == :owner and is_binary(email) do
    case Repo.transaction(fn -> create_invite(account, actor, email) end) do
      {:ok, {:ok, result}} -> {:ok, result}
      {:ok, {:error, reason}} -> {:error, reason}
      {:error, _} -> {:error, :unable_to_invite}
    end
  end

  def invite(_account, %AccountMembership{}, _email), do: {:error, :not_owner}

  defp create_invite(account, actor, email) do
    with :ok <- lock_account_for_invite(account),
         :ok <- enforce_seat_cap(account, 1),
         :ok <- check_existing_membership(account, email),
         {:ok, %{membership: m, token: token}} <-
           InviteService.create_invite_row(actor, email) do
      {:ok,
       %{
         token: token,
         expires_at: m.invite_expires_at,
         membership_id: to_string(m.id),
         email: email
       }}
    else
      {:error, _} = err -> err
    end
  end

  @doc """
  Resolves the `current_membership` from a JWT claim map. Delegates to
  `MealPlannerApi.Persistence.Accounts.AccountMembershipQueries`, the
  same shared query module used by the `LoadCurrentMembership` plug and
  `LoadCurrentMembershipSocket` in `meal_planner_api_web/plugs/`
  (PR 1 task 1.10), so the application layer has a single source of
  truth for membership resolution — useful for tests, channels, and
  background jobs that need to bypass the conn pipeline.

  Per design §10 (Q1), when the JWT is `access_v1` (legacy) the
  function loads the real, `:active` `AccountMembership` row for
  `(user.id, claims["account_id"])`.

  Post-PR-3b review — BLOCKER fix (legacy membership synthesis): this
  used to fabricate an in-memory `%AccountMembership{status: :active}`
  struct straight from the claim, with `__synthesized__: true` and NO
  database lookup at all. `remove_member/3` and `leave/2` hard-delete
  the real row without ever clearing `user.account_id`, and legacy
  tokens carry a 4-week TTL with no server-side revocation — so a
  removed member's stale token retained full access for weeks. The
  function now REQUIRES a real, `:active` row; if none exists it
  returns `nil`, exactly like the `access_v2` no-membership case.

  Returns `nil` if `user` is `nil`, the membership can't be resolved,
  or the `typ` claim is unknown.
  """
  @spec current_membership(PersistenceUser.t() | nil, map()) :: AccountMembership.t() | nil
  def current_membership(nil, _claims), do: nil

  def current_membership(%PersistenceUser{} = user, claims) when is_map(claims) do
    case Map.get(claims, "typ", "access") do
      "access_v2" -> load_v2_membership(claims)
      "access" -> load_real_legacy_membership(user, claims)
      _ -> nil
    end
  end

  # Requires status: :active, mirroring the legacy branch below and
  # `LoadCurrentMembership.load_access_v2_membership/1` (tenancy debt
  # cleanup item 2) — this function has no status-aware caller
  # downstream (unlike the Channel join path, which re-checks status
  # itself), so it must enforce active-only here.
  defp load_v2_membership(claims) do
    case Map.get(claims, "membership_id") do
      nil ->
        nil

      "" ->
        nil

      membership_id ->
        case AccountMembershipQueries.load_membership_by_id(membership_id) do
          %AccountMembership{status: :active} = membership -> membership
          _ -> nil
        end
    end
  end

  defp load_real_legacy_membership(%PersistenceUser{} = user, claims) do
    case Map.get(claims, "account_id") do
      nil ->
        nil

      "" ->
        nil

      account_id ->
        case AccountMembershipQueries.load_active_membership(user.id, account_id) do
          nil ->
            Logger.warning(
              "legacy access token denied: no active membership found user_id=#{user.id} account_id=#{account_id}"
            )

            nil

          %AccountMembership{} = membership ->
            membership
        end
    end
  end

  @doc """
  Accepts an invite token. Three entry points:

    * `accept_invite(plaintext, %User{} = user)` — existing User. Flips
      the membership `:invited → :active` and sets `joined_at`. The
      invite has to be bound to that User; an invite bound to anyone
      else returns `:invite_for_another_user`. Returns the auth payload
      ready for the API layer to mint an `access_v2` JWT.

    * `accept_invite(plaintext, %{name: ...})` — new User. The
      `InviteService.create_invite_row/2` created a stub `User` row at
      invite time; this function claims it with the real `name`, then
      flips the membership. The User holds no credential: they sign in
      with an email code. The caller is not authenticated, so only a
      User still marked `invite_stub` can be claimed, and only once. An
      invite bound to any other User returns
      `:invitee_authentication_required`: that User has to accept with
      their own token or with an email code.

    * `accept_invite(plaintext, %{code: ..., client_ip: ..., open_session: ...})` — any
      invitee, proving they own the invited email with the code
      `request_invite_code/2` mailed to it (issue #297). The code is
      checked and consumed as `MealPlannerApi.Services.EmailCodeLogin`
      checks a login code: only the latest pending invite code for that
      email matches, a wrong code counts against the code's attempt cap
      and against `client_ip`'s hourly failure limit, and a failed check
      (a wrong, expired or locked code) from an IP over that limit is
      refused; a code that verifies is never refused by that limit. A
      login or sign-up code never matches. A stub accepted this way is
      claimed, so no `name` accept can claim it afterwards. Extra errors:
      `:code_invalid`, `:code_expired`, `:too_many_attempts` and
      `{:error, :rate_limited, retry_after}`. A `code` that is not a
      string is `:code_invalid` without a check, as the login refuses it,
      so it counts as no failed verification. Like a login, the accept
      ends in the session `open_session` opens: it receives the User and
      the new `:active` Membership, runs in the transaction that consumes
      the code, and answers `{:ok, session}` (returned under `:session`)
      or `{:error, reason}`. When the accept or the session fails, nothing
      is written and the code stays pending.

  Errors: `:invite_token_used`, `:invite_token_expired`,
  `:invite_token_unknown`, `:invitee_authentication_required`,
  `:invite_for_another_user`. Nothing
  is written when the accept fails.

  The returned `claims` map matches design §3.2 — `AccountsMembership.
  claims_for/2` (task 2.1) is the single source of truth for the
  `access_v2` shape.
  """
  @spec accept_invite(String.t(), PersistenceUser.t() | map()) ::
          {:ok,
           %{
             required(:user) => PersistenceUser.t(),
             required(:account) => Account.t(),
             required(:membership) => AccountMembership.t(),
             required(:claims) => map(),
             # Only on a code accept: what its `open_session` answered.
             optional(:session) => term()
           }}
          | {:error, atom() | Ecto.Changeset.t()}
          | {:error, :rate_limited, pos_integer()}
  def accept_invite(plaintext, %PersistenceUser{} = invitee) when is_binary(plaintext) do
    accept_invite_with_lookup(plaintext, fn
      %PersistenceUser{id: id} when id == invitee.id -> {:ok, invitee}
      %PersistenceUser{} -> {:error, :invite_for_another_user}
    end)
  end

  def accept_invite(plaintext, %{code: code, open_session: open_session} = proof)
      when is_binary(plaintext) and is_function(open_session, 2) do
    hash = InviteService.hash_token(plaintext)

    with {:ok, invitee} <- pending_invitee(hash) do
      EmailCodeLogin.redeem_code(
        UserEmail.normalize(invitee.email),
        code,
        :invite,
        fn row, _now -> accept_with_code(hash, row, open_session) end,
        limit_failures_by: Map.get(proof, :client_ip)
      )
    end
  end

  def accept_invite(plaintext, %{name: name})
      when is_binary(plaintext) and is_binary(name) do
    accept_invite_with_lookup(plaintext, &claim_invite_stub(&1, name))
  end

  def accept_invite(_plaintext, _args), do: {:error, :invalid_invitee}

  # The update only matches while the row is still a stub, so two accepts
  # racing on two invites for the same email claim it once.
  defp claim_invite_stub(%PersistenceUser{invite_stub: true} = stub, name) do
    changeset = PersistenceUser.changeset(stub, %{name: name})

    if changeset.valid? do
      query =
        from(u in PersistenceUser,
          where: u.id == ^stub.id and u.invite_stub == true,
          select: u
        )

      case Repo.update_all(query,
             set: [
               name: Ecto.Changeset.get_field(changeset, :name),
               invite_stub: false,
               updated_at: DateTime.utc_now()
             ]
           ) do
        {1, [claimed]} -> {:ok, claimed}
        {0, _} -> {:error, :invitee_authentication_required}
      end
    else
      {:error, changeset}
    end
  end

  defp claim_invite_stub(%PersistenceUser{}, _name),
    do: {:error, :invitee_authentication_required}

  # Runs in the transaction that consumes the code, which rolls back on
  # any error, so a session that cannot be opened undoes the accept.
  defp accept_with_code(hash, row, open_session) do
    with {:ok, accepted} <- accept_pending_invite(hash, &claim_with_code(&1, row)),
         {:ok, session} <- open_session.(accepted.user, accepted.membership) do
      {:ok, Map.put(accepted, :session, session)}
    end
  end

  # The code was issued for the User the invite is bound to, so it proves
  # they own the email. A stub stops being one here: from now on that User
  # accepts with their own token or a code, never by `name`.
  defp claim_with_code(%PersistenceUser{id: id} = invitee, %EmailVerificationCode{user_id: id}) do
    if invitee.invite_stub do
      Repo.update_all(from(u in PersistenceUser, where: u.id == ^id),
        set: [invite_stub: false, updated_at: DateTime.utc_now()]
      )
    end

    {:ok, %{invitee | invite_stub: false}}
  end

  defp claim_with_code(%PersistenceUser{}, %EmailVerificationCode{}),
    do: {:error, :code_invalid}

  @doc """
  Mails a code to the email of the User the invite `plaintext` is bound
  to, never to an address the caller names (issue #297). The invitee
  accepts with it through `accept_invite/2`, which is how a User who
  already exists but has no session proves they own the invited email.

  The code is issued as `MealPlannerApi.Services.EmailCodeLogin` issues a
  login code, with its own `:invite` purpose: the same resend cooldown
  per email, the same hourly request limits per email and per IP bucket
  (`client_ip`), and only the latest code stays pending.

  Errors: `:invite_token_used`, `:invite_token_expired`,
  `:invite_token_unknown` (nothing is mailed and no limit is spent),
  `{:error, :rate_limited, retry_after}`, and `:code_send_failed` when the
  mailer refused the message (the caller may retry at once).
  """
  @spec request_invite_code(String.t(), String.t() | nil) ::
          {:ok, EmailCodeLogin.code_sent()}
          | {:error,
             :invite_token_used
             | :invite_token_expired
             | :invite_token_unknown
             | :code_send_failed}
          | {:error, :rate_limited, pos_integer()}
  def request_invite_code(plaintext, client_ip) when is_binary(plaintext) do
    with {:ok, invitee} <- pending_invitee(InviteService.hash_token(plaintext)) do
      EmailCodeLogin.issue_code(
        UserEmail.normalize(invitee.email),
        client_ip,
        :invite,
        fn _email, _client_ip -> {:ok, invitee} end
      )
    end
  end

  # The User a still-pending invite is bound to. Nothing is locked: the
  # accept locks the invite again before it changes anything.
  defp pending_invitee(hash) do
    with {:ok, membership} <- find_invited_membership(hash) do
      fetch_membership_user(membership)
    end
  end

  @doc """
  Multi-familia switch: re-issue the access_v2 claim set scoped to a
  different `:active` membership that the User already holds. Returns
  the auth payload ready for the controller to mint a fresh JWT.

  Refuses:

    * `:membership_not_found` — id doesn't resolve to any row
    * `:not_your_membership` — the membership belongs to a different User
    * `:membership_not_active` — the membership is `:invited`,
      `:suspended`, or otherwise non-active

  Per `specs/multi-familia-switch-account.md` this is the canonical
  "switch account" flow.
  """
  @spec switch_account(PersistenceUser.t(), Ecto.UUID.t() | binary()) ::
          {:ok,
           %{
             user: PersistenceUser.t(),
             account: Account.t(),
             membership: AccountMembership.t(),
             claims: map()
           }}
          | {:error, :membership_not_found | :not_your_membership | :membership_not_active}
  def switch_account(%PersistenceUser{id: user_id}, target_membership_id)
      when is_binary(target_membership_id) do
    with {:ok, uuid} <- cast_uuid(target_membership_id),
         {:ok, membership} <- load_active_membership(uuid),
         :ok <- assert_owner(user_id, membership),
         {:ok, account} <- load_account(membership.account_id) do
      membership = Repo.preload(membership, :account)
      # Refetch the User so we get the canonical email/name (not the
      # one the caller passed in — switch_account is security-sensitive
      # and should not trust caller-supplied identity fields).
      fresh_user = Repo.get!(PersistenceUser, user_id)

      {:ok,
       %{
         user: fresh_user,
         account: account,
         membership: membership,
         claims: build_response_claims(fresh_user, account, membership)
       }}
    end
  end

  def switch_account(_user, _id), do: {:error, :membership_not_found}

  # Post-review fix pass, item 2: `switch_account/2` and `accept_invite/2`
  # used to call `claims_for/2` directly, unconditionally minting
  # `access_v2` regardless of `MEAL_PLANNER_TENANCY_V2`, which made the
  # flag not a real killswitch for these two flows. They are the only
  # readers of that flag in `lib`.
  defp build_response_claims(user, account, membership) do
    if tenancy_v2_only?() do
      claims_for(user, membership)
    else
      Accounts.claims_for(user, account)
    end
  end

  defp tenancy_v2_only? do
    Application.get_env(:meal_planner_api, :tenancy_v2_only, false)
  end

  defp load_active_membership(uuid) do
    case Repo.get(AccountMembership, uuid) do
      nil ->
        {:error, :membership_not_found}

      %AccountMembership{status: status} = _m when status != :active ->
        {:error, :membership_not_active}

      %AccountMembership{} = m ->
        {:ok, m}
    end
  end

  defp assert_owner(user_id, %AccountMembership{user_id: owner_id}) do
    if user_id == owner_id, do: :ok, else: {:error, :not_your_membership}
  end

  defp cast_uuid(value) when is_binary(value) do
    case Ecto.UUID.cast(value) do
      {:ok, uuid} -> {:ok, uuid}
      _ -> {:error, :membership_not_found}
    end
  end

  # One transaction that locks the invite row first: a concurrent accept of
  # the same token waits for this one and then sees a used invite, and a
  # failed membership update also undoes the stub claim.
  defp accept_invite_with_lookup(plaintext, resolve_user) when is_binary(plaintext) do
    hash = InviteService.hash_token(plaintext)

    Repo.transaction(fn ->
      case accept_pending_invite(hash, resolve_user) do
        {:ok, result} -> result
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  # Must run inside a transaction, which the caller rolls back on an error.
  defp accept_pending_invite(hash, resolve_user) do
    with {:ok, membership} <- lock_invited_membership(hash) do
      activate_membership(membership, resolve_user)
    end
  end

  defp lock_invited_membership(hash) do
    hash |> invited_membership_query() |> lock("FOR UPDATE") |> check_invited_membership(hash)
  end

  defp find_invited_membership(hash) do
    hash |> invited_membership_query() |> check_invited_membership(hash)
  end

  defp invited_membership_query(hash) do
    from(m in AccountMembership,
      where: m.invite_token_hash == ^hash,
      where: m.status == :invited,
      limit: 1
    )
  end

  defp check_invited_membership(query, hash) do
    case Repo.one(query) do
      nil ->
        # Could be :invite_token_used (replay) or :invite_token_unknown
        # (wrong plaintext) — distinguish by looking up by hash without
        # the :invited filter.
        if Repo.exists?(from(m in AccountMembership, where: m.invite_token_hash == ^hash)) do
          {:error, :invite_token_used}
        else
          {:error, :invite_token_unknown}
        end

      %AccountMembership{} = membership ->
        now = DateTime.utc_now()

        cond do
          is_nil(membership.invite_expires_at) ->
            {:error, :invite_token_used}

          DateTime.compare(membership.invite_expires_at, now) == :lt ->
            {:error, :invite_token_expired}

          true ->
            {:ok, membership}
        end
    end
  end

  defp activate_membership(membership, resolve_user) do
    with {:ok, stub_user} <- fetch_membership_user(membership),
         {:ok, invitee} <- resolve_user.(stub_user),
         {:ok, consumed} <-
           Repo.update(
             AccountMembership.changeset(membership, %{
               status: :active,
               joined_at: DateTime.utc_now(),
               user_id: invitee.id
             })
           ),
         {:ok, account} <- load_account(consumed.account_id) do
      consumed = Repo.preload(consumed, :account)

      {:ok,
       %{
         user: invitee,
         account: account,
         membership: consumed,
         claims: build_response_claims(invitee, account, consumed)
       }}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  # PR 3a task 3.4 fix: `resolve_user.()` must receive the actual stub
  # `%PersistenceUser{}` row created by
  # `InviteService.create_invite_row/2` (looked up by
  # `membership.user_id`), not a placeholder atom — the "new User"
  # arity's closure pattern-matches `%PersistenceUser{}` and always
  # raised `FunctionClauseError` before this fix.
  defp fetch_membership_user(%AccountMembership{user_id: user_id}) do
    case Repo.get(PersistenceUser, user_id) do
      %PersistenceUser{} = user -> {:ok, user}
      nil -> {:error, :invite_token_unknown}
    end
  end

  @doc """
  Loads an `Account` by its (string) id. Returns `{:error,
  :account_not_found}` for a malformed id or a missing row.

  Public (post-review fix pass item 5) so
  `MealPlannerApiWeb.Controllers.AccountScopeHelpers.load_account/1` can
  delegate here instead of duplicating the same
  `Ecto.UUID.cast/1` → `Repo.get/2` → error-tuple shape.
  """
  @spec load_account(String.t()) :: {:ok, Account.t()} | {:error, :account_not_found}
  def load_account(account_id) do
    case Ecto.UUID.cast(account_id) do
      {:ok, uuid} ->
        case Repo.get(Account, uuid) do
          %Account{} = account -> {:ok, account}
          nil -> {:error, :account_not_found}
        end

      _ ->
        {:error, :account_not_found}
    end
  end

  @doc """
  Lists the membership roster for an Account, ordered owner-first then
  by `joined_at ASC`. Preloads `:user` for the controller layer to
  render `email`, `name`, etc.

  Per `specs/invite-and-accept.md` §"Membership roster" the response
  MUST include `:active` and `:invited` rows; `:suspended` is excluded
  in practice (no API path mints a `:suspended` row in Phase A — that
  status is reserved for the future re-invitation flow).

  Owner-first is achieved by a `CASE` over the role enum (`:owner <
  :member` alphabetically is the opposite of what the spec wants).
  """
  @spec list_memberships(Account.t()) :: [AccountMembership.t()]
  def list_memberships(%Account{} = account) do
    query =
      from(m in AccountMembership,
        where: m.account_id == ^account.id,
        where: m.status in [:active, :invited],
        order_by: [
          asc: fragment("CASE WHEN ? = 'owner' THEN 0 ELSE 1 END", m.role),
          asc: m.joined_at,
          asc: m.inserted_at
        ],
        preload: [:user]
      )

    Repo.all(query)
  end

  @doc """
  Hard-deletes a `:member` membership. Owner-only. Refuses the owner
  with `:cannot_remove_owner` (decision 5.7). Refuses unknown
  `user_id` with `:membership_not_found`.

  The seat cap is checked by `invite/3` on the next re-invitation —
  per spec `account-membership.md` §"Seat cap per Account.plan",
  reactivation re-checks the cap.
  """
  @spec remove_member(Account.t(), Ecto.UUID.t() | binary(), AccountMembership.t()) ::
          :ok | {:error, :not_owner | :cannot_remove_owner | :membership_not_found}
  def remove_member(
        %Account{} = account,
        target_user_id,
        %AccountMembership{role: :owner} = actor
      )
      when is_binary(target_user_id) do
    if actor.user_id == target_user_id do
      {:error, :cannot_remove_owner}
    else
      case Repo.get_by(AccountMembership, account_id: account.id, user_id: target_user_id) do
        nil ->
          {:error, :membership_not_found}

        %AccountMembership{id: id} ->
          delete_membership_row(id)
      end
    end
  end

  def remove_member(_account, _target_user_id, _actor), do: {:error, :not_owner}

  defp delete_membership_row(id) do
    case Repo.delete_all(from(m in AccountMembership, where: m.id == ^id)) do
      {1, _} -> :ok
      _ -> {:error, :membership_not_found}
    end
  end

  @doc """
  Self-removal for a `:member`. Owners cannot leave — return
  `:cannot_leave_owned_account` (decision 5.7). Account transfer /
  dissolve flows are deferred to a follow-up change.

  Order of checks: first verify the actor has a row on THIS Account
  (else `:not_a_member`); then verify the role is `:member` (else
  `:cannot_leave_owned_account`). This ordering prevents a User who
  is the owner of a *different* Account from triggering
  `:cannot_leave_owned_account` against an Account they don't belong
  to — they should get `:not_a_member` instead.

  Looks the row up by `user_id` + `account_id`, NOT by `actor.id`.
  Historical note: before the legacy-membership-synthesis BLOCKER fix
  (see `LoadCurrentMembership.load_real_legacy_membership/2`), `actor`
  for `access` (v1) token holders could be an in-memory
  **synthesized** struct (`__synthesized__: true`, `id: nil`) that was
  never a real row — an `id`-based lookup would have returned `nil` for
  every legacy User, permanently broken. The synthesized struct did
  carry the real `user_id`, which is what both a synthesized and a real
  membership have in common. Since that fix, `LoadCurrentMembership`
  and `LoadCurrentMembershipSocket` always resolve `access` tokens to a
  real `AccountMembership` row (or refuse the request), but this
  function still looks up by `user_id` + `account_id` rather than
  `actor.id` for defense in depth.
  """
  @spec leave(Account.t(), AccountMembership.t()) ::
          :ok | {:error, :cannot_leave_owned_account | :not_a_member}
  def leave(%Account{} = account, %AccountMembership{} = actor) do
    case Repo.get_by(AccountMembership, user_id: actor.user_id, account_id: account.id) do
      nil ->
        {:error, :not_a_member}

      %AccountMembership{role: :owner} ->
        {:error, :cannot_leave_owned_account}

      %AccountMembership{role: :member, id: id} ->
        case Repo.delete_all(from(m in AccountMembership, where: m.id == ^id)) do
          {1, _} -> :ok
          _ -> {:error, :not_a_member}
        end
    end
  end

  # Per proposal §"Risks" (seat-cap race), we hold a row-level lock on
  # the Account during the seat-cap check + invite insert. The lock is
  # released when the transaction commits.
  defp lock_account_for_invite(%Account{id: account_id}) do
    case Ecto.UUID.cast(account_id) do
      {:ok, uuid} ->
        query =
          from(a in Account,
            where: a.id == ^uuid,
            lock: "FOR UPDATE"
          )

        case Repo.one(query) do
          %Account{} -> :ok
          _ -> {:error, :account_not_found}
        end

      _ ->
        {:error, :account_not_found}
    end
  end

  defp check_existing_membership(%Account{id: account_id}, email) do
    email = UserEmail.normalize(email)

    query =
      from(m in AccountMembership,
        join: u in PersistenceUser,
        on: u.id == m.user_id,
        where: m.account_id == ^account_id and fragment("lower(?)", u.email) == ^email,
        where: m.status in [:invited, :active],
        limit: 1,
        select: m.status
      )

    case Repo.one(query) do
      nil -> :ok
      :invited -> {:error, :already_invited}
      :active -> {:error, :already_a_member}
    end
  end

  # Look up the Account.plan on the membership if `:account` is preloaded;
  # otherwise fetch it from the DB. Avoids an N+1 when callers already
  # preloaded, while still working for callers that did not.
  defp membership_plan(%AccountMembership{account: %Account{plan: plan}}),
    do: plan

  defp membership_plan(%AccountMembership{account_id: account_id}) do
    case Ecto.UUID.cast(account_id) do
      {:ok, uuid} ->
        case Repo.get(Account, uuid) do
          %Account{plan: plan} -> plan
          _ -> :individual
        end

      _ ->
        :individual
    end
  end
end
