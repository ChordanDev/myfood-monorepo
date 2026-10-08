defmodule MealPlannerApiWeb.SlotCookingTimesController do
  @moduledoc """
  The Slot cooking times of the signed-in User (issue #19):

      GET /api/me/slot-cooking-times
      PUT /api/me/slot-cooking-times

  Both answer the mobile `SlotCookingTimes` body, with no wrapper:

      { breakfast, lunch, dinner }, each { cookingTimeMinutes, hungerLevel }

  The times belong to the User, never to the Account they are acting in.
  """
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Persistence.Accounts.UserSlotCookingTime
  alias MealPlannerApi.Services.AccountService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Casing

  @slots UserSlotCookingTime.slots()
  @slot_names Enum.map(@slots, &Atom.to_string/1)
  @hunger_levels Enum.map(UserSlotCookingTime.hunger_levels(), &Atom.to_string/1)

  def show(conn, _params) do
    user = Guardian.Plug.current_resource(conn)

    case AccountService.slot_cooking_times(user.id) do
      {:ok, times} ->
        json(conn, render_times(times))

      {:error, :slot_cooking_times_not_found} ->
        conn |> ApiError.error(:slot_cooking_times_not_found)
    end
  end

  # The body is the whole set. It is read from `body_params` alone, so a
  # query string can neither supply a slot nor be refused as an unknown one.
  def update(conn, _params) do
    user = Guardian.Plug.current_resource(conn)

    with {:ok, times} <- validate(conn.body_params),
         {:ok, stored} <- AccountService.replace_slot_cooking_times(user.id, times) do
      json(conn, render_times(stored))
    else
      {:error, {:validation_error, message}} ->
        conn |> ApiError.error(:validation_error, message)

      {:error, :invalid_hunger_level} ->
        conn |> ApiError.error(:invalid_hunger_level)

      # The body was valid, so this is not something the client can fix.
      {:error, %Ecto.Changeset{}} ->
        conn |> ApiError.server_fault()
    end
  end

  # The first problem found decides the answer: a key that is not a slot,
  # then each slot in meal order, its minutes before its Hunger level.
  defp validate(body) do
    case body |> Map.keys() |> Enum.reject(&(&1 in @slot_names)) |> Enum.sort() do
      [] -> validate_slots(body)
      [key | _] -> invalid("#{camel_case(key)} is not an accepted slot.")
    end
  end

  defp validate_slots(body) do
    Enum.reduce_while(@slots, {:ok, %{}}, fn slot, {:ok, times} ->
      case validate_slot(Atom.to_string(slot), body) do
        {:ok, time} -> {:cont, {:ok, Map.put(times, slot, time)}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp validate_slot(name, body) do
    case body do
      %{^name => %{} = time} ->
        with {:ok, minutes} <- validate_minutes(name, time),
             {:ok, hunger_level} <- validate_hunger_level(name, time) do
          {:ok, %{cooking_time_minutes: minutes, hunger_level: hunger_level}}
        end

      %{^name => _not_an_object} ->
        invalid("#{name} must be an object.")

      _missing ->
        invalid("#{name} is required.")
    end
  end

  defp validate_minutes(_name, %{"cooking_time_minutes" => minutes})
       when is_integer(minutes) and minutes in 0..240,
       do: {:ok, minutes}

  defp validate_minutes(name, _time),
    do: invalid("#{name}.cookingTimeMinutes must be an integer between 0 and 240.")

  defp validate_hunger_level(_name, %{"hunger_level" => hunger_level})
       when hunger_level in @hunger_levels,
       do: {:ok, hunger_level}

  defp validate_hunger_level(_name, %{"hunger_level" => hunger_level})
       when is_binary(hunger_level),
       do: {:error, :invalid_hunger_level}

  defp validate_hunger_level(name, _time), do: invalid("#{name}.hungerLevel must be a string.")

  defp invalid(message), do: {:error, {:validation_error, message}}

  # `Plugs.MobileCasing` has rewritten the request keys to snake_case; a
  # message names a key in the casing the app sent it.
  defp camel_case(key), do: %{key => nil} |> Casing.camelize_keys() |> Map.keys() |> hd()

  # Written in the casing the app reads, like `CurrentMe`, so the body does
  # not depend on the pipeline the route sits in.
  defp render_times(times) do
    Map.new(times, fn {slot, time} ->
      {slot, %{cookingTimeMinutes: time.cooking_time_minutes, hungerLevel: time.hunger_level}}
    end)
  end
end
