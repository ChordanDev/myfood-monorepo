defmodule MealPlannerApi.Persistence.Planning.ScheduledMeal do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "scheduled_meals" do
    field(:date, :date)
    field(:slot, Ecto.Enum, values: [:breakfast, :lunch, :dinner])
    field(:is_cooked, :boolean, default: false)
    # When the meal was confirmed as not cooked (issue #145); nil without that
    # answer. Only `CookingService.confirm_meal/4` writes it.
    field(:not_cooked_at, :utc_datetime_usec)
    field(:recipe_version_id, :binary_id, read_after_writes: true)
    field(:recipe_snapshot, :map, read_after_writes: true)
    field(:selected_quantity, :integer, default: 1)

    belongs_to(:account, MealPlannerApi.Persistence.Accounts.Account)
    belongs_to(:recipe, MealPlannerApi.Persistence.Catalog.Recipe)

    belongs_to(:ai_generation_run, MealPlannerApi.Persistence.Planning.PlanningGenerationRun,
      foreign_key: :ai_generation_id
    )

    has_many(:cooking_sessions, MealPlannerApi.Persistence.Planning.CookingSession)

    timestamps(type: :utc_datetime_usec)
  end

  # A past meal can be confirmed as cooked or not cooked up to this many days
  # after its date (issue #145). Unanswered after that, it is a Skipped meal.
  @confirmation_window_days 7

  @doc """
  Whether a meal dated `date` can still be confirmed on the Account's `today`:
  its day has passed, and by no more than the confirmation window.
  """
  @spec in_confirmation_window?(Date.t(), Date.t()) :: boolean()
  def in_confirmation_window?(%Date{} = date, %Date{} = today) do
    days_ago = Date.diff(today, date)
    days_ago >= 1 and days_ago <= @confirmation_window_days
  end

  def changeset(scheduled_meal, attrs) do
    scheduled_meal
    |> cast(attrs, [
      :account_id,
      :date,
      :slot,
      :recipe_id,
      :is_cooked,
      :ai_generation_id,
      :selected_quantity
    ])
    |> validate_number(:selected_quantity, greater_than: 0)
    |> validate_required([:account_id, :date, :slot])
    |> foreign_key_constraint(:account_id)
    |> foreign_key_constraint(:recipe_id)
    |> foreign_key_constraint(:ai_generation_id)
    |> unique_constraint([:account_id, :date, :slot])
  end
end
