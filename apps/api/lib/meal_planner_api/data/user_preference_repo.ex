defmodule MealPlannerApi.Data.UserPreferenceRepo do
  @moduledoc """
  Pure data access for user_preferences.

  No business logic. The row of a User is created by the first save of
  their Soft preferences.
  """

  alias MealPlannerApi.Persistence.Accounts.UserPreference
  alias MealPlannerApi.Repo

  @spec get(Ecto.UUID.t()) :: UserPreference.t() | nil
  def get(user_id) do
    Repo.get_by(UserPreference, user_id: user_id)
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
end
