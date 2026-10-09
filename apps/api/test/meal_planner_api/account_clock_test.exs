defmodule MealPlannerApi.AccountClockTest do
  @moduledoc """
  "Today" for an Account (decision X2): the date in the Account's stored
  IANA timezone at a given instant, UTC while none is stored.

  The instant is always passed in, so no test depends on the wall clock.
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Repo

  describe "today/2 — stored timezone" do
    test "a zone ahead of UTC is already on the next day shortly before UTC midnight" do
      # 23:30 UTC on the 8th is 12:30 on the 9th in Auckland (UTC+13 in October).
      now = ~U[2026-10-08 23:30:00Z]
      account = %Account{timezone: "Pacific/Auckland"}

      assert AccountClock.today(account, now) == ~D[2026-10-09]
      assert DateTime.to_date(now) == ~D[2026-10-08]
    end

    test "a zone behind UTC is still on the previous day shortly after UTC midnight" do
      # 00:30 UTC on the 9th is 21:30 on the 8th in Buenos Aires (UTC-3).
      now = ~U[2026-10-09 00:30:00Z]
      account = %Account{timezone: "America/Argentina/Buenos_Aires"}

      assert AccountClock.today(account, now) == ~D[2026-10-08]
      assert DateTime.to_date(now) == ~D[2026-10-09]
    end

    test "the date follows the zone's offset in force at the instant" do
      # Madrid is UTC+2 in July and UTC+1 in January, so 22:30 UTC is past
      # local midnight only in July.
      account = %Account{timezone: "Europe/Madrid"}

      assert AccountClock.today(account, ~U[2026-07-01 22:30:00Z]) == ~D[2026-07-02]
      assert AccountClock.today(account, ~U[2026-01-01 22:30:00Z]) == ~D[2026-01-01]
    end
  end

  describe "today/2 — no usable timezone" do
    test "a nil timezone gives the UTC date" do
      assert AccountClock.today(%Account{timezone: nil}, ~U[2026-10-08 23:30:00Z]) ==
               ~D[2026-10-08]
    end

    test "a blank timezone gives the UTC date" do
      assert AccountClock.today(%Account{timezone: ""}, ~U[2026-10-08 23:30:00Z]) ==
               ~D[2026-10-08]

      assert AccountClock.today(%Account{timezone: "  "}, ~U[2026-10-08 23:30:00Z]) ==
               ~D[2026-10-08]
    end

    test "a zone the time zone database does not know gives the UTC date" do
      assert AccountClock.today(%Account{timezone: "Mars/Olympus_Mons"}, ~U[2026-10-08 23:30:00Z]) ==
               ~D[2026-10-08]
    end

    test "a nil Account gives the UTC date" do
      assert AccountClock.today(nil, ~U[2026-10-08 23:30:00Z]) == ~D[2026-10-08]
    end
  end

  describe "today/2 — Account id" do
    setup do
      :ok = Sandbox.checkout(Repo)
      :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    end

    test "reads the stored timezone of the Account" do
      account = insert_account!(%{timezone: "Pacific/Auckland"})

      assert AccountClock.today(account.id, ~U[2026-10-08 23:30:00Z]) == ~D[2026-10-09]
    end

    test "an Account with no stored timezone gives the UTC date" do
      account = insert_account!(%{})

      assert AccountClock.today(account.id, ~U[2026-10-08 23:30:00Z]) == ~D[2026-10-08]
    end

    test "an id with no Account gives the UTC date" do
      assert AccountClock.today(Ecto.UUID.generate(), ~U[2026-10-08 23:30:00Z]) == ~D[2026-10-08]
    end

    test "a malformed id gives the UTC date" do
      assert AccountClock.today("not-a-uuid", ~U[2026-10-08 23:30:00Z]) == ~D[2026-10-08]
    end
  end

  describe "today/1" do
    test "defaults the instant to the current time" do
      before = Date.utc_today()
      today = AccountClock.today(%Account{timezone: nil})

      assert today in [before, Date.utc_today()]
    end
  end

  defp insert_account!(attrs) do
    plan = Repo.get_by!(MealPlannerApi.Subscriptions.Plan, name: "individual")

    %Account{}
    |> Account.changeset(
      Map.merge(
        %{
          name: "Account Clock Test",
          plan: :individual,
          default_budget_cents: 0,
          subscription_plan_id: plan.id
        },
        attrs
      )
    )
    |> Repo.insert!()
  end
end
