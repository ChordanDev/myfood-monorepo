defmodule MealPlannerApi.Accounts do
  @moduledoc """
  Accounts context implementing individual vs group business rules.

  Phase A — Tenancy Refactor (PR 1) swapped the legacy `:account_type`
  taxonomy (`:individual | :group`) for the canonical `Account.plan`
  enum (`:individual | :family_4 | :family_6 | :trial`). The legacy
  `account_type` field is gone from the `Account` schema and from
  `Accounts.claims_for/2`'s output keys; the JWT still carries
  `"account_type"` for backwards compatibility (derived from plan:
  `:individual` → "individual", everything else → "group") so existing
  consumers continue to work without an app release.
  """

  require Logger

  alias Ecto.Multi
  alias MealPlannerApi.AccountAccess
  alias MealPlannerApi.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.Account, as: PersistenceAccount
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Persistence.Accounts.UserEmail
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Subscriptions

  @doc """
  Registers the person who proved they own `email` (already normalized)
  with an email code: a User without a password, their individual
  Account, the owner Membership and the Trial, which starts at `now`.

  The User and the Account are named after the email's local part until
  onboarding asks for a real name. Both Trial columns are written, so a
  later provider event finds a Trial already started and leaves it alone.

  Returns `{:error, :email_already_registered}` when a User has the email,
  in any case, whether it is found up front or by the unique
  `users_lower_email_index` on `lower(email)`.
  A failure leaves nothing behind; inside a caller's transaction it also
  leaves that transaction unusable, so the caller must roll it back.
  """
  @spec register_with_verified_email(String.t(), DateTime.t()) ::
          {:ok,
           %{
             user: PersistenceUser.t(),
             account: PersistenceAccount.t(),
             membership: AccountMembership.t()
           }}
          | {:error, :email_already_registered | :unable_to_issue_identity}
  def register_with_verified_email(email, %DateTime{} = now \\ DateTime.utc_now())
      when is_binary(email) do
    with nil <- UserEmail.get_user(email),
         {:ok, subscription_plan_id} <- Subscriptions.ensure_default_plan_id(:individual) do
      [name | _] = String.split(email, "@", parts: 2)
      trial = AccountAccess.trial_window(now)

      account_attrs = %{
        name: name,
        plan: :individual,
        default_budget_cents: 0,
        subscription_plan_id: subscription_plan_id,
        trial_started_at: trial.started_at,
        trial_ends_at: trial.ends_at
      }

      user_attrs = %{email: email, name: name, role: :owner}

      case account_attrs |> account_and_owner_multi(user_attrs, now) |> Repo.transaction() do
        {:ok, %{account: account, user: user, membership: membership}} ->
          {:ok, %{account: account, user: user, membership: %{membership | account: account}}}

        {:error, step, reason, _changes} ->
          verified_email_registration_error(step, reason)
      end
    else
      %PersistenceUser{} -> {:error, :email_already_registered}
      _ -> {:error, :unable_to_issue_identity}
    end
  end

  # Only the changeset's errors are logged: its changes carry the email.
  defp verified_email_registration_error(:user, %Ecto.Changeset{errors: errors}) do
    if Enum.any?(errors, &match?({:email, {_message, [{:constraint, :unique} | _]}}, &1)) do
      {:error, :email_already_registered}
    else
      Logger.error("email registration failed at step=:user changeset_errors=#{inspect(errors)}")
      {:error, :unable_to_issue_identity}
    end
  end

  defp verified_email_registration_error(step, _reason) do
    Logger.error("email registration failed at step=#{inspect(step)}")
    {:error, :unable_to_issue_identity}
  end

  @spec link_user(Account.t(), String.t()) ::
          {:ok, Account.t()} | {:error, :individual_limit_reached}
  def link_user(%Account{type: :group} = account, user_id) when is_binary(user_id) do
    {:ok, %{account | linked_user_ids: Enum.uniq([user_id | account.linked_user_ids])}}
  end

  def link_user(%Account{type: :individual} = account, user_id) when is_binary(user_id) do
    if can_link_user?(account) do
      {:ok, %{account | linked_user_ids: [user_id]}}
    else
      {:error, :individual_limit_reached}
    end
  end

  @spec can_link_user?(Account.t()) :: boolean()
  def can_link_user?(%Account{type: :group}), do: true
  def can_link_user?(%Account{type: :individual, linked_user_ids: linked}), do: linked == []

  @doc """
  Returns the seat usage for an Account-shaped DTO. In Phase A this is a
  placeholder (the canonical implementation lives in
  `MealPlannerApi.AccountsMembership.seat_usage/1` per design §6.2 / §10
  Q10 — landed in PR 2). The function exists here so callers can compile
  during the dual-write window.
  """
  @spec seat_usage(map()) :: %{
          active: non_neg_integer(),
          invited: non_neg_integer(),
          capacity: pos_integer()
        }
  def seat_usage(%{plan: plan}) when is_atom(plan) do
    %{active: 0, invited: 0, capacity: max_users_for_plan(plan)}
  end

  def seat_usage(_), do: %{active: 0, invited: 0, capacity: 1}

  @doc """
  Builds the legacy `access_v1` JWT claim map for the given user/account
  pair.

  Deliberately does NOT set a `"typ"` key. `Guardian.encode_and_sign/3`'s
  `token_type:` option only controls the minted `typ` claim when the
  claims map passed in has no (non-nil) `"typ"` key already — Guardian's
  `set_type/3` skips overriding an existing one. The minting call
  (`AccountScopeHelpers.mint_token_pair/2`) passes `token_type: "access"`
  or `token_type: "refresh"` explicitly; hardcoding `"typ" => "access"`
  here used to force every refresh token to carry `typ: "access"`, letting
  refresh tokens pass as access tokens anywhere behind `VerifyTokenType`.
  """
  @spec claims_for(map(), map()) :: map()
  def claims_for(user, account) when is_map(user) and is_map(account) do
    legacy_account_type = legacy_account_type_from_plan(plan_from(account))
    subscription_tier = subscription_tier_from(user)

    %{
      "account_id" => account.id,
      "account_type" => legacy_account_type,
      "subscription_tier" => Atom.to_string(subscription_tier),
      "email" => user.email,
      "name" => user.name,
      "linked_user_ids" => Map.get(account, :linked_user_ids, [])
    }
  end

  @spec serialize_user(map()) :: map()
  def serialize_user(user) when is_map(user) do
    %{
      id: to_string(user.id),
      account_id: to_string(Map.get(user, :account_id)),
      email: user.email,
      name: user.name,
      avatar_url: Map.get(user, :avatar_url),
      plan: Map.get(user, :plan, :individual),
      subscription_tier: subscription_tier_from(user)
    }
  end

  @spec serialize_account(map()) :: map()
  def serialize_account(account) when is_map(account) do
    plan = plan_from(account)

    %{
      id: account.id,
      plan: plan,
      owner_id: Map.get(account, :owner_id),
      subscription_tier: subscription_tier_from(account),
      linked_user_ids: Map.get(account, :linked_user_ids, []),
      max_linked_users: max_users_for_plan(plan)
    }
  end

  # ---- private helpers -------------------------------------------------------

  # An Account, the User who owns it and the owner's active Membership,
  # inserted together.
  defp account_and_owner_multi(account_attrs, user_attrs, joined_at) do
    Multi.new()
    |> Multi.insert(
      :account,
      PersistenceAccount.changeset(%PersistenceAccount{}, account_attrs)
    )
    |> Multi.insert(:user, fn %{account: account} ->
      attrs = Map.put(user_attrs, :account_id, account.id)
      PersistenceUser.changeset(%PersistenceUser{}, attrs)
    end)
    |> Multi.insert(:membership, fn %{account: account, user: user} ->
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account.id,
        user_id: user.id,
        role: :owner,
        status: :active,
        joined_at: joined_at
      })
    end)
  end

  defp plan_from(account) when is_map(account) do
    case Map.get(account, :plan) do
      nil -> :individual
      plan when is_atom(plan) -> plan
      plan when is_binary(plan) -> String.to_existing_atom(plan)
    end
  end

  defp legacy_account_type_from_plan(:individual), do: "individual"
  defp legacy_account_type_from_plan(_), do: "group"

  defp max_users_for_plan(:individual), do: 1
  defp max_users_for_plan(:family_4), do: 4
  defp max_users_for_plan(:family_6), do: 6
  defp max_users_for_plan(:trial), do: 6
  defp max_users_for_plan(_), do: 1

  defp subscription_tier_from(entity) do
    Map.get(entity, :subscription_tier, :free)
  end
end
