defmodule MealPlannerApi.Repo.Migrations.AddNotCookedAtToScheduledMeals do
  @moduledoc """
  A past Scheduled meal can be confirmed as not cooked (issue #145). The
  answer is stored on the meal as the instant it was given, so it survives a
  live plan reload and reaches every device of the Account. A meal with no
  answer keeps the column empty; every existing row has none.
  """
  use Ecto.Migration

  def change do
    alter table(:scheduled_meals) do
      add(:not_cooked_at, :utc_datetime_usec)
    end
  end
end
