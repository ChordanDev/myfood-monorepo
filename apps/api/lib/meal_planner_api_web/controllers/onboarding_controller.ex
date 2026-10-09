defmodule MealPlannerApiWeb.OnboardingController do
  @moduledoc """
  `POST /api/onboarding/complete` (issue #20): the User finishes Onboarding.

  The body carries four groups, all required, which `Plugs.MobileCasing`
  hands over in snake_case:

      profile:          { displayName, householdSize, cookingSkill }
      preferences:      { diet, hardRestrictions, softPreferences }
      slotCookingTimes: { breakfast, lunch, dinner }
      timezone:         IANA zone name the app detects on the device

  Every group is validated before anything is written, in the order above
  and then the timezone; the first offending field decides the answer, with
  the same codes and messages as the endpoint that edits that group on its
  own. A valid body is saved in one transaction by
  `OnboardingService.complete/3`.

  A success answers:

      { user: { id, displayName, householdSize, cookingSkill, onboardingCompletedAt },
        preferences, slotCookingTimes }

  Completing again replaces the data and keeps the first
  `onboardingCompletedAt`.
  """
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.{OnboardingService, UserPreferencesService}
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.SlotCookingTimesParams

  # User field and wire spelling of each profile field, in validation order.
  @profile_fields [
    name: "displayName",
    household_size: "householdSize",
    cooking_skill: "cookingSkill"
  ]

  # The preferences fields as the app spells them, to name one in an error.
  @preferences_fields %{
    diet: "diet",
    hard_restrictions: "hardRestrictions",
    soft_preferences: "softPreferences"
  }

  def complete(conn, params) do
    user = Guardian.Plug.current_resource(conn)
    account_id = conn.assigns.current_membership.account_id

    with {:ok, profile} <- validate_profile(params["profile"]),
         {:ok, preferences} <- validate_preferences(params["preferences"]),
         {:ok, times} <- validate_slot_cooking_times(params["slot_cooking_times"]),
         {:ok, timezone} <- validate_timezone(params["timezone"]),
         {:ok, saved} <-
           OnboardingService.complete(user.id, account_id, %{
             profile: profile,
             timezone: timezone,
             preferences: preferences,
             slot_cooking_times: times
           }) do
      json(conn, %{
        user: user_json(saved.user),
        preferences: saved.preferences,
        slotCookingTimes: SlotCookingTimesParams.render(saved.slot_cooking_times)
      })
    else
      {:error, reason} -> reject(conn, reason)
    end
  end

  defp user_json(user) do
    %{
      id: user.id,
      displayName: user.name,
      householdSize: user.household_size,
      cookingSkill: user.cooking_skill,
      onboardingCompletedAt: DateTime.to_iso8601(user.onboarding_completed_at)
    }
  end

  # A group that is not an object is as good as missing: its fields are all
  # absent, so the first one is the one refused.
  defp validate_profile(group) do
    group = if is_map(group) and not is_struct(group), do: group, else: %{}

    attrs = %{
      name: string(group["display_name"]),
      household_size: integer(group["household_size"]),
      cooking_skill: string(group["cooking_skill"])
    }

    case OnboardingService.validate_profile(attrs) do
      :ok -> {:ok, attrs}
      {:error, changeset} -> {:error, {:profile, first_invalid(changeset), attrs}}
    end
  end

  defp validate_preferences(group) when is_map(group) and not is_struct(group),
    do: UserPreferencesService.validate(group)

  defp validate_preferences(_not_an_object), do: UserPreferencesService.validate(%{})

  defp validate_slot_cooking_times(group), do: SlotCookingTimesParams.validate(group)

  defp validate_timezone(timezone) do
    case OnboardingService.validate_timezone(timezone) do
      :ok -> {:ok, timezone}
      {:error, _changeset} -> {:error, {:validation_error, "timezone"}}
    end
  end

  # A value of the wrong JSON type is no value at all: left as it came, Ecto
  # would cast the string "4" to a Household size of 4.
  defp string(value) when is_binary(value), do: value
  defp string(_value), do: nil

  defp integer(value) when is_integer(value), do: value
  defp integer(_value), do: nil

  defp first_invalid(%Ecto.Changeset{errors: errors}) do
    Enum.find(Keyword.keys(@profile_fields), &Keyword.has_key?(errors, &1))
  end

  defp reject(conn, {:profile, :cooking_skill, %{cooking_skill: skill}}) when is_binary(skill),
    do: conn |> ApiError.error(:invalid_cooking_skill)

  # An error on no profile field leaves no field to name.
  defp reject(conn, {:profile, nil, _attrs}), do: conn |> ApiError.error(:validation_error)

  defp reject(conn, {:profile, field, _attrs}),
    do: conn |> ApiError.validation_error(Keyword.fetch!(@profile_fields, field))

  defp reject(conn, {:invalid_field, field}),
    do: conn |> ApiError.validation_error(Map.fetch!(@preferences_fields, field))

  defp reject(conn, {:validation_error, field}), do: conn |> ApiError.validation_error(field)
  defp reject(conn, :validation_error), do: conn |> ApiError.error(:validation_error)
  defp reject(conn, :invalid_diet), do: conn |> ApiError.error(:invalid_diet)

  defp reject(conn, :invalid_hard_restriction),
    do: conn |> ApiError.error(:invalid_hard_restriction)

  defp reject(conn, :invalid_hunger_level), do: conn |> ApiError.error(:invalid_hunger_level)

  # The body was valid, so this is not something the client can fix.
  defp reject(conn, _reason), do: conn |> ApiError.server_fault()
end
