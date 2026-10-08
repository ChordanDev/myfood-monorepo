defmodule MealPlannerApi.Persistence.Accounts.UserSlotCookingTimesTest do
  @moduledoc """
  Slot cooking times of a User (issue #19): what the read and replace
  functions store, layer by layer, and what the `user_slot_cooking_times`
  table itself refuses.
  """
  use ExUnit.Case, async: false

  import Ecto.Query, warn: false
  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Data.AccountRepo
  alias MealPlannerApi.Persistence.Accounts
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Accounts.UserSlotCookingTime
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.AccountService

  @times %{
    breakfast: %{cooking_time_minutes: 10, hunger_level: :light},
    lunch: %{cooking_time_minutes: 45, hunger_level: :normal},
    dinner: %{cooking_time_minutes: 30, hunger_level: :strong}
  }

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    %{user: insert_user(), other: insert_user()}
  end

  describe "Accounts.list_user_slot_cooking_times/1" do
    test "is empty for a User who never saved any", %{user: user} do
      assert Accounts.list_user_slot_cooking_times(user.id) == []
    end
  end

  describe "Accounts.replace_user_slot_cooking_times/2" do
    test "stores one row per slot", %{user: user} do
      assert {:ok, rows} = Accounts.replace_user_slot_cooking_times(user.id, @times)

      assert stored(rows) == @times
      assert stored(Accounts.list_user_slot_cooking_times(user.id)) == @times
    end

    test "accepts the Hunger level as a string", %{user: user} do
      times = put_in(@times, [:lunch, :hunger_level], "strong")

      assert {:ok, _rows} = Accounts.replace_user_slot_cooking_times(user.id, times)
      assert %{lunch: %{hunger_level: :strong}} = stored_for(user)
    end

    test "overwrites the previous set instead of adding to it", %{user: user} do
      {:ok, first} = Accounts.replace_user_slot_cooking_times(user.id, @times)

      replacement = %{
        breakfast: %{cooking_time_minutes: 0, hunger_level: :strong},
        lunch: %{cooking_time_minutes: 240, hunger_level: :light},
        dinner: %{cooking_time_minutes: 15, hunger_level: :normal}
      }

      assert {:ok, second} = Accounts.replace_user_slot_cooking_times(user.id, replacement)

      assert stored_for(user) == replacement
      assert Repo.aggregate(UserSlotCookingTime, :count) == 3
      assert ids(second) == ids(first)
    end

    test "leaves another User's set alone", %{user: user, other: other} do
      theirs = put_in(@times, [:dinner, :cooking_time_minutes], 90)

      {:ok, _} = Accounts.replace_user_slot_cooking_times(other.id, theirs)
      {:ok, _} = Accounts.replace_user_slot_cooking_times(user.id, @times)

      assert stored_for(user) == @times
      assert stored_for(other) == theirs
    end

    test "refuses a set with a slot missing and writes nothing", %{user: user} do
      assert {:error, %Ecto.Changeset{} = changeset} =
               Accounts.replace_user_slot_cooking_times(user.id, Map.delete(@times, :dinner))

      assert %{cooking_time_minutes: [_], hunger_level: [_]} = errors_on(changeset)
      assert Accounts.list_user_slot_cooking_times(user.id) == []
    end

    test "refuses minutes outside 0 to 240 and keeps the previous set", %{user: user} do
      {:ok, _} = Accounts.replace_user_slot_cooking_times(user.id, @times)

      for minutes <- [-1, 241] do
        # Dinner is the last slot written, so the two before it are rolled back.
        times = %{
          breakfast: %{cooking_time_minutes: 99, hunger_level: :normal},
          lunch: %{cooking_time_minutes: 99, hunger_level: :normal},
          dinner: %{cooking_time_minutes: minutes, hunger_level: :normal}
        }

        assert {:error, changeset} = Accounts.replace_user_slot_cooking_times(user.id, times)
        assert %{cooking_time_minutes: [_]} = errors_on(changeset)
        assert stored_for(user) == @times
      end
    end

    test "refuses a Hunger level outside the catalog", %{user: user} do
      times = put_in(@times, [:breakfast, :hunger_level], "ravenous")

      assert {:error, changeset} = Accounts.replace_user_slot_cooking_times(user.id, times)
      assert %{hunger_level: [_]} = errors_on(changeset)
      assert Accounts.list_user_slot_cooking_times(user.id) == []
    end

    test "joins a transaction that is already open", %{user: user, other: other} do
      assert {:ok, _} =
               Repo.transaction(fn ->
                 {:ok, rows} = Accounts.replace_user_slot_cooking_times(user.id, @times)
                 rows
               end)

      assert stored_for(user) == @times

      assert {:error, :abandoned} =
               Repo.transaction(fn ->
                 {:ok, _} = Accounts.replace_user_slot_cooking_times(other.id, @times)
                 Repo.rollback(:abandoned)
               end)

      assert Accounts.list_user_slot_cooking_times(other.id) == []
    end
  end

  describe "AccountRepo" do
    test "reads and replaces through the persistence functions", %{user: user} do
      assert AccountRepo.list_slot_cooking_times(user.id) == []
      assert {:ok, rows} = AccountRepo.replace_slot_cooking_times(user.id, @times)

      assert stored(rows) == @times
      assert stored(AccountRepo.list_slot_cooking_times(user.id)) == @times
    end
  end

  describe "AccountService" do
    @serialized %{
      breakfast: %{cooking_time_minutes: 10, hunger_level: "light"},
      lunch: %{cooking_time_minutes: 45, hunger_level: "normal"},
      dinner: %{cooking_time_minutes: 30, hunger_level: "strong"}
    }

    test "slot_cooking_times/1 answers not found until a set is saved", %{user: user} do
      assert AccountService.slot_cooking_times(user.id) ==
               {:error, :slot_cooking_times_not_found}
    end

    test "replace_slot_cooking_times/2 returns the stored set, keyed by slot", %{user: user} do
      assert AccountService.replace_slot_cooking_times(user.id, @times) == {:ok, @serialized}
      assert AccountService.slot_cooking_times(user.id) == {:ok, @serialized}
    end

    test "replace_slot_cooking_times/2 passes a refused set on", %{user: user} do
      assert {:error, %Ecto.Changeset{}} =
               AccountService.replace_slot_cooking_times(user.id, Map.delete(@times, :lunch))
    end

    test "slot_cooking_times/1 answers not found for an incomplete set", %{user: user} do
      raw_insert!(user, "breakfast", 10, "light")
      raw_insert!(user, "lunch", 20, "normal")

      assert AccountService.slot_cooking_times(user.id) ==
               {:error, :slot_cooking_times_not_found}
    end
  end

  describe "user_slot_cooking_times table" do
    test "accepts the three slots and the bounds of the minutes range", %{user: user} do
      raw_insert!(user, "breakfast", 0, "light")
      raw_insert!(user, "lunch", 240, "normal")
      raw_insert!(user, "dinner", 30, "strong")

      assert Repo.aggregate(UserSlotCookingTime, :count) == 3
    end

    test "refuses a slot outside breakfast, lunch and dinner", %{user: user} do
      assert_check_violation("user_slot_cooking_times_slot_check", fn ->
        raw_insert!(user, "snack", 10, "normal")
      end)
    end

    test "refuses minutes below 0", %{user: user} do
      assert_check_violation("user_slot_cooking_times_cooking_time_minutes_check", fn ->
        raw_insert!(user, "lunch", -1, "normal")
      end)
    end

    test "refuses minutes above 240", %{user: user} do
      assert_check_violation("user_slot_cooking_times_cooking_time_minutes_check", fn ->
        raw_insert!(user, "lunch", 241, "normal")
      end)
    end

    test "refuses a Hunger level outside the catalog", %{user: user} do
      assert_check_violation("user_slot_cooking_times_hunger_level_check", fn ->
        raw_insert!(user, "lunch", 10, "ravenous")
      end)
    end

    test "refuses a second row for the same User and slot", %{user: user} do
      raw_insert!(user, "lunch", 10, "normal")

      error = assert_raise Postgrex.Error, fn -> raw_insert!(user, "lunch", 20, "light") end

      assert error.postgres.code == :unique_violation
      assert error.postgres.constraint == "user_slot_cooking_times_user_id_slot_index"
    end

    test "deletes the rows with their User", %{user: user, other: other} do
      {:ok, _} = Accounts.replace_user_slot_cooking_times(user.id, @times)
      {:ok, _} = Accounts.replace_user_slot_cooking_times(other.id, @times)

      Repo.delete_all(from(u in User, where: u.id == ^user.id))

      assert Accounts.list_user_slot_cooking_times(user.id) == []
      assert stored_for(other) == @times
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp insert_user do
    user_with_memberships(%{email: "slot-times-#{Ecto.UUID.generate()}@example.com"}, [])
  end

  defp stored_for(user), do: user.id |> Accounts.list_user_slot_cooking_times() |> stored()

  defp stored(rows) do
    Map.new(rows, fn row ->
      {row.slot,
       %{cooking_time_minutes: row.cooking_time_minutes, hunger_level: row.hunger_level}}
    end)
  end

  defp ids(rows), do: rows |> Enum.map(& &1.id) |> Enum.sort()

  defp raw_insert!(user, slot, minutes, hunger_level) do
    Repo.query!(
      """
      INSERT INTO user_slot_cooking_times
        (id, user_id, slot, cooking_time_minutes, hunger_level, inserted_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
      """,
      [Ecto.UUID.dump!(user.id), slot, minutes, hunger_level]
    )
  end

  defp assert_check_violation(constraint, fun) do
    error = assert_raise Postgrex.Error, fun

    assert error.postgres.code == :check_violation
    assert error.postgres.constraint == constraint
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
