defmodule MealPlannerApi.Planning.LockOwner do
  @moduledoc """
  Read helper behind the `planning_range_locked` error of `start_planning`
  (issue #25): who holds the date range a member asked for.

  The lock is the `:active` row of `planning_sessions`; its owner is the
  Membership in `lock_owner_membership_id`, and the display name of a member
  is the `name` of its User. The name is returned only when the owner is a
  Membership other than the caller's: a member who collides with their own
  session has nothing to learn from their own name.
  """

  import Ecto.Query, only: [from: 2]

  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Planning.PlanningSession
  alias MealPlannerApi.Repo

  @doc """
  The display name of the member who holds the earliest active session of
  `account_id` that overlaps `{date_from, date_to}` (both ends inclusive, as
  the exclusion constraint of the table reads them).

  Returns `{:ok, name}` when that session belongs to a Membership other than
  `caller_membership_id`, and `:none` when it belongs to the caller, when no
  active session overlaps any more (it ended between the refused insert and
  this read), or when its owner has no name.
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
            s.range_from <= ^date_to and s.range_to >= ^date_from,
        order_by: [asc: s.range_from, asc: s.started_at],
        limit: 1,
        select: {s.lock_owner_membership_id, u.name}
      )

    case Repo.one(query) do
      {owner_membership_id, name}
      when owner_membership_id != caller_membership_id and is_binary(name) and name != "" ->
        {:ok, name}

      _own_or_missing ->
        :none
    end
  end
end
