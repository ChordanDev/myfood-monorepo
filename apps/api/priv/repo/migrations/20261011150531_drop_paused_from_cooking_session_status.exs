defmodule MealPlannerApi.Repo.Migrations.DropPausedFromCookingSessionStatus do
  @moduledoc """
  A Cooking session is `active` or `completed` (issue #126). Nothing ever set
  a session to `paused`: pausing is a step event, and `cooking_step_events`
  keeps its own check.

  No row is rewritten. A `paused` row would make `up` fail instead of being
  mapped to another status.
  """

  use Ecto.Migration

  @statuses_before "status IN ('active', 'paused', 'completed')"
  @statuses_after "status IN ('active', 'completed')"

  def up do
    drop constraint(:cooking_sessions, :cooking_sessions_status_check)
    create constraint(:cooking_sessions, :cooking_sessions_status_check, check: @statuses_after)
  end

  def down do
    drop constraint(:cooking_sessions, :cooking_sessions_status_check)
    create constraint(:cooking_sessions, :cooking_sessions_status_check, check: @statuses_before)
  end
end
