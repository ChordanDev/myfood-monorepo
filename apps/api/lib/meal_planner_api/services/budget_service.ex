defmodule MealPlannerApi.Services.BudgetService do
  @moduledoc """
  Budget resolution service.

  The Budget belongs to the Account: every member shares its Budget and its
  tier, whoever plans (#328). There is one resolution, keyed by the Account,
  used by the planning chat, inventory and AI callers (`resolve/1`) and by a
  Generation run's Optimizer payload (`weekly_limit_cents/1`).

  An Account `default_budget_cents` of 0 means "not set": the default of the
  Account's tier applies instead (#212).

  ## Weekly Budget setting (#271)

  Every member reads the Account's weekly Budget with `weekly_budget/1`;
  only the owner changes it with `update_weekly_budget/2`. A Budget the owner
  sets is a whole number of cents at or above the minimum: the config value
  `:min_weekly_budget_per_person_cents` times the owner's Household size
  (one person when the owner has not set it).
  """

  alias MealPlannerApi.Budgets.Budget
  alias MealPlannerApi.Data.AccountRepo
  alias MealPlannerApi.Persistence.Accounts

  @currency "ARS"

  @typedoc "The Account's weekly Budget as the settings screen reads it."
  @type weekly_budget :: %{
          weekly_budget_cents: pos_integer(),
          is_default: boolean(),
          min_weekly_budget_cents: non_neg_integer(),
          currency: String.t()
        }

  @doc """
  The weekly Budget of the Account with `account_id`: the value
  `weekly_limit_cents/1` resolves, whether it is the tier default because
  the Account never set one, and the minimum the owner may set.
  """
  @spec weekly_budget(term()) :: {:ok, weekly_budget()} | {:error, :account_not_found}
  def weekly_budget(account_id) do
    case get_account(account_id) do
      nil -> {:error, :account_not_found}
      account -> {:ok, weekly_budget_of(account)}
    end
  end

  @doc """
  Sets the weekly Budget of the membership's Account to `cents`.

  Only an owner membership may change it (`:not_owner` otherwise, checked
  before the amount). `cents` must be an integer above 0, at or above
  `min_weekly_budget_cents/1` and within the column range
  (`:invalid_amount` otherwise). Nothing is stored on an error.
  """
  @spec update_weekly_budget(map(), term()) ::
          {:ok, weekly_budget()} | {:error, :not_owner | :invalid_amount | :account_not_found}
  def update_weekly_budget(%{role: :owner, account_id: account_id}, cents) do
    with :ok <- check_amount(account_id, cents),
         {:ok, account} <- store_budget(account_id, cents) do
      {:ok, weekly_budget_of(account)}
    end
  end

  def update_weekly_budget(_membership, _cents), do: {:error, :not_owner}

  @doc """
  The least weekly Budget the owner may set: the per-person minimum
  (`:min_weekly_budget_per_person_cents`, 0 by default) times the owner's
  Household size, counted as one person when it is not set.
  """
  @spec min_weekly_budget_cents(Ecto.UUID.t()) :: non_neg_integer()
  def min_weekly_budget_cents(account_id) do
    per_person = Application.get_env(:meal_planner_api, :min_weekly_budget_per_person_cents, 0)
    per_person * (Accounts.owner_household_size(account_id) || 1)
  end

  defp weekly_budget_of(account) do
    %{
      weekly_budget_cents: weekly_limit_cents(account.id),
      is_default: not stored_budget?(account),
      min_weekly_budget_cents: min_weekly_budget_cents(account.id),
      currency: @currency
    }
  end

  defp stored_budget?(%{default_budget_cents: cents}), do: is_integer(cents) and cents > 0

  # A JSON string or float would be cast to an integer by the changeset, so
  # only an integer gets that far. 0 is refused here because the changeset
  # does not validate an unchanged value, and an Account not set stores 0.
  defp check_amount(account_id, cents) when is_integer(cents) and cents > 0 do
    if cents >= min_weekly_budget_cents(account_id), do: :ok, else: {:error, :invalid_amount}
  end

  defp check_amount(_account_id, _cents), do: {:error, :invalid_amount}

  defp store_budget(account_id, cents) do
    case Accounts.update_account_budget(account_id, cents) do
      {:ok, account} -> {:ok, account}
      {:error, :account_not_found} -> {:error, :account_not_found}
      {:error, %Ecto.Changeset{}} -> {:error, :invalid_amount}
    end
  end

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
      currency: Map.get(user, :currency, @currency)
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
