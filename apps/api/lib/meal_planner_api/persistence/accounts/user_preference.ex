defmodule MealPlannerApi.Persistence.Accounts.UserPreference do
  @moduledoc """
  User-level planning preferences: protein target, dietary exclusions and
  Soft preferences.

  Stored separately from User so the core User schema stays lean.
  Created or updated on first access or when the user saves preferences.
  """

  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "user_preferences" do
    field(:protein_g_per_meal, :integer)
    field(:default_exclusions, {:array, :string}, default: [])
    # The User's Soft preferences, in the order they were saved.
    field(:soft_preferences, {:array, :string}, default: [])

    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(preference, attrs) do
    preference
    |> Ecto.Changeset.cast(attrs, [:user_id, :protein_g_per_meal, :default_exclusions])
    |> Ecto.Changeset.validate_required([:user_id])
    |> Ecto.Changeset.validate_number(:protein_g_per_meal,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 200
    )
    |> Ecto.Changeset.unique_constraint(:user_id)
    |> Ecto.Changeset.foreign_key_constraint(:user_id)
  end

  @doc """
  Changeset of the Soft preferences the mobile app saves (issue #18).

  Only `soft_preferences` is cast: the protein target and the default
  exclusions keep the value they have.
  """
  def soft_preferences_changeset(preference, attrs) do
    preference
    |> Ecto.Changeset.cast(attrs, [:soft_preferences])
    |> Ecto.Changeset.validate_required([:user_id])
    |> Ecto.Changeset.unique_constraint(:user_id)
    |> Ecto.Changeset.foreign_key_constraint(:user_id)
  end
end
