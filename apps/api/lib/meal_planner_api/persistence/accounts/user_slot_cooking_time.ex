defmodule MealPlannerApi.Persistence.Accounts.UserSlotCookingTime do
  @moduledoc """
  The minutes a User will cook and their Hunger level for one slot.

  A User has at most one row per slot, and a saved set always holds the
  three of them: see `MealPlannerApi.Persistence.Accounts.replace_user_slot_cooking_times/2`.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{}

  @slots [:breakfast, :lunch, :dinner]
  @hunger_levels [:light, :normal, :strong]
  @cooking_time_minutes 0..240

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "user_slot_cooking_times" do
    field(:slot, Ecto.Enum, values: @slots)
    field(:cooking_time_minutes, :integer)
    field(:hunger_level, Ecto.Enum, values: @hunger_levels)

    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)

    timestamps(type: :utc_datetime_usec)
  end

  @doc "The slots a set of Slot cooking times holds, in meal order."
  def slots, do: @slots

  @doc "The Hunger level catalog."
  def hunger_levels, do: @hunger_levels

  @doc """
  The minutes a slot accepts. The check constraint of the table repeats the
  bounds.
  """
  def cooking_time_minutes, do: @cooking_time_minutes

  def changeset(slot_cooking_time, attrs) do
    slot_cooking_time
    |> cast(attrs, [:user_id, :slot, :cooking_time_minutes, :hunger_level])
    |> validate_required([:user_id, :slot, :cooking_time_minutes, :hunger_level])
    |> validate_number(:cooking_time_minutes,
      greater_than_or_equal_to: @cooking_time_minutes.first,
      less_than_or_equal_to: @cooking_time_minutes.last
    )
    |> unique_constraint([:user_id, :slot])
    |> foreign_key_constraint(:user_id)
  end
end
