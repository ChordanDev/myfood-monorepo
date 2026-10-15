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

  @doc "The Hard restriction codes stored for any of `user_ids`, each once."
  @spec list_codes_for_users([Ecto.UUID.t()]) :: [String.t()]
  def list_codes_for_users([]), do: []

  def list_codes_for_users(user_ids) when is_list(user_ids) do
    from(r in UserHardRestriction,
      where: r.user_id in ^user_ids,
      select: r.code,
      distinct: true
    )
    |> Repo.all()
  end

  @doc """
  Makes the codes stored for a User exactly `codes`: the rows of the other
  codes are deleted and the missing ones inserted. A code already stored
  keeps its row.

  It is two steps, so it belongs inside a transaction. The first code that
  cannot be stored stops it with its changeset.
  """
  @spec replace_codes(Ecto.UUID.t(), [String.t()]) :: :ok | {:error, Ecto.Changeset.t()}
  def replace_codes(user_id, codes) when is_list(codes) do
    from(r in UserHardRestriction, where: r.user_id == ^user_id and r.code not in ^codes)
    |> Repo.delete_all()

    Enum.reduce_while(Enum.uniq(codes) -- list_codes(user_id), :ok, fn code, :ok ->
      %UserHardRestriction{}
      |> UserHardRestriction.changeset(%{user_id: user_id, code: code})
      |> Repo.insert()
      |> case do
        {:ok, _restriction} -> {:cont, :ok}
        {:error, changeset} -> {:halt, {:error, changeset}}
      end
    end)
  end
end
