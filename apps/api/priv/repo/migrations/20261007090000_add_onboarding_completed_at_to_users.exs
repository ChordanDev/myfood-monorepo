defmodule MealPlannerApi.Repo.Migrations.AddOnboardingCompletedAtToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :onboarding_completed_at, :utc_datetime_usec
    end
  end
end
