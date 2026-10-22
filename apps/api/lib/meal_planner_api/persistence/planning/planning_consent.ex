defmodule MealPlannerApi.Persistence.Planning.PlanningConsent do
  @moduledoc """
  A User's AI-processing consent for the planning agent (issue #423). One
  per User, valid in every Account.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "planning_consents" do
    field(:granted_at, :utc_datetime_usec)
    field(:text_version, :string)

    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)

    timestamps(type: :utc_datetime_usec)
  end

  @fields ~w(user_id granted_at text_version)a

  def changeset(consent, attrs) do
    consent
    |> cast(attrs, @fields)
    |> validate_required(@fields)
    |> unique_constraint(:user_id)
    |> foreign_key_constraint(:user_id)
  end
end
