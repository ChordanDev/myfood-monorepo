defmodule MealPlannerApi.Persistence.Accounts.UserHardRestriction do
  @moduledoc """
  A Hard restriction a User declared: one row per code.

  The code comes from a fixed list (`codes/0`). It is not an Excluded
  ingredient: it names a food group, not a row of the ingredient catalog.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  # Catalog order: the order the mobile app lists the codes in.
  @codes ~w(peanut tree_nut shellfish gluten dairy egg soy)

  schema "user_hard_restrictions" do
    field(:code, :string)

    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)

    timestamps(type: :utc_datetime_usec)
  end

  @doc "The Hard restriction codes, in catalog order."
  @spec codes() :: [String.t()]
  def codes, do: @codes

  def changeset(restriction, attrs) do
    restriction
    |> cast(attrs, [:user_id, :code])
    |> validate_required([:user_id, :code])
    |> validate_inclusion(:code, @codes)
    |> check_constraint(:code, name: :user_hard_restrictions_code_check)
    |> unique_constraint([:user_id, :code])
    |> foreign_key_constraint(:user_id)
  end
end
