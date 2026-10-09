defmodule MealPlannerApi.Persistence.Leftovers.PreparedLeftover do
  @moduledoc """
  A cooked portion an Account keeps apart from Inventory (issue #45).

  Open until `consumed_at` (the last portion was eaten) or `discarded_at` is
  set. It is never an Inventory item and never enters the Shopping list.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "prepared_leftovers" do
    field(:title, :string)
    field(:portions, :integer)
    field(:stored_at, :utc_datetime_usec)
    field(:consume_by_date, :date)
    field(:notes, :string)
    field(:consumed_at, :utc_datetime_usec)
    field(:discarded_at, :utc_datetime_usec)

    belongs_to(:account, MealPlannerApi.Persistence.Accounts.Account)
    belongs_to(:scheduled_meal, MealPlannerApi.Persistence.Planning.ScheduledMeal)

    timestamps(type: :utc_datetime_usec)
  end

  def create_changeset(leftover, attrs) do
    leftover
    |> cast(attrs, [
      :account_id,
      :scheduled_meal_id,
      :title,
      :portions,
      :stored_at,
      :consume_by_date,
      :notes
    ])
    |> update_change(:title, &String.trim/1)
    |> validate_required([:account_id, :title, :portions, :stored_at, :consume_by_date])
    |> validate_number(:portions, greater_than: 0)
    |> foreign_key_constraint(:account_id)
    |> foreign_key_constraint(:scheduled_meal_id)
  end

  def state_changeset(leftover, attrs) do
    leftover
    |> cast(attrs, [:portions, :consumed_at, :discarded_at])
    |> validate_number(:portions, greater_than_or_equal_to: 0)
  end
end
