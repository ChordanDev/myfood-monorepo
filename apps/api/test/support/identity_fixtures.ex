defmodule MealPlannerApi.IdentityFixtures do
  @moduledoc """
  A User who owns one Account, for tests that only need somebody to act
  as.

  Built on `MealPlannerApi.FactoryHelpers.user_with_memberships/2`. The
  User is the Account's `:owner`, holds its `:active` Membership and has
  `users.account_id` pointing at the Account, which is how
  `MealPlannerApi.Accounts.register_with_verified_email/2` writes a User.
  """

  alias MealPlannerApi.Accounts
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.FactoryHelpers
  alias MealPlannerApi.Persistence.Accounts.Account, as: PersistenceAccount
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Repo

  @type identity :: %{user: PersistenceUser.t(), account: PersistenceAccount.t()}

  @doc """
  Inserts the User, the Account and the Membership.

  Options:

    * `:plan` — the Account's plan (default `:individual`).
    * `:email` — the User's email (default: a unique address).
    * `:name` — the User's name (default `"MyFood User"`).
    * `:account_name` — the Account's name (default: the User's name).

  The subscription Plan rows must exist, as for every factory helper
  (`MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!/0`).
  """
  @spec insert_identity!(keyword()) :: identity()
  def insert_identity!(opts \\ []) do
    name = Keyword.get(opts, :name, "MyFood User")

    user =
      FactoryHelpers.user_with_memberships(
        %{
          email: Keyword.get(opts, :email, "#{Ecto.UUID.generate()}@myfood.local"),
          name: name,
          role: :owner
        },
        [
          {%{
             plan: Keyword.get(opts, :plan, :individual),
             name: Keyword.get(opts, :account_name, name)
           }, :owner}
        ]
      )

    [membership] = user.memberships

    user =
      user
      |> PersistenceUser.changeset(%{account_id: membership.account_id})
      |> Repo.update!()

    %{user: user, account: membership.account}
  end

  @doc """
  Mints a legacy `typ: "access"` token for `user` on `account`, with the
  claims of `MealPlannerApi.Accounts.claims_for/2`. `subscription_tier`
  is the tier the token claims.
  """
  @spec legacy_access_token(PersistenceUser.t(), PersistenceAccount.t(), :free | :premium) ::
          String.t()
  def legacy_access_token(user, account, subscription_tier \\ :free) do
    claims =
      user
      |> Map.put(:subscription_tier, subscription_tier)
      |> Accounts.claims_for(account)

    {:ok, token, _claims} = Guardian.encode_and_sign(user, claims, token_type: "access")

    token
  end

  @doc """
  `insert_identity!/1` plus the legacy access token of that User. Takes
  the same options and `:subscription_tier` (default `:free`).
  """
  @spec insert_identity_with_token!(keyword()) :: %{
          user: PersistenceUser.t(),
          account: PersistenceAccount.t(),
          token: String.t()
        }
  def insert_identity_with_token!(opts \\ []) do
    {subscription_tier, opts} = Keyword.pop(opts, :subscription_tier, :free)
    %{user: user, account: account} = identity = insert_identity!(opts)

    Map.put(identity, :token, legacy_access_token(user, account, subscription_tier))
  end
end
