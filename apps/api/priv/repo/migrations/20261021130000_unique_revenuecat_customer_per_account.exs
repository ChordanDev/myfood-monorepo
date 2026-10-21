defmodule MealPlannerApi.Repo.Migrations.UniqueRevenuecatCustomerPerAccount do
  use Ecto.Migration

  # One RevenueCat `app_user_id` per Account (issue #412). The unique index
  # lets concurrent first calls to `GET /billing/revenuecat/status` race on
  # the insert and still end with one row. Nothing in the app wrote these
  # rows before, so no Account holds two; if one did, this fails instead of
  # choosing which id to drop.
  def change do
    drop index(:revenuecat_customers, [:account_id])
    create unique_index(:revenuecat_customers, [:account_id])
  end
end
