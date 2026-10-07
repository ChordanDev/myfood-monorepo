defmodule MealPlannerApi.Repo.Migrations.AddAttemptsToEmailVerificationCodes do
  use Ecto.Migration

  def change do
    alter table(:email_verification_codes) do
      add :attempts, :integer, null: false, default: 0
    end
  end
end
