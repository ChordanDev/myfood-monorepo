defmodule MealPlannerApi.Persistence.Auth.SocialIdentity do
  @moduledoc """
  A provider account linked to a User (issue #106): the `provider`
  (`"google"` or `"apple"`) and the `subject` the provider's ID token
  names the person with.

  A provider account links to at most one User, by the unique index on
  `(provider, subject)`. Rows are written by
  `MealPlannerApi.Services.SocialLogin` only, on the first sign-in with
  that provider account.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  @providers ~w(google apple)

  schema "social_identities" do
    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)

    field(:provider, :string)
    field(:subject, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @doc """
  Casts and validates a new identity. Required: `user_id`, `provider`,
  `subject`.
  """
  def changeset(identity, attrs) do
    identity
    |> cast(attrs, [:user_id, :provider, :subject])
    |> validate_required([:user_id, :provider, :subject])
    |> validate_inclusion(:provider, @providers)
    |> unique_constraint([:provider, :subject])
    |> foreign_key_constraint(:user_id)
  end
end
