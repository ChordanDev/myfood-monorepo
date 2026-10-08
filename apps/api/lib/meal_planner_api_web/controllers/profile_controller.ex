defmodule MealPlannerApiWeb.ProfileController do
  @moduledoc """
  `PUT /api/me/profile` (issue #17): the User edits the Onboarding profile.

  The body carries `displayName`, `householdSize` and `cookingSkill`, all
  three required; `Plugs.MobileCasing` hands them over in snake_case. A
  success answers `{ user }`, the `user` object of `CurrentMe`.

  Fields are validated in the order above and the first offending one
  decides the answer: `invalid_cooking_skill` for a Cooking skill that is a
  string outside the catalog, `validation_error` naming the field for
  anything else. The bounds themselves belong to `User.profile_changeset/2`.
  A rejection that falls on none of the three fields still answers
  `validation_error`, with the static message of the code and no field
  named.
  """
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Persistence.Accounts
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.CurrentMe

  # User field and wire spelling of each profile field, in validation order.
  @fields [name: "displayName", household_size: "householdSize", cooking_skill: "cookingSkill"]

  def update(conn, params) do
    user = Guardian.Plug.current_resource(conn)
    attrs = profile_attrs(params)

    case Accounts.update_user_profile(user.id, attrs) do
      {:ok, updated} -> json(conn, %{user: CurrentMe.user_json(updated)})
      {:error, %Ecto.Changeset{} = changeset} -> reject(conn, first_invalid(changeset), attrs)
      {:error, :user_not_found} -> conn |> ApiError.error(:account_not_found)
    end
  end

  # A value of the wrong JSON type is no value at all: left as it came, Ecto
  # would cast the string "4" to a Household size of 4. Every key is always
  # present, so a field the body omits is required like any other instead of
  # keeping its stored value.
  defp profile_attrs(params) do
    %{
      name: string(params["display_name"]),
      household_size: integer(params["household_size"]),
      cooking_skill: string(params["cooking_skill"])
    }
  end

  defp string(value) when is_binary(value), do: value
  defp string(_value), do: nil

  defp integer(value) when is_integer(value), do: value
  defp integer(_value), do: nil

  defp first_invalid(%Ecto.Changeset{errors: errors}) do
    Enum.find(Keyword.keys(@fields), &Keyword.has_key?(errors, &1))
  end

  defp reject(conn, :cooking_skill, %{cooking_skill: skill}) when is_binary(skill),
    do: conn |> ApiError.error(:invalid_cooking_skill)

  # An error on no profile field leaves no field to name.
  defp reject(conn, nil, _attrs), do: conn |> ApiError.error(:validation_error)

  defp reject(conn, field, _attrs),
    do: conn |> ApiError.validation_error(Keyword.fetch!(@fields, field))
end
