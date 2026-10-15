defmodule MealPlannerApi.Persistence.LeftoversTest do
  use ExUnit.Case, async: false

  import Ecto.Query, only: [from: 2]

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Leftovers
  alias MealPlannerApi.Persistence.Leftovers.PreparedLeftover
  alias MealPlannerApi.Repo

  @now ~U[2026-10-08 23:30:00.000000Z]

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    %{account_id: account_id("leftovers-a@example.com")}
  end

  describe "create/3" do
    test "defaults consume-by to three days after the UTC today without a stored timezone",
         %{account_id: account_id} do
      assert {:ok, leftover} =
               Leftovers.create(account_id, %{title: "Lentils", portions: 4}, %{now: @now})

      assert leftover.consume_by_date == ~D[2026-10-11]
      assert leftover.stored_at == @now
      assert leftover.portions == 4
      assert is_nil(leftover.consumed_at) and is_nil(leftover.discarded_at)
    end

    test "defaults consume-by using the Account timezone", %{account_id: account_id} do
      from(a in Account, where: a.id == ^account_id)
      |> Repo.update_all(set: [timezone: "Pacific/Auckland"])

      assert {:ok, leftover} =
               Leftovers.create(account_id, %{title: "Stew", portions: 1}, %{now: @now})

      # 23:30Z on Oct 8 is already Oct 9 in Auckland.
      assert leftover.consume_by_date == ~D[2026-10-12]
    end

    test "keeps an explicit consume-by date and notes", %{account_id: account_id} do
      assert {:ok, leftover} =
               Leftovers.create(
                 account_id,
                 %{title: "Soup", portions: 2, consume_by_date: ~D[2026-10-20], notes: "freezer"},
                 %{now: @now}
               )

      assert leftover.consume_by_date == ~D[2026-10-20]
      assert leftover.notes == "freezer"
    end

    test "rejects a missing title and non-positive portions", %{account_id: account_id} do
      assert {:error, changeset} = Leftovers.create(account_id, %{title: "  ", portions: 1})
      assert %{title: [_ | _]} = errors_on(changeset)

      assert {:error, changeset} = Leftovers.create(account_id, %{title: "x", portions: 0})
      assert %{portions: [_ | _]} = errors_on(changeset)
    end

    test "stores a Scheduled meal of the Account as the source", %{account_id: account_id} do
      meal_id = scheduled_meal_id!(account_id)

      assert {:ok, leftover} =
               Leftovers.create(
                 account_id,
                 %{title: "Lentils", portions: 2, scheduled_meal_id: meal_id},
                 %{now: @now}
               )

      assert leftover.scheduled_meal_id == meal_id
    end

    test "has no source without a Scheduled meal id", %{account_id: account_id} do
      attrs = %{title: "Lentils", portions: 2, scheduled_meal_id: nil}

      assert {:ok, leftover} = Leftovers.create(account_id, attrs, %{now: @now})
      assert is_nil(leftover.scheduled_meal_id)
    end

    test "is not found for another Account's Scheduled meal, an unknown and a malformed id",
         %{account_id: account_id} do
      other_id = account_id("leftovers-e@example.com")

      for meal_id <- [scheduled_meal_id!(other_id), Ecto.UUID.generate(), "not-a-uuid", 7] do
        attrs = %{title: "Lentils", portions: 2, scheduled_meal_id: meal_id}

        assert {:error, :scheduled_meal_not_found} =
                 Leftovers.create(account_id, attrs, %{now: @now})
      end

      assert Leftovers.list_open(account_id) == []
      assert Leftovers.list_open(other_id) == []
    end

    test "caps notes at 500 characters", %{account_id: account_id} do
      attrs = %{title: "Soup", portions: 1, notes: String.duplicate("n", 501)}

      assert {:error, changeset} = Leftovers.create(account_id, attrs, %{now: @now})
      assert %{notes: [_ | _]} = errors_on(changeset)
      assert Leftovers.list_open(account_id) == []

      attrs = %{attrs | notes: String.duplicate("n", 500)}
      assert {:ok, leftover} = Leftovers.create(account_id, attrs, %{now: @now})
      assert String.length(leftover.notes) == 500
    end

    test "reports an invalid field before looking the Scheduled meal up",
         %{account_id: account_id} do
      attrs = %{title: "x", portions: 0, scheduled_meal_id: Ecto.UUID.generate()}

      assert {:error, changeset} = Leftovers.create(account_id, attrs)
      assert %{portions: [_ | _]} = errors_on(changeset)
    end
  end

  describe "list_open/1" do
    test "orders soonest consume-by first, then oldest stored", %{account_id: account_id} do
      {:ok, late} = create(account_id, "late", ~D[2026-10-20], @now)
      {:ok, soon_new} = create(account_id, "soon new", ~D[2026-10-10], DateTime.add(@now, 60))
      {:ok, soon_old} = create(account_id, "soon old", ~D[2026-10-10], @now)

      assert Enum.map(Leftovers.list_open(account_id), & &1.id) ==
               [soon_old.id, soon_new.id, late.id]
    end

    test "lists at most 200, leaving out the latest consume-by dates",
         %{account_id: account_id} do
      insert_open!(account_id, 199, ~D[2026-10-10])
      insert_open!(account_id, 2, ~D[2026-10-30])

      listed = Leftovers.list_open(account_id)

      assert length(listed) == 200
      assert Enum.count(listed, &(&1.consume_by_date == ~D[2026-10-30])) == 1
    end

    test "excludes closed leftovers and other Accounts", %{account_id: account_id} do
      other_id = account_id("leftovers-b@example.com")
      {:ok, open} = create(account_id, "open", ~D[2026-10-10], @now)
      {:ok, eaten} = Leftovers.create(account_id, %{title: "eaten", portions: 1}, %{now: @now})
      {:ok, thrown} = create(account_id, "thrown", ~D[2026-10-10], @now)
      {:ok, _foreign} = create(other_id, "foreign", ~D[2026-10-10], @now)

      {:ok, _} = Leftovers.consume(account_id, eaten.id)
      {:ok, _} = Leftovers.discard(account_id, thrown.id)

      assert Enum.map(Leftovers.list_open(account_id), & &1.id) == [open.id]
    end
  end

  describe "consume/3" do
    test "decrements and closes at zero", %{account_id: account_id} do
      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 2}, %{now: @now})

      assert {:ok, once} = Leftovers.consume(account_id, leftover.id)
      assert once.portions == 1
      assert is_nil(once.consumed_at)

      later = DateTime.add(@now, 3600)
      assert {:ok, twice} = Leftovers.consume(account_id, leftover.id, %{now: later})
      assert twice.portions == 0
      assert twice.consumed_at == later

      assert {:error, :not_found} = Leftovers.consume(account_id, leftover.id)
      assert Leftovers.list_open(account_id) == []
    end

    test "is not found for another Account, a discarded one and a malformed id",
         %{account_id: account_id} do
      other_id = account_id("leftovers-c@example.com")
      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 2}, %{now: @now})

      assert {:error, :not_found} = Leftovers.consume(other_id, leftover.id)
      assert {:error, :not_found} = Leftovers.consume(account_id, "not-a-uuid")
      assert {:error, :not_found} = Leftovers.consume(account_id, Ecto.UUID.generate())

      {:ok, _} = Leftovers.discard(account_id, leftover.id)
      assert {:error, :not_found} = Leftovers.consume(account_id, leftover.id)
    end
  end

  describe "discard/3" do
    test "closes the leftover and keeps the portions", %{account_id: account_id} do
      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 3}, %{now: @now})

      assert {:ok, discarded} = Leftovers.discard(account_id, leftover.id, %{now: @now})
      assert discarded.discarded_at == @now
      assert discarded.portions == 3

      assert {:error, :not_found} = Leftovers.discard(account_id, leftover.id)
    end

    test "is not found for another Account", %{account_id: account_id} do
      other_id = account_id("leftovers-d@example.com")
      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 3}, %{now: @now})

      assert {:error, :not_found} = Leftovers.discard(other_id, leftover.id)
      assert [%{id: id}] = Leftovers.list_open(account_id)
      assert id == leftover.id
    end
  end

  defp create(account_id, title, consume_by, now) do
    Leftovers.create(
      account_id,
      %{title: title, portions: 2, consume_by_date: consume_by},
      %{now: now}
    )
  end

  defp insert_open!(account_id, count, consume_by) do
    rows =
      for n <- 1..count do
        %{
          id: Ecto.UUID.generate(),
          account_id: account_id,
          title: "Leftover #{n}",
          portions: 1,
          stored_at: @now,
          consume_by_date: consume_by,
          inserted_at: @now,
          updated_at: @now
        }
      end

    {^count, _} = Repo.insert_all(PreparedLeftover, rows)
  end

  defp scheduled_meal_id!(account_id) do
    {:ok, meal} =
      Calendar.upsert_scheduled_meal(account_id, %{date: ~D[2026-10-09], slot: :dinner})

    meal.id
  end

  defp account_id(email) do
    user =
      MealPlannerApi.FactoryHelpers.user_with_memberships(%{email: email}, [
        {%{name: "Leftovers account", plan: :family_4}, :owner}
      ])

    user.memberships |> hd() |> Map.fetch!(:account_id)
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
  end
end
