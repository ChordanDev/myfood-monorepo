defmodule MealPlannerApi.Data.UserHardRestrictionRepo do
  @moduledoc """
  Pure data access for user_hard_restrictions.

  No business logic.
  """

  import Ecto.Query, warn: false

  alias MealPlannerApi.Persistence.Accounts.UserHardRestriction
  alias MealPlannerApi.Repo

  @doc "The Hard restriction codes stored for a User, in no particular order."
  @spec list_codes(Ecto.UUID.t()) :: [String.t()]
  def list_codes(user_id) do
    from(r in UserHardRestriction, where: r.user_id == ^user_id, select: r.code)
    |> Repo.all()
  end
end
