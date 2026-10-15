defmodule MealPlannerApi.Persistence.Idempotency.Key do
  @moduledoc """
  A mutation an Account ran under a client-generated key, and the response it
  returned. Unique per Account, endpoint and key; it expires at `expires_at`.
  """

  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "idempotency_keys" do
    field(:endpoint, :string)
    field(:key, :string)
    field(:response, :map)
    field(:expires_at, :utc_datetime_usec)

    belongs_to(:account, MealPlannerApi.Persistence.Accounts.Account)

    timestamps(type: :utc_datetime_usec)
  end
end
