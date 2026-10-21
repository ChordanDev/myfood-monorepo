defmodule MealPlannerApi.Persistence.Calendar.MealMoveTest do
  use ExUnit.Case, async: false

  import Ecto.Query
  import ExUnit.CaptureLog
  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Calendar.MealMove
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.SlotFavorite
  alias MealPlannerApi.Persistence.Planning.{CookingSession, ScheduledMeal}
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo

  # The Account's today, pinned so no test depends on the wall clock.
  @today ~D[2026-10-08]
  @yesterday ~D[2026-10-07]
  @tomorrow ~D[2026-10-09]
  @later ~D[2026-10-12]

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    %{user: user, account: account} = insert_identity!(plan: :family_4)
    {:ok, user: user, account: account, recipe: recipe!(account, user, "Move recipe")}
  end

  describe "move/5 onto another meal" do
    # The proving check of issue #144: nothing is deleted and inserted again.
    test "swaps both meals and keeps their ids, Cooking sessions and Slot favorites", f do
      {:ok, run} =
        PlanningRepo.create_generation_run(%{
          account_id: f.account.id,
          user_id: f.user.id,
          status: :processing,
          started_at: DateTime.utc_now(),
          input_context: %{}
        })

      other_recipe = recipe!(f.account, f.user, "Other move recipe")

      source =
        meal!(f.account, @tomorrow, :dinner, %{
          recipe_id: f.recipe.id,
          ai_generation_id: run.id,
          selected_quantity: 3
        })

      target = meal!(f.account, @today, :lunch, %{recipe_id: other_recipe.id})

      # A completed session: an active one holds its meal in place (issue #207).
      source_session = cooking_session!(source, :completed)
      target_session = cooking_session!(target, :completed)
      source_favorite = slot_favorite!(f.user, source)
      target_favorite = slot_favorite!(f.user, target)

      assert {:ok, %{moved: moved, displaced: displaced}} =
               MealMove.move(f.account.id, source.id, @today, :lunch, @today)

      assert {moved.id, moved.date, moved.slot} == {source.id, @today, :lunch}
      assert {displaced.id, displaced.date, displaced.slot} == {target.id, @tomorrow, :dinner}

      stored_source = Repo.get!(ScheduledMeal, source.id)
      stored_target = Repo.get!(ScheduledMeal, target.id)
      assert {stored_source.date, stored_source.slot} == {@today, :lunch}
      assert {stored_target.date, stored_target.slot} == {@tomorrow, :dinner}
      assert Repo.aggregate(meals_of(f.account), :count) == 2

      for {before, stored} <- [{source, stored_source}, {target, stored_target}] do
        assert stored.recipe_id == before.recipe_id
        assert stored.recipe_version_id == before.recipe_version_id
        assert stored.recipe_snapshot == before.recipe_snapshot
        assert stored.ai_generation_id == before.ai_generation_id
        assert stored.selected_quantity == before.selected_quantity
      end

      assert stored_source.recipe_version_id != nil
      assert stored_source.ai_generation_id == run.id
      assert stored_source.selected_quantity == 3

      assert Repo.get!(CookingSession, source_session.id).scheduled_meal_id == source.id
      assert Repo.get!(CookingSession, target_session.id).scheduled_meal_id == target.id

      stored_source_favorite = Repo.get!(SlotFavorite, source_favorite.id)
      stored_target_favorite = Repo.get!(SlotFavorite, target_favorite.id)
      assert {stored_source_favorite.date, stored_source_favorite.slot} == {@today, "lunch"}
      assert {stored_target_favorite.date, stored_target_favorite.slot} == {@tomorrow, "dinner"}
      assert stored_source_favorite.scheduled_meal_id == source.id
      assert stored_source_favorite.recipe_id == f.recipe.id
      assert stored_target_favorite.scheduled_meal_id == target.id
      assert stored_target_favorite.recipe_id == other_recipe.id
    end

    test "leaves the meal of another Account at the same date and slot alone", f do
      %{account: other_account} = insert_identity!(plan: :family_4)
      source = meal!(f.account, @tomorrow, :dinner)
      target = meal!(f.account, @today, :lunch)
      foreign = meal!(other_account, @today, :lunch)

      assert {:ok, %{displaced: %{id: displaced_id}}} =
               MealMove.move(f.account.id, source.id, @today, :lunch, @today)

      assert displaced_id == target.id
      assert position(foreign) == {@today, :lunch}
    end

    # The swap frees the source's key by parking the source on another date.
    # A request can put a meal on any date the API parses, so none of those
    # may be the parking date.
    test "a meal on the earliest date a request can name does not stop a swap in its slot", f do
      earliest = ~D[0001-01-01]
      stored = meal!(f.account, earliest, :dinner)
      source = meal!(f.account, @tomorrow, :dinner)
      target = meal!(f.account, @today, :lunch)

      assert {:ok, %{moved: %{id: moved_id}, displaced: %{id: displaced_id}}} =
               MealMove.move(f.account.id, source.id, @today, :lunch, @today)

      assert {moved_id, displaced_id} == {source.id, target.id}
      assert position(source) == {@today, :lunch}
      assert position(target) == {@tomorrow, :dinner}
      assert position(stored) == {earliest, :dinner}
    end
  end

  describe "move/5 into an empty slot" do
    test "moves the meal, keeps its id and displaces nothing", f do
      source = meal!(f.account, @tomorrow, :dinner, %{recipe_id: f.recipe.id})
      favorite = slot_favorite!(f.user, source)

      assert {:ok, %{moved: moved, displaced: nil}} =
               MealMove.move(f.account.id, source.id, @today, :lunch, @today)

      assert {moved.id, moved.date, moved.slot} == {source.id, @today, :lunch}
      assert position(source) == {@today, :lunch}
      assert Repo.aggregate(meals_of(f.account), :count) == 1

      stored_favorite = Repo.get!(SlotFavorite, favorite.id)
      assert {stored_favorite.date, stored_favorite.slot} == {@today, "lunch"}
    end
  end

  describe "move/5 and Shopping items" do
    test "the planned items of both meals follow them to the new date in every status", f do
      source = meal!(f.account, @later, :dinner, %{recipe_id: f.recipe.id})
      target = meal!(f.account, @tomorrow, :lunch, %{recipe_id: f.recipe.id})

      items =
        for status <- [:pending, :in_cart, :removed, :checked_out] do
          shopping_item!(source, status)
        end

      target_item = shopping_item!(target, :pending)

      assert {:ok, _} = MealMove.move(f.account.id, source.id, @tomorrow, :lunch, @today)

      for item <- items do
        stored = Repo.get!(ShoppingItem, item.id)
        assert stored.status == item.status
        assert stored.planned_date == @tomorrow
        assert stored.scheduled_meal_id == source.id
      end

      assert Repo.get!(ShoppingItem, target_item.id).planned_date == @later
      assert Repo.aggregate(items_of(f.account), :count) == 5
    end

    test "an archived item of a meal moved to today is deleted, to be derived again", f do
      skipped = meal!(f.account, @yesterday, :dinner, %{recipe_id: f.recipe.id})
      archived = shopping_item!(skipped, :archived)
      bought = shopping_item!(skipped, :checked_out)

      assert {:ok, _} = MealMove.move(f.account.id, skipped.id, @today, :dinner, @today)

      assert Repo.get(ShoppingItem, archived.id) == nil
      assert Repo.get!(ShoppingItem, bought.id).planned_date == @today
    end

    test "an archived item of a meal moved to a date before today is kept", f do
      skipped = meal!(f.account, @yesterday, :dinner, %{recipe_id: f.recipe.id})
      archived = shopping_item!(skipped, :archived)
      earlier = Date.add(@yesterday, -1)

      assert {:ok, _} = MealMove.move(f.account.id, skipped.id, earlier, :dinner, @today)

      stored = Repo.get!(ShoppingItem, archived.id)
      assert {stored.status, stored.planned_date} == {:archived, earlier}
    end

    test "a slot change inside the same day touches no Shopping item", f do
      source = meal!(f.account, @today, :dinner, %{recipe_id: f.recipe.id})
      target = meal!(f.account, @today, :lunch, %{recipe_id: f.recipe.id})
      items = [shopping_item!(source, :archived), shopping_item!(target, :pending)]

      assert {:ok, _} = MealMove.move(f.account.id, source.id, @today, :lunch, @today)

      for item <- items do
        assert Repo.get!(ShoppingItem, item.id) == item
      end
    end
  end

  describe "move/5 refusals" do
    test "a cooked meal is not moved", f do
      source = meal!(f.account, @tomorrow, :dinner, %{is_cooked: true})
      target = meal!(f.account, @today, :lunch)

      assert {:error, :meal_cooked} =
               MealMove.move(f.account.id, source.id, @today, :lunch, @today)

      assert position(source) == {@tomorrow, :dinner}
      assert position(target) == {@today, :lunch}
    end

    test "a cooked meal at the destination is not displaced", f do
      source = meal!(f.account, @tomorrow, :dinner)
      target = meal!(f.account, @today, :lunch, %{is_cooked: true})

      assert {:error, :target_meal_cooked} =
               MealMove.move(f.account.id, source.id, @today, :lunch, @today)

      assert position(source) == {@tomorrow, :dinner}
      assert position(target) == {@today, :lunch}
    end

    # Issue #395: a meal answered "not cooked" is final, on either side.
    test "a meal answered not cooked is not moved and keeps its answer", f do
      source = answered_not_cooked!(meal!(f.account, Date.add(@today, -3), :dinner))
      target = meal!(f.account, Date.add(@today, 2), :dinner)

      assert {:error, :meal_already_confirmed} =
               MealMove.move(f.account.id, source.id, Date.add(@today, 2), :dinner, @today)

      assert position(source) == {Date.add(@today, -3), :dinner}
      assert position(target) == {Date.add(@today, 2), :dinner}
      assert Repo.get!(ScheduledMeal, source.id).not_cooked_at == source.not_cooked_at
    end

    test "a meal answered not cooked at the destination is not displaced", f do
      source = meal!(f.account, @tomorrow, :dinner)
      target = answered_not_cooked!(meal!(f.account, @yesterday, :lunch))

      assert {:error, :target_meal_already_confirmed} =
               MealMove.move(f.account.id, source.id, @yesterday, :lunch, @today)

      assert position(source) == {@tomorrow, :dinner}
      assert position(target) == {@yesterday, :lunch}
      assert Repo.get!(ScheduledMeal, target.id).not_cooked_at == target.not_cooked_at
    end

    # Issue #207: a meal being cooked stays where it is, on either side.
    test "a meal with an active Cooking session is not moved", f do
      source = meal!(f.account, @today, :dinner)
      target = meal!(f.account, @tomorrow, :lunch)
      session = cooking_session!(source)

      assert {:error, :meal_cooking_in_progress} =
               MealMove.move(f.account.id, source.id, @tomorrow, :lunch, @today)

      assert position(source) == {@today, :dinner}
      assert position(target) == {@tomorrow, :lunch}
      assert Repo.get!(CookingSession, session.id).status == :active
    end

    test "a meal with an active Cooking session at the destination is not displaced", f do
      source = meal!(f.account, @tomorrow, :dinner)
      target = meal!(f.account, @today, :lunch)
      session = cooking_session!(target)

      assert {:error, :target_meal_cooking_in_progress} =
               MealMove.move(f.account.id, source.id, @today, :lunch, @today)

      assert position(source) == {@tomorrow, :dinner}
      assert position(target) == {@today, :lunch}
      assert Repo.get!(CookingSession, session.id).status == :active
    end

    # Issue #337: an active session holds its meal only on the Account's today.
    # A session left unfinished cannot be finished after its day, so it must not
    # pin the meal for good.
    test "a meal whose day passed with an active Cooking session is moved", f do
      source = meal!(f.account, @yesterday, :dinner)
      session = cooking_session!(source)

      assert {:ok, _result} = MealMove.move(f.account.id, source.id, @tomorrow, :lunch, @today)

      assert position(source) == {@tomorrow, :lunch}
      assert Repo.get!(CookingSession, session.id).status == :active
    end

    test "a meal whose day passed with an active Cooking session is displaced", f do
      source = meal!(f.account, @tomorrow, :dinner)
      target = meal!(f.account, @yesterday, :lunch)
      session = cooking_session!(target)

      assert {:ok, _result} = MealMove.move(f.account.id, source.id, @yesterday, :lunch, @today)

      assert position(source) == {@yesterday, :lunch}
      assert position(target) == {@tomorrow, :dinner}
      assert Repo.get!(CookingSession, session.id).status == :active
    end

    test "a future meal with an active Cooking session is moved and displaced", f do
      source = meal!(f.account, @tomorrow, :dinner)
      target = meal!(f.account, @later, :lunch)
      cooking_session!(source)
      cooking_session!(target)

      assert {:ok, _result} = MealMove.move(f.account.id, source.id, @later, :lunch, @today)

      assert position(source) == {@later, :lunch}
      assert position(target) == {@tomorrow, :dinner}
    end

    test "a stale active Cooking session holds its meal again once it is moved to today", f do
      source = meal!(f.account, @yesterday, :dinner)
      cooking_session!(source)

      assert {:ok, _result} = MealMove.move(f.account.id, source.id, @today, :dinner, @today)

      assert {:error, :meal_cooking_in_progress} =
               MealMove.move(f.account.id, source.id, @tomorrow, :dinner, @today)

      assert position(source) == {@today, :dinner}
    end

    test "a completed Cooking session does not hold its meal on either side", f do
      source = meal!(f.account, @today, :dinner)
      target = meal!(f.account, @tomorrow, :lunch)
      cooking_session!(source, :completed)
      cooking_session!(target, :completed)

      assert {:ok, _result} = MealMove.move(f.account.id, source.id, @tomorrow, :lunch, @today)

      assert position(source) == {@tomorrow, :lunch}
      assert position(target) == {@today, :dinner}
    end

    test "a move to the position the meal already has is refused", f do
      source = meal!(f.account, @today, :lunch)

      assert {:error, :same_slot} =
               MealMove.move(f.account.id, source.id, @today, :lunch, @today)
    end

    test "an unknown or malformed meal id is not found", f do
      assert {:error, :meal_not_found} =
               MealMove.move(f.account.id, Ecto.UUID.generate(), @today, :lunch, @today)

      assert {:error, :meal_not_found} =
               MealMove.move(f.account.id, "not-a-uuid", @today, :lunch, @today)
    end

    test "the meal of another Account is not found and nothing changes there", f do
      %{account: other_account} = insert_identity!(plan: :family_4)
      foreign = meal!(other_account, @tomorrow, :dinner)
      foreign_target = meal!(other_account, @today, :lunch)

      assert {:error, :meal_not_found} =
               MealMove.move(f.account.id, foreign.id, @today, :lunch, @today)

      assert position(foreign) == {@tomorrow, :dinner}
      assert position(foreign_target) == {@today, :lunch}
    end

    # No second connection writes here: the unique violation comes from two
    # open items of one meal that only differ in their planned date, so a
    # retry would fail the same way.
    test "stored items that cannot follow the meal roll the move back as not possible", f do
      source = meal!(f.account, @later, :dinner, %{recipe_id: f.recipe.id})
      target = meal!(f.account, @tomorrow, :lunch)
      favorite = slot_favorite!(f.user, source)
      item = shopping_item!(source, :pending)
      shopping_item!(source, :pending, %{planned_date: @today, ingredient_id: item.ingredient_id})

      log =
        capture_log(fn ->
          assert {:error, :move_not_possible} =
                   MealMove.move(f.account.id, source.id, @tomorrow, :lunch, @today)
        end)

      # The log names what fired, for the rows to be found and fixed.
      assert log =~ "calendar meal move not possible"
      assert log =~ "account_id=#{f.account.id}"
      assert log =~ "meal_id=#{source.id}"
      assert log =~ "code=unique_violation"
      assert log =~ "constraint=shopping_items_open_planned_key_index"

      assert position(source) == {@later, :dinner}
      assert position(target) == {@tomorrow, :lunch}
      assert Repo.get!(SlotFavorite, favorite.id).date == @later
      assert Repo.get!(ShoppingItem, item.id).planned_date == @later
    end
  end

  defp recipe!(account, user, name) do
    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: name,
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:lunch, :dinner]
      })

    recipe
  end

  defp meal!(account, date, slot, attrs \\ %{}) do
    {:ok, meal} =
      PlanningRepo.schedule_meal(
        Map.merge(%{account_id: account.id, date: date, slot: slot}, attrs)
      )

    meal
  end

  defp answered_not_cooked!(meal) do
    meal
    |> Ecto.Changeset.change(not_cooked_at: DateTime.utc_now())
    |> Repo.update!()
  end

  defp cooking_session!(meal, status \\ :active) do
    now = DateTime.utc_now()

    {:ok, session} =
      PlanningRepo.create_cooking_session(%{
        account_id: meal.account_id,
        scheduled_meal_id: meal.id,
        status: status,
        started_at: now,
        completed_at: if(status == :completed, do: now)
      })

    session
  end

  defp slot_favorite!(user, meal) do
    %SlotFavorite{}
    |> SlotFavorite.changeset(%{
      account_id: meal.account_id,
      user_id: user.id,
      date: meal.date,
      slot: Atom.to_string(meal.slot),
      scheduled_meal_id: meal.id,
      recipe_id: meal.recipe_id
    })
    |> Repo.insert!()
  end

  # A planned Shopping item of the meal, for an Ingredient of its own unless
  # `attrs` name one.
  defp shopping_item!(meal, status, attrs \\ %{}) do
    attrs =
      Map.merge(
        %{
          account_id: meal.account_id,
          scheduled_meal_id: meal.id,
          planned_date: meal.date,
          quantity_milli: 200,
          unit: :g,
          status: status
        },
        attrs
      )

    %ShoppingItem{}
    |> ShoppingItem.changeset(Map.put_new_lazy(attrs, :ingredient_id, &ingredient_id!/0))
    |> Repo.insert!()
  end

  defp ingredient_id! do
    {:ok, ingredient} =
      Catalog.create_ingredient(%{name: "Move #{Ecto.UUID.generate()}", category: :otros})

    ingredient.id
  end

  defp position(meal) do
    stored = Repo.get!(ScheduledMeal, meal.id)
    {stored.date, stored.slot}
  end

  defp meals_of(account), do: from(m in ScheduledMeal, where: m.account_id == ^account.id)
  defp items_of(account), do: from(i in ShoppingItem, where: i.account_id == ^account.id)
end
