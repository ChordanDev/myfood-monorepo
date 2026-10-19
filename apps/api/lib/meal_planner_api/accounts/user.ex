defmodule MealPlannerApi.Accounts.User do
  @moduledoc """
  User-shaped DTO used by auth and context boundaries.

  Persistent user records live in `MealPlannerApi.Persistence.Accounts.User`.
  """

  @type account_type :: :individual | :group

  @enforce_keys [:id, :account_id, :account_type]
  defstruct [:id, :account_id, :email, :name, :account_type]

  @type t :: %__MODULE__{
          id: String.t(),
          account_id: String.t(),
          email: String.t() | nil,
          name: String.t() | nil,
          account_type: account_type()
        }
end
