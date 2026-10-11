defmodule MealPlannerApi.AccountClockFixtures do
  @moduledoc """
  Keeps a test that goes through the web layer away from the Account's day
  boundary.

  The controllers judge "today" with `MealPlannerApi.AccountClock` at the
  real current time and take no instant from the caller. A test that
  schedules a meal "today" and then calls the server would fail when the
  Account's day changes between the two. `pin_account_to_midday!/2` gives
  the Account a timezone in which the current instant is local midday, so
  that boundary is at least eleven hours away at any wall-clock time.
  """

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Repo

  @doc """
  Stores on the Account the fixed-offset zone in which `now` falls in the
  12:00 hour, and returns the Account's today at `now`.

  The first argument is an Account struct or an Account id. `now` defaults
  to the current time. The returned date is always the UTC date of `now`,
  and it stays the Account's today from eleven hours before `now` to eleven
  hours after it.
  """
  @spec pin_account_to_midday!(Account.t() | Ecto.UUID.t(), DateTime.t()) :: Date.t()
  def pin_account_to_midday!(account_or_id, now \\ DateTime.utc_now())

  def pin_account_to_midday!(%Account{} = account, %DateTime{} = now) do
    account
    |> Account.timezone_changeset(%{timezone: midday_zone(now)})
    |> Repo.update!()
    |> AccountClock.today(now)
  end

  def pin_account_to_midday!(account_id, %DateTime{} = now) when is_binary(account_id) do
    Account |> Repo.get!(account_id) |> pin_account_to_midday!(now)
  end

  # The zone that is `12 - hour` hours ahead of UTC. The `Etc/GMT` names
  # carry the POSIX sign: `Etc/GMT-3` is three hours ahead of UTC.
  defp midday_zone(now) do
    case 12 - DateTime.shift_zone!(now, "Etc/UTC").hour do
      0 -> "Etc/GMT"
      ahead when ahead > 0 -> "Etc/GMT-#{ahead}"
      behind -> "Etc/GMT+#{-behind}"
    end
  end
end
