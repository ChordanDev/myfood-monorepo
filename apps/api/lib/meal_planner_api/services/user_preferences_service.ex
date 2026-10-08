defmodule MealPlannerApi.Services.UserPreferencesService do
  @moduledoc """
  User preferences as the mobile app reads them (issue #18): the Diet, the
  Hard restrictions and the Soft preferences of one User, behind
  `GET /api/me/preferences`.

  The three live in different tables: the Diet in the dietary profile, the
  Hard restrictions in their own rows and the Soft preferences on the
  preferences row. A User with none of them stored still has preferences,
  the empty ones.

  The macro goal, the protein target and the default exclusions sit in the
  same tables and are not part of this view.
  """

  alias MealPlannerApi.Data.{AccountRepo, UserHardRestrictionRepo, UserPreferenceRepo}
  alias MealPlannerApi.Persistence.Accounts.UserHardRestriction

  @type preferences :: %{
          diet: String.t() | nil,
          hard_restrictions: [String.t()],
          soft_preferences: [String.t()]
        }

  # The Diets the mobile app knows. The dietary profile can also hold
  # `celiac`, which the app cannot show.
  @diet_codes ~w(omnivore vegetarian vegan pescatarian)

  @doc "The Diet codes of the mobile app."
  @spec diet_codes() :: [String.t()]
  def diet_codes, do: @diet_codes

  @doc """
  Returns the preferences of a User.

  `diet` is `nil` when no Diet is stored and when the stored one is not a
  mobile Diet code. `hard_restrictions` follows the catalog order of
  `UserHardRestriction.codes/0`; `soft_preferences` keeps the stored order.
  """
  @spec get(Ecto.UUID.t()) :: preferences()
  def get(user_id) do
    %{
      diet: diet(AccountRepo.get_dietary_profile(user_id)),
      hard_restrictions: hard_restrictions(UserHardRestrictionRepo.list_codes(user_id)),
      soft_preferences: soft_preferences(UserPreferenceRepo.get(user_id))
    }
  end

  defp diet(nil), do: nil
  defp diet(%{diet_type: nil}), do: nil

  defp diet(%{diet_type: diet_type}) do
    code = Atom.to_string(diet_type)

    if code in @diet_codes, do: code
  end

  defp hard_restrictions(stored_codes) do
    Enum.filter(UserHardRestriction.codes(), &(&1 in stored_codes))
  end

  defp soft_preferences(nil), do: []
  defp soft_preferences(%{soft_preferences: soft_preferences}), do: soft_preferences
end
