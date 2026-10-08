defmodule MealPlannerApi.Services.UserPreferencesService do
  @moduledoc """
  User preferences as the mobile app reads and saves them (issue #18): the
  Diet, the Hard restrictions and the Soft preferences of one User, behind
  `GET` and `PUT /api/me/preferences`.

  The three live in different tables: the Diet in the dietary profile, the
  Hard restrictions in their own rows and the Soft preferences on the
  preferences row. A User with none of them stored still has preferences,
  the empty ones.

  The macro goal, the protein target and the default exclusions sit in the
  same tables and are not part of this view: a save leaves them as they are.
  """

  alias Ecto.Multi
  alias MealPlannerApi.Data.{AccountRepo, UserHardRestrictionRepo, UserPreferenceRepo}
  alias MealPlannerApi.Persistence.Accounts.UserHardRestriction
  alias MealPlannerApi.Repo

  @type preferences :: %{
          diet: String.t() | nil,
          hard_restrictions: [String.t()],
          soft_preferences: [String.t()]
        }

  @type field :: :diet | :hard_restrictions | :soft_preferences

  @type rejection :: {:invalid_field, field()} | :invalid_diet | :invalid_hard_restriction

  # The Diets the mobile app knows. The dietary profile can also hold
  # `celiac`, which the app cannot show.
  @diet_codes ~w(omnivore vegetarian vegan pescatarian)

  # The limits of the Soft preferences, counted on the normalized list.
  @soft_preference_max_length 80
  # What the `varchar(255)[]` column holds for one entry. The limit above
  # counts characters as a User sees them, and one of those can be several
  # code points.
  @soft_preference_max_code_points 255
  @soft_preferences_max_count 20

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

  @doc """
  Validates the body of a save, with the snake_case keys `Plugs.MobileCasing`
  leaves in the params, and returns the preferences to store.

  The three keys are required. The fields are checked in the order `diet`,
  `hard_restrictions`, `soft_preferences`, and the first one that fails
  decides the answer:

    * `{:invalid_field, field}`: the key is missing or its value has the
      wrong type, or the Soft preferences are over their limits;
    * `:invalid_diet`: a string that is not a mobile Diet code, `celiac`
      included;
    * `:invalid_hard_restriction`: a string outside the catalog.

  Duplicated Hard restrictions collapse. Soft preferences are trimmed, the
  blank ones are dropped and exact duplicates collapse onto their first
  occurrence; the limits (#{@soft_preference_max_length} characters an entry,
  #{@soft_preferences_max_count} entries) apply to what is left. An entry the
  column cannot store is refused as well: one over
  #{@soft_preference_max_code_points} code points, or holding a NUL character.
  """
  @spec validate(map()) :: {:ok, preferences()} | {:error, rejection()}
  def validate(params) when is_map(params) do
    with {:ok, diet} <- validate_diet(params),
         {:ok, hard_restrictions} <- validate_hard_restrictions(params),
         {:ok, soft_preferences} <- validate_soft_preferences(params) do
      {:ok,
       %{diet: diet, hard_restrictions: hard_restrictions, soft_preferences: soft_preferences}}
    end
  end

  @doc """
  Replaces the preferences of a User with validated ones (see `validate/1`)
  and returns them as `get/1` reads them afterwards. Everything is written
  in one transaction, or nothing is.

    * Diet: a code is stored, creating the dietary profile when missing.
      `nil` clears the stored Diet, except a `celiac` one, which is left
      untouched: the app cannot show it and sends `nil` back with every
      other edit. `nil` creates no dietary profile.
    * Hard restrictions: the stored set becomes exactly the given one.
    * Soft preferences: stored as given, in the given order.
  """
  @spec replace(Ecto.UUID.t(), preferences()) :: {:ok, preferences()} | {:error, term()}
  def replace(user_id, %{
        diet: diet,
        hard_restrictions: hard_restrictions,
        soft_preferences: soft_preferences
      }) do
    Multi.new()
    # Two saves of one User wait for each other here: side by side, each
    # would delete the Hard restrictions it sees and both sets would stay.
    |> Multi.run(:user, fn _repo, _changes -> {:ok, AccountRepo.lock_user(user_id)} end)
    |> Multi.run(:diet, fn _repo, _changes -> replace_diet(user_id, diet) end)
    |> Multi.run(:hard_restrictions, fn _repo, _changes ->
      with :ok <- UserHardRestrictionRepo.replace_codes(user_id, hard_restrictions) do
        {:ok, hard_restrictions}
      end
    end)
    |> Multi.run(:soft_preferences, fn _repo, _changes ->
      UserPreferenceRepo.put_soft_preferences(user_id, soft_preferences)
    end)
    |> Multi.run(:preferences, fn _repo, _changes -> {:ok, get(user_id)} end)
    |> Repo.transaction()
    |> case do
      {:ok, %{preferences: preferences}} -> {:ok, preferences}
      {:error, _step, reason, _changes} -> {:error, reason}
    end
  end

  defp replace_diet(user_id, nil) do
    case AccountRepo.get_dietary_profile(user_id) do
      nil -> {:ok, nil}
      %{diet_type: :celiac} = profile -> {:ok, profile}
      _profile -> AccountRepo.put_diet(user_id, nil)
    end
  end

  defp replace_diet(user_id, diet), do: AccountRepo.put_diet(user_id, diet)

  defp validate_diet(params) do
    case Map.fetch(params, "diet") do
      {:ok, nil} -> {:ok, nil}
      {:ok, diet} when diet in @diet_codes -> {:ok, diet}
      {:ok, diet} when is_binary(diet) -> {:error, :invalid_diet}
      _missing_or_mistyped -> {:error, {:invalid_field, :diet}}
    end
  end

  defp validate_hard_restrictions(params) do
    case fetch_strings(params, "hard_restrictions") do
      {:ok, codes} ->
        if Enum.all?(codes, &(&1 in UserHardRestriction.codes())) do
          {:ok, Enum.uniq(codes)}
        else
          {:error, :invalid_hard_restriction}
        end

      :error ->
        {:error, {:invalid_field, :hard_restrictions}}
    end
  end

  defp validate_soft_preferences(params) do
    with {:ok, entries} <- fetch_strings(params, "soft_preferences"),
         normalized = normalize_soft_preferences(entries),
         true <- within_soft_preference_limits?(normalized) do
      {:ok, normalized}
    else
      _missing_mistyped_or_over_the_limits -> {:error, {:invalid_field, :soft_preferences}}
    end
  end

  defp fetch_strings(params, key) do
    case Map.fetch(params, key) do
      {:ok, values} when is_list(values) ->
        if Enum.all?(values, &is_binary/1), do: {:ok, values}, else: :error

      _missing_or_mistyped ->
        :error
    end
  end

  defp normalize_soft_preferences(entries) do
    entries
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp within_soft_preference_limits?(soft_preferences) do
    length(soft_preferences) <= @soft_preferences_max_count and
      Enum.all?(soft_preferences, &storable_soft_preference?/1)
  end

  # Postgres cannot store a NUL character in text, nor more code points
  # than the column allows, so such an entry is refused here instead of
  # failing inside the write.
  defp storable_soft_preference?(entry) do
    String.length(entry) <= @soft_preference_max_length and
      length(String.codepoints(entry)) <= @soft_preference_max_code_points and
      not String.contains?(entry, <<0>>)
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
