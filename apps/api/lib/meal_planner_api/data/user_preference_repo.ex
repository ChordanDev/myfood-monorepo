defmodule MealPlannerApi.Data.UserPreferenceRepo do
  @moduledoc """
  Pure data access for user_preferences.

  No business logic. Creates on first access (upsert pattern).
  """

  alias MealPlannerApi.Repo
  alias MealPlannerApi.Persistence.Accounts.UserPreference

  @spec get(Ecto.UUID.t()) :: UserPreference.t() | nil
  def get(user_id) do
    Repo.get_by(UserPreference, user_id: user_id)
  end

  @spec get!(Ecto.UUID.t()) :: UserPreference.t()
  def get!(user_id) do
    Repo.get_by!(UserPreference, user_id: user_id)
  end

  @spec upsert(Ecto.UUID.t(), map()) :: {:ok, UserPreference.t()} | {:error, Ecto.Changeset.t()}
  def upsert(user_id, attrs) when is_map(attrs) do
    case Repo.get_by(UserPreference, user_id: user_id) do
      nil ->
        %UserPreference{user_id: user_id}
        |> UserPreference.changeset(attrs)
        |> Repo.insert()

      existing ->
        existing
        |> UserPreference.changeset(attrs)
        |> Repo.update()
    end
  end

  @doc """
  Stores the Soft preferences of a User and nothing else of the row,
  creating it when it is missing.
  """
  @spec put_soft_preferences(Ecto.UUID.t(), [String.t()]) ::
          {:ok, UserPreference.t()} | {:error, Ecto.Changeset.t()}
  def put_soft_preferences(user_id, soft_preferences) when is_list(soft_preferences) do
    preference =
      Repo.get_by(UserPreference, user_id: user_id) || %UserPreference{user_id: user_id}

    preference
    |> UserPreference.soft_preferences_changeset(%{soft_preferences: soft_preferences})
    |> Repo.insert_or_update()
  end

  @spec delete(Ecto.UUID.t()) :: {:ok, UserPreference.t()} | {:error, term()}
  def delete(user_id) do
    case Repo.get_by(UserPreference, user_id: user_id) do
      nil -> {:error, :not_found}
      pref -> Repo.delete(pref)
    end
  end
end
