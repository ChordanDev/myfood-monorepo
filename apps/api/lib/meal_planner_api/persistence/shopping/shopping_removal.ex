defmodule MealPlannerApi.Persistence.Shopping.ShoppingRemoval do
  @moduledoc """
  The User's decision not to buy one Ingredient for one Scheduled meal
  (issue #334). It is kept apart from the Shopping item, so it outlives an
  item that a Shortage of zero does not derive, and the derivation marks as
  `removed` every item of the meal and Ingredient. Restoring an item deletes
  it; a recipe swap or a finished Cooking session of the meal drops it, and
  deleting the meal deletes it.
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "shopping_removals" do
    belongs_to(:account, MealPlannerApi.Persistence.Accounts.Account)
    belongs_to(:scheduled_meal, MealPlannerApi.Persistence.Planning.ScheduledMeal)
    belongs_to(:ingredient, MealPlannerApi.Persistence.Catalog.Ingredient)

    timestamps(type: :utc_datetime_usec)
  end
end
