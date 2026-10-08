defmodule MealPlannerApiWeb.PreferencesController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.UserPreferencesService
  alias MealPlannerApiWeb.ApiError

  # The fields of the body as the app spells them, to name one in an error.
  @wire_fields %{
    diet: "diet",
    hard_restrictions: "hardRestrictions",
    soft_preferences: "softPreferences"
  }

  # `GET /api/me/preferences`: the body is the preferences themselves, with
  # no wrapper. A User with nothing stored gets the empty ones, never a 404.
  def show(conn, _params) do
    user = Guardian.Plug.current_resource(conn)

    json(conn, UserPreferencesService.get(user.id))
  end

  # `PUT /api/me/preferences`: replaces the three fields and answers with the
  # preferences as they are stored, in the shape `show/2` renders. A body
  # that is not valid is refused whole and nothing is written.
  def update(conn, params) do
    user = Guardian.Plug.current_resource(conn)

    with {:ok, preferences} <- UserPreferencesService.validate(params),
         {:ok, stored} <- UserPreferencesService.replace(user.id, preferences) do
      json(conn, stored)
    else
      {:error, {:invalid_field, field}} ->
        conn |> ApiError.validation_error(Map.fetch!(@wire_fields, field))

      {:error, :invalid_diet} ->
        conn |> ApiError.error(:invalid_diet)

      {:error, :invalid_hard_restriction} ->
        conn |> ApiError.error(:invalid_hard_restriction)

      {:error, _reason} ->
        conn |> ApiError.server_fault()
    end
  end
end
