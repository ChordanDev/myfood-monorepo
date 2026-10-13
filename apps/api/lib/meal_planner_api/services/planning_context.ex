defmodule MealPlannerApi.Services.PlanningContext do
  @moduledoc """
  The Planning context (issue #29): what the engine is told about the User
  when a plan starts, next to the dates and the free-text request.

  It is one map of camelCase string keys, always complete:

    * `diet`, `hardRestrictionCodes` and `softPreferences`, as
      `MealPlannerApi.Services.UserPreferencesService.get/1` reads them. The
      Hard restriction codes travel as text only; nothing here filters on
      them;
    * `cookingSkill` and `householdSize` from the User row;
    * `slotCookingTimes`, with the four Meal slots. A slot with no stored time
      is `no_constraint`, a stored 0 minutes is `do_not_cook` and any other
      value is `limited` to those minutes. The snack is never stored, so it is
      always `no_constraint`;
    * `favoriteRecipeIds`, the Favorite recipes the member preselected.

  `diet`, `cookingSkill` and `householdSize` are `nil` until the User sets
  them. The context is a contract for the engine, not a payload the client
  receives: `apps/api/docs/CHANNELS.md` ("Planning context") documents it.

  `assemble/1` builds the map from signals already read; `read/3` loads them.
  """

  alias MealPlannerApi.Data.{AccountRepo, RecipeRepo}
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Services.UserPreferencesService

  # The Meal slots of a plan, in meal order.
  @slots [:breakfast, :lunch, :snack, :dinner]

  @type slot_time :: %{
          slot: atom(),
          cooking_time_minutes: non_neg_integer(),
          hunger_level: atom() | String.t()
        }

  @type signals :: %{
          preferences: UserPreferencesService.preferences(),
          user: User.t() | nil,
          slot_cooking_times: [slot_time()],
          favorite_recipe_ids: [String.t()]
        }

  @type t :: %{required(String.t()) => term()}

  @doc """
  Builds the context from signals already read. Pure: no query runs here.

  `user` supplies the Cooking skill and the Household size; `nil` stands for a
  User who cannot be found, and both are then `nil`. `slot_cooking_times` is
  what `AccountRepo.list_slot_cooking_times/1` returns, a set that can be
  empty or partial. `favorite_recipe_ids` is taken as given: see `read/3` for
  the ids a caller owns.
  """
  @spec assemble(signals()) :: t()
  def assemble(%{
        preferences: preferences,
        user: user,
        slot_cooking_times: slot_cooking_times,
        favorite_recipe_ids: favorite_recipe_ids
      }) do
    %{
      "diet" => preferences.diet,
      "hardRestrictionCodes" => preferences.hard_restrictions,
      "softPreferences" => preferences.soft_preferences,
      "cookingSkill" => user && user.cooking_skill,
      "householdSize" => user && user.household_size,
      "slotCookingTimes" => slot_cooking_times_map(slot_cooking_times),
      "favoriteRecipeIds" => favorite_recipe_ids
    }
  end

  @doc """
  Loads the signals of a User and returns their context.

  The profile is read here, not taken from the socket, whose User is a
  snapshot of connect time. `requested_favorite_ids` is what the client sent:
  only the ids that are favorites of this User inside this Account are kept,
  each once, in the client's order. An id the caller does not own is dropped,
  never forwarded, because a client cache can be stale and the engine must not
  receive a recipe the caller cannot see.
  """
  @spec read(Ecto.UUID.t(), Ecto.UUID.t(), [String.t()]) :: t()
  def read(account_id, user_id, requested_favorite_ids) do
    assemble(%{
      preferences: UserPreferencesService.get(user_id),
      user: AccountRepo.get_user(user_id),
      slot_cooking_times: AccountRepo.list_slot_cooking_times(user_id),
      favorite_recipe_ids: owned_favorites(account_id, user_id, requested_favorite_ids)
    })
  end

  defp owned_favorites(_account_id, _user_id, []), do: []

  defp owned_favorites(account_id, user_id, requested_ids) do
    owned =
      %{account_id: account_id, user_id: user_id}
      |> RecipeRepo.list_favorite_ids()
      |> MapSet.new(& &1.id)

    requested_ids
    |> Enum.uniq()
    |> Enum.filter(&MapSet.member?(owned, &1))
  end

  defp slot_cooking_times_map(rows) do
    # The snack is never stored. A row that names it is ignored so the
    # contract holds whatever the table gains.
    by_slot = Map.new(rows, &{&1.slot, &1})

    Map.new(@slots, fn
      :snack -> {"snack", no_constraint()}
      slot -> {Atom.to_string(slot), slot_time(Map.get(by_slot, slot))}
    end)
  end

  defp slot_time(nil), do: no_constraint()

  defp slot_time(%{cooking_time_minutes: 0} = row),
    do: slot_time(row, "do_not_cook")

  defp slot_time(row), do: slot_time(row, "limited")

  defp slot_time(row, cooking) do
    %{
      "cooking" => cooking,
      "maxMinutes" => row.cooking_time_minutes,
      "hungerLevel" => to_string(row.hunger_level)
    }
  end

  defp no_constraint,
    do: %{"cooking" => "no_constraint", "maxMinutes" => nil, "hungerLevel" => nil}
end
