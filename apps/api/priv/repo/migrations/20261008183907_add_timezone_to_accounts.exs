defmodule MealPlannerApi.Repo.Migrations.AddTimezoneToAccounts do
  @moduledoc """
  Account timezone (issue #39, decision X2): the IANA zone name that
  decides which calendar day is "today" for an Account.

  Nullable with no backfill: an Account with no stored zone reads as UTC
  (`MealPlannerApi.AccountClock`).
  """
  use Ecto.Migration

  def change do
    alter table(:accounts) do
      add :timezone, :string
    end
  end
end
