defmodule MealPlannerApi.Planning.LockOwner do
  @moduledoc """
  Read helper behind the `planning_range_locked` error (issue #25): who
  holds the date range a member asked for; and behind
  `planning_session_active` (issue #423): whose agent session runs.

  The lock is the `:active` row of `planning_sessions`; its owner is the
  Membership in `lock_owner_membership_id`, and the display name of a member
  is the `name` of its User. The caller's own sessions are skipped: a member
  who collides with their own session has nothing to learn from their own
  name, and a range can overlap one of theirs and a peer's at once (issue
  #229), in which case the peer is the one worth naming.
  """

  import Ecto.Query, only: [from: 2]

  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Planning.PlanningSession
  alias MealPlannerApi.Repo

  @doc """
  The display name of the member who holds the earliest active session of
  `account_id` that overlaps `{date_from, date_to}` (both ends inclusive, as
  the exclusion constraint of the table reads them) and belongs to a
  Membership other than `caller_membership_id`.

  Returns `{:ok, name}` for that session, and `:none` when every overlapping
  active session belongs to the caller, when none overlaps any more (it ended
  between the refused insert and this read), or when its owner has no name.
  """
  @spec owner_name(Ecto.UUID.t(), {Date.t(), Date.t()}, Ecto.UUID.t()) ::
          {:ok, String.t()} | :none
  def owner_name(account_id, {date_from, date_to}, caller_membership_id) do
    query =
      from(s in PlanningSession,
        join: u in User,
        on: u.id == s.lock_owner_user_id,
        where:
          s.account_id == ^account_id and s.status == :active and
            (is_nil(s.lock_owner_membership_id) or
               s.lock_owner_membership_id != ^caller_membership_id) and
            s.range_from <= ^date_to and s.range_to >= ^date_from,
        order_by: [asc: s.range_from, asc: s.started_at],
        limit: 1,
        select: u.name
      )

    query |> Repo.one() |> present_name()
  end

  @doc """
  The display name of the member whose agent session of `account_id` runs,
  when that member is not `caller_membership_id`.

  Returns `:none` when the running session is the caller's, when it ended
  meanwhile, or when its owner has no name.
  """
  @spec agent_session_owner_name(Ecto.UUID.t(), Ecto.UUID.t()) :: {:ok, String.t()} | :none
  def agent_session_owner_name(account_id, caller_membership_id) do
    query =
      from(s in PlanningSession,
        join: u in User,
        on: u.id == s.lock_owner_user_id,
        where:
          s.account_id == ^account_id and s.status == :active and s.agent and
            s.lock_owner_membership_id != ^caller_membership_id,
        order_by: [asc: s.started_at],
        limit: 1,
        select: u.name
      )

    query |> Repo.one() |> present_name()
  end

  defp present_name(name) when is_binary(name) and name != "", do: {:ok, name}
  defp present_name(_missing), do: :none
end
