defmodule MealPlannerApi.Repo.Migrations.AddAgentToPlanningSessions do
  @moduledoc """
  Marks the Planning session rows owned by the planning agent (issue #423).
  An agent session keeps the same range lock as the legacy one; the flag
  tells the two apart until the legacy planner is switched off (#436).
  Existing rows are legacy rows.

  Ported from myfood with a new timestamp.
  """
  use Ecto.Migration

  def change do
    alter table(:planning_sessions) do
      add(:agent, :boolean, null: false, default: false)
    end
  end
end
