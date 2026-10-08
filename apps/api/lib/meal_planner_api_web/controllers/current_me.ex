defmodule MealPlannerApiWeb.CurrentMe do
  @moduledoc """
  Single serializer for the mobile `CurrentMe` payload (issue #1):

      user:       { id, email, displayName, householdSize, cookingSkill }
      account:    { id, type, trialEndsAt, subscriptionStatus, access: { canUseApp, reason } }
      membership: { role }
      onboarding: { isComplete }

  `GET /api/me` returns it as the whole body and the mobile auth verify
  responses embed it as `me`, so both are built here and nowhere else. The
  field names mirror `apps/mobile/src/features/auth/types/auth.ts`.

  Access is decided by `MealPlannerApi.AccountAccess.status/2` over persisted
  state only; JWT claims are never consulted.
  """

  alias MealPlannerApi.AccountAccess
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo

  @type user_json :: %{
          id: Ecto.UUID.t(),
          email: String.t(),
          displayName: String.t() | nil,
          householdSize: pos_integer() | nil,
          cookingSkill: String.t() | nil
        }

  @type t :: %{
          user: user_json(),
          account: %{
            id: Ecto.UUID.t(),
            type: String.t(),
            trialEndsAt: String.t() | nil,
            subscriptionStatus: String.t(),
            access: %{canUseApp: boolean(), reason: String.t() | nil}
          },
          membership: %{role: String.t()},
          onboarding: %{isComplete: boolean()}
        }

  @doc """
  Loads the membership's Account with the entitlements the access decision
  needs and builds the payload. Returns `{:error, :account_not_found}` when
  the Account no longer exists.
  """
  @spec load(User.t(), AccountMembership.t(), DateTime.t()) ::
          {:ok, t()} | {:error, :account_not_found}
  def load(
        user,
        %AccountMembership{account_id: account_id} = membership,
        now \\ DateTime.utc_now()
      ) do
    case Repo.get(Account, account_id) do
      %Account{} = account ->
        account = Repo.preload(account, :revenuecat_entitlements)
        {:ok, build(user, account, membership, now)}

      nil ->
        {:error, :account_not_found}
    end
  end

  @doc """
  Pure builder. `account` must have `revenuecat_entitlements` preloaded.
  """
  @spec build(User.t(), Account.t(), AccountMembership.t(), DateTime.t()) :: t()
  def build(user, %Account{} = account, membership, %DateTime{} = now) do
    %{
      user: user_json(user),
      account: account(account, now),
      membership: %{role: Atom.to_string(membership.role)},
      onboarding: %{isComplete: not is_nil(user.onboarding_completed_at)}
    }
  end

  @doc """
  The `user` object of the payload, for responses that return it on its own.
  Household size and Cooking skill are `nil` until the User saves a profile;
  mobile reads null as "not set".
  """
  @spec user_json(User.t()) :: user_json()
  def user_json(user) do
    %{
      id: user.id,
      email: user.email,
      displayName: user.name,
      householdSize: user.household_size,
      cookingSkill: user.cooking_skill
    }
  end

  defp account(%Account{} = account, now) do
    {can_use_app, subscription_status, reason} =
      account |> AccountAccess.status(now) |> Map.fetch!(:state) |> access()

    %{
      id: account.id,
      type: account_type(account.plan),
      trialEndsAt: iso8601(account.trial_ends_at),
      subscriptionStatus: subscription_status,
      access: %{canUseApp: can_use_app, reason: reason}
    }
  end

  defp account_type(plan) when plan in [:individual, :trial], do: "individual"
  defp account_type(:family_4), do: "family"
  defp account_type(:family_6), do: "family_plus"

  defp access(:trial), do: {true, "none", nil}
  defp access(:active), do: {true, "active", nil}
  defp access(:expired), do: {false, "none", "trial_expired"}

  defp iso8601(nil), do: nil
  defp iso8601(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
end
