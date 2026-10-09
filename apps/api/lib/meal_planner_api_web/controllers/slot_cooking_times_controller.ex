defmodule MealPlannerApiWeb.SlotCookingTimesController do
  @moduledoc """
  The Slot cooking times of the signed-in User (issue #19):

      GET /api/me/slot-cooking-times
      PUT /api/me/slot-cooking-times

  Both answer the mobile `SlotCookingTimes` body, with no wrapper:

      { breakfast, lunch, dinner }, each { cookingTimeMinutes, hungerLevel }

  The times belong to the User, never to the Account they are acting in.

  A `PUT` that is refused answers `invalid_hunger_level` for a Hunger level
  that is a string outside the catalog, and `validation_error` for anything
  else: naming the field at fault, such as `lunch.cookingTimeMinutes`, or
  with the static message of the code when the body is not an object and
  there is no field to name.
  """
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.AccountService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.SlotCookingTimesParams

  def show(conn, _params) do
    user = Guardian.Plug.current_resource(conn)

    case AccountService.slot_cooking_times(user.id) do
      {:ok, times} ->
        json(conn, SlotCookingTimesParams.render(times))

      {:error, :slot_cooking_times_not_found} ->
        conn |> ApiError.error(:slot_cooking_times_not_found)
    end
  end

  # The body is the whole set. It is read from `body_params` alone, so a
  # query string can neither supply a slot nor be refused as an unknown one.
  def update(conn, _params) do
    user = Guardian.Plug.current_resource(conn)

    with {:ok, times} <- SlotCookingTimesParams.validate(conn.body_params),
         {:ok, stored} <- AccountService.replace_slot_cooking_times(user.id, times) do
      json(conn, SlotCookingTimesParams.render(stored))
    else
      {:error, {:validation_error, field}} ->
        conn |> ApiError.validation_error(field)

      # A body that is not an object leaves no field to name.
      {:error, :validation_error} ->
        conn |> ApiError.error(:validation_error)

      {:error, :invalid_hunger_level} ->
        conn |> ApiError.error(:invalid_hunger_level)

      # The body was valid, so this is not something the client can fix.
      {:error, %Ecto.Changeset{}} ->
        conn |> ApiError.server_fault()
    end
  end
end
