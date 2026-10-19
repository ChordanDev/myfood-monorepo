defmodule MealPlannerApi.Services.BudgetService do
  @moduledoc """
  Budget resolution service.

  The Budget belongs to the Account: every member shares its Budget and its
  tier, whoever plans (#328). There is one resolution, keyed by the Account,
  used by the planning chat, inventory and AI callers (`resolve/1`) and by a
  Generation run's Optimizer payload (`weekly_limit_cents/1`).

  An Account `default_budget_cents` of 0 means "not set": the default of the
  Account's tier applies instead (#212).
  """

  alias MealPlannerApi.Budgets.Budget
  alias MealPlannerApi.Data.AccountRepo

  @doc """
  The Budget of the Account the User is scoped to. Nothing on the User
  changes the limit: not its tier and not a weekly Budget it carries.
  """
  @spec resolve(map()) :: Budget.t()
  def resolve(user) do
    account_id = Map.get(user, :account_id)

    %Budget{
      account_id: account_id,
      weekly_limit_cents: weekly_limit_cents(account_id),
      currency: Map.get(user, :currency, "ARS")
    }
  end

  @doc """
  Weekly limit in cents for an Account: its `default_budget_cents` when above 0,
  otherwise the default of the Account's tier. No tier is persisted yet, so
  every Account resolves the `:free` default.
  """
  @spec weekly_limit_cents(term()) :: pos_integer()
  def weekly_limit_cents(account_id) do
    case get_account(account_id) do
      %{default_budget_cents: cents} when is_integer(cents) and cents > 0 -> cents
      account -> tier_default_limit(account_tier(account))
    end
  end

  @spec within_limit?(Budget.t(), non_neg_integer()) :: boolean()
  def within_limit?(%Budget{weekly_limit_cents: limit}, estimated_cents)
      when is_integer(estimated_cents) and estimated_cents >= 0 do
    estimated_cents <= limit
  end

  @spec serialize(Budget.t()) :: map()
  def serialize(%Budget{} = budget) do
    %{
      account_id: budget.account_id,
      weekly_limit_cents: budget.weekly_limit_cents,
      currency: budget.currency
    }
  end

  defp get_account(account_id) when is_binary(account_id) do
    case Ecto.UUID.cast(account_id) do
      {:ok, _} -> AccountRepo.get_account(account_id)
      :error -> nil
    end
  end

  defp get_account(_account_id), do: nil

  defp account_tier(nil), do: :free
  defp account_tier(account), do: Map.get(account, :subscription_tier) || :free

  defp tier_default_limit(:premium), do: 85_000
  defp tier_default_limit("premium"), do: 85_000
  defp tier_default_limit(_), do: 45_000
end
