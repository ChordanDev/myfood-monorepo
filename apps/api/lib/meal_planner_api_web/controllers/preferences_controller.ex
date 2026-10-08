defmodule MealPlannerApiWeb.PreferencesController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.UserPreferencesService

  # `GET /api/me/preferences`: the body is the preferences themselves, with
  # no wrapper. A User with nothing stored gets the empty ones, never a 404.
  def show(conn, _params) do
    user = Guardian.Plug.current_resource(conn)

    json(conn, UserPreferencesService.get(user.id))
  end
end
