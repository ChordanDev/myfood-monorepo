defmodule MealPlannerApiWeb.SlotCookingTimesParams do
  @moduledoc """
  Reading and rendering the Slot cooking times as the mobile app spells
  them, shared by `PUT /api/me/slot-cooking-times` and
  `POST /api/onboarding/complete`, so both refuse the same bodies the same
  way.

  A body is `{ breakfast, lunch, dinner }`, each `{ cookingTimeMinutes,
  hungerLevel }`; `Plugs.MobileCasing` hands it over in snake_case.
  """

  alias MealPlannerApi.Persistence.Accounts.UserSlotCookingTime
  alias MealPlannerApiWeb.Casing

  @slots UserSlotCookingTime.slots()
  @slot_names Enum.map(@slots, &Atom.to_string/1)
  @hunger_levels Enum.map(UserSlotCookingTime.hunger_levels(), &Atom.to_string/1)
  @cooking_time_minutes UserSlotCookingTime.cooking_time_minutes()

  @type rejection ::
          {:validation_error, String.t()} | :validation_error | :invalid_hunger_level

  @doc """
  Validates a whole set and returns the times to store, keyed by slot.

  The first problem found decides the answer: a key that is not a slot,
  then each slot in meal order, its minutes before its Hunger level.
  `{:error, {:validation_error, field}}` names the field at fault in the
  wire spelling, `{:error, :validation_error}` is a body that is not an
  object, and `{:error, :invalid_hunger_level}` a Hunger level that is a
  string outside the catalog.
  """
  @spec validate(term()) ::
          {:ok, %{atom() => map()}} | {:error, rejection()}
  # `Plug.Parsers` hands over a JSON document that is not an object, such as
  # an array or a number, under the single key `_json`.
  def validate(%{"_json" => _not_an_object} = body) when map_size(body) == 1,
    do: {:error, :validation_error}

  # A body no parser read, such as `text/plain`, stays a
  # `%Plug.Conn.Unfetched{}` struct.
  def validate(body) when is_struct(body), do: {:error, :validation_error}

  def validate(body) when is_map(body) do
    case body |> Map.keys() |> Enum.reject(&(&1 in @slot_names)) |> Enum.sort() do
      [] -> validate_slots(body)
      [key | _] -> invalid(camel_case(key))
    end
  end

  def validate(_not_an_object), do: {:error, :validation_error}

  @doc """
  Renders stored times (a map from slot to `cooking_time_minutes` and
  `hunger_level`) in the casing the app reads, so the body does not depend
  on the pipeline the route sits in.
  """
  @spec render(map()) :: map()
  def render(times) do
    Map.new(times, fn {slot, time} ->
      {slot, %{cookingTimeMinutes: time.cooking_time_minutes, hungerLevel: time.hunger_level}}
    end)
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

      _missing_or_not_an_object ->
        invalid(name)
    end
  end

  defp validate_minutes(_name, %{"cooking_time_minutes" => minutes})
       when is_integer(minutes) and minutes in @cooking_time_minutes,
       do: {:ok, minutes}

  defp validate_minutes(name, _time), do: invalid("#{name}.cookingTimeMinutes")

  defp validate_hunger_level(_name, %{"hunger_level" => hunger_level})
       when hunger_level in @hunger_levels,
       do: {:ok, hunger_level}

  defp validate_hunger_level(_name, %{"hunger_level" => hunger_level})
       when is_binary(hunger_level),
       do: {:error, :invalid_hunger_level}

  defp validate_hunger_level(name, _time), do: invalid("#{name}.hungerLevel")

  # `field` is the wire spelling of the field at fault, which
  # `ApiError.validation_error/2` names in the message.
  defp invalid(field), do: {:error, {:validation_error, field}}

  # `Plugs.MobileCasing` has rewritten the request keys to snake_case; a
  # message names a key in the casing the app sent it.
  defp camel_case(key), do: %{key => nil} |> Casing.camelize_keys() |> Map.keys() |> hd()
end
