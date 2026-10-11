defmodule MealPlannerApi.AccountClockFixturesTest do
  @moduledoc """
  `pin_account_to_midday!/2` puts the instant it is given in the 12:00 hour
  of the Account's day, whatever UTC hour that instant has.

  The instant is always passed in, so no test depends on the wall clock.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.AccountClockFixtures
  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Repo

  @eleven_hours 11 * 3600

  # The first and the last second of every UTC hour of one day.
  @instants for hour <- 0..23,
                {minute, second} <- [{0, 0}, {59, 59}],
                do: DateTime.new!(~D[2026-10-08], Time.new!(hour, minute, second), "Etc/UTC")

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    %{account: account} = insert_identity!()
    %{account: account}
  end

  test "returns the Account's today, which is the UTC date of the instant", %{account: account} do
    for now <- @instants do
      today = pin_account_to_midday!(account.id, now)

      assert today == AccountClock.today(account.id, now), "at #{now}"
      assert today == DateTime.to_date(now), "at #{now}"
    end
  end

  test "stores a zone in which the instant is in the 12:00 hour", %{account: account} do
    for now <- @instants do
      pin_account_to_midday!(account.id, now)

      timezone = Repo.get!(Account, account.id).timezone
      assert DateTime.shift_zone!(now, timezone).hour == 12, "at #{now} in #{timezone}"
    end
  end

  test "the Account's today is the same eleven hours before and after", %{account: account} do
    for now <- @instants do
      today = pin_account_to_midday!(account.id, now)

      assert AccountClock.today(account.id, DateTime.add(now, -@eleven_hours)) == today,
             "eleven hours before #{now}"

      assert AccountClock.today(account.id, DateTime.add(now, @eleven_hours)) == today,
             "eleven hours after #{now}"
    end
  end

  test "takes an Account struct as well as an id", %{account: account} do
    now = ~U[2026-10-08 23:59:59Z]

    assert pin_account_to_midday!(account, now) == ~D[2026-10-08]
    assert AccountClock.today(account.id, now) == ~D[2026-10-08]
  end

  test "reads the instant in UTC whatever zone it is given in", %{account: account} do
    # 23:30 UTC on the 8th, written as 12:30 on the 9th in Auckland.
    now = DateTime.shift_zone!(~U[2026-10-08 23:30:00Z], "Pacific/Auckland")

    assert pin_account_to_midday!(account.id, now) == ~D[2026-10-08]
    assert Repo.get!(Account, account.id).timezone == "Etc/GMT+11"
  end

  test "defaults the instant to the current time", %{account: account} do
    assert pin_account_to_midday!(account.id) == AccountClock.today(account.id)
  end
end
