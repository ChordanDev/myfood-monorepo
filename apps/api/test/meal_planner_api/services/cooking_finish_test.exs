defmodule MealPlannerApi.Services.CookingFinishTest do
  @moduledoc """
  Cooking session start and finish (issue #35). "Today" is the Account's day
  (`AccountClock`), so every test passes the instant it needs instead of
  depending on the wall clock.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory.{InventoryItem, InventoryMutationEvent}
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.CookingService

  # 23:30 UTC on the 8th is already the 9th in Auckland (UTC+13 in October).
  @instant ~U[2026-10-08 23:30:00Z]
  @utc_day ~D[2026-10-08]
  @auckland_day ~D[2026-10-09]

  setup do
    %{user: user, account: account} = insert_identity!(plan: :family_4)
    account = MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(account, :eligible)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Finish recipe",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    ingredients =
      for n <- 1..2 do
        {:ok, ingredient} =
          Catalog.upsert_ingredient_by_name(%{
            name: "Finish #{Ecto.UUID.generate()} #{n}",
            category: :otros
          })

        {:ok, _} =
          Catalog.add_recipe_ingredient(%{
            recipe_id: recipe.id,
            ingredient_id: ingredient.id,
            quantity_milli: 200,
            unit: :g
          })

        ingredient
      end
      |> Enum.sort_by(& &1.id)

    {:ok,
     user: user,
     account: account,
     recipe: recipe,
     ingredients: ingredients,
     actor: %{id: user.id, account_id: account.id, plan: :family_4}}
  end

  defp set_timezone!(account, timezone) do
    account |> Account.changeset(%{timezone: timezone}) |> Repo.update!()
  end

  defp meal!(f, date, slot \\ :dinner) do
    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: f.account.id,
        date: date,
        slot: slot,
        recipe_id: f.recipe.id
      })

    meal
  end

  defp lot!(f, ingredient, attrs) do
    %InventoryItem{}
    |> InventoryItem.changeset(
      Map.merge(
        %{
          account_id: f.account.id,
          ingredient_id: ingredient.id,
          quantity_milli: 1000,
          unit: :g,
          source_kind: :planned,
          last_mutation_at: DateTime.utc_now(),
          expired_at: ~U[2026-10-20 12:00:00Z]
        },
        attrs
      )
    )
    |> Repo.insert!()
  end

  defp start!(f, meal, now \\ @instant) do
    {:ok, session} = CookingService.start_session(f.actor, meal.id, now)
    session
  end

  defp events(f) do
    Repo.all(
      from(e in InventoryMutationEvent, where: e.account_id == ^f.account.id, order_by: e.id)
    )
  end

  defp start(f, meal), do: CookingService.start_session(f.actor, meal.id, @instant)

  describe "start_session/3" do
    test "a meal scheduled for the Account's today starts", f do
      meal = meal!(f, @utc_day)
      assert {:ok, %{scheduled_meal_id: id, status: "active"}} = start(f, meal)
      assert id == meal.id
    end

    test "a meal on another day is refused with cooking_chat_unavailable", f do
      yesterday = meal!(f, Date.add(@utc_day, -1), :lunch)
      tomorrow = meal!(f, Date.add(@utc_day, 1), :dinner)

      assert {:error, :cooking_chat_unavailable} = start(f, yesterday)
      assert {:error, :cooking_chat_unavailable} = start(f, tomorrow)
    end

    test "moving a meal to today makes it eligible", f do
      meal = meal!(f, Date.add(@utc_day, 3))
      assert {:error, :cooking_chat_unavailable} = start(f, meal)

      meal |> ScheduledMeal.changeset(%{date: @utc_day}) |> Repo.update!()
      assert {:ok, _session} = start(f, meal)
    end

    test "today follows the Account's timezone, not UTC", f do
      set_timezone!(f.account, "Pacific/Auckland")
      utc_day_meal = meal!(f, @utc_day, :lunch)
      local_day_meal = meal!(f, @auckland_day, :dinner)

      assert {:error, :cooking_chat_unavailable} = start(f, utc_day_meal)
      assert {:ok, _session} = start(f, local_day_meal)
    end

    test "an unknown or malformed meal id is scheduled_meal_not_found", f do
      assert {:error, :scheduled_meal_not_found} =
               CookingService.start_session(f.actor, Ecto.UUID.generate(), @instant)

      assert {:error, :scheduled_meal_not_found} =
               CookingService.start_session(f.actor, "not-a-uuid", @instant)
    end

    test "a meal of another Account is scheduled_meal_not_found", f do
      %{user: other_user, account: other} = insert_identity!(plan: :family_4)
      other = MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(other, :eligible)

      {:ok, recipe} =
        Catalog.create_recipe(%{
          account_id: other.id,
          created_by_user_id: other_user.id,
          name: "Foreign",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [:dinner]
        })

      {:ok, foreign} =
        Planning.schedule_meal(%{
          account_id: other.id,
          date: @utc_day,
          slot: :dinner,
          recipe_id: recipe.id
        })

      assert {:error, :scheduled_meal_not_found} = start(f, foreign)
    end
  end

  describe "finish_session/3" do
    test "marks the meal cooked, consumes FEFO lots, removes open shopping items", f do
      [first, second] = f.ingredients
      meal = meal!(f, @utc_day)
      session = start!(f, meal)

      early = lot!(f, first, %{quantity_milli: 150, expired_at: ~U[2026-10-10 12:00:00Z]})
      late = lot!(f, first, %{quantity_milli: 1000, expired_at: ~U[2026-10-25 12:00:00Z]})
      other = lot!(f, second, %{quantity_milli: 500})

      open =
        for {status, ingredient} <- [{:pending, first}, {:in_cart, second}] do
          {:ok, item} =
            Shopping.create_shopping_item(%{
              account_id: f.account.id,
              scheduled_meal_id: meal.id,
              planned_date: @utc_day,
              ingredient_id: ingredient.id,
              quantity_milli: 200,
              unit: :g,
              status: status
            })

          item
        end

      {:ok, closed} =
        Shopping.create_shopping_item(%{
          account_id: f.account.id,
          scheduled_meal_id: meal.id,
          planned_date: @utc_day,
          ingredient_id: first.id,
          quantity_milli: 200,
          unit: :g,
          status: :checked_out
        })

      assert {:ok, result} = CookingService.finish_session(f.actor, session.session_id, @instant)

      assert %{scheduled_meal: scheduled_meal, inventory_mutations: mutations, shortages: []} =
               result

      assert scheduled_meal.id == meal.id
      assert scheduled_meal.is_cooked == true
      assert scheduled_meal.is_skipped == false

      assert Repo.get!(ScheduledMeal, meal.id).is_cooked
      assert Repo.get!(InventoryItem, early.id).quantity_milli == 0
      assert Repo.get!(InventoryItem, late.id).quantity_milli == 950
      assert Repo.get!(InventoryItem, other.id).quantity_milli == 300

      # One mutation per lot touched: early (150) and late (50) for the first
      # ingredient, one lot for the second.
      assert length(mutations) == 3
      assert length(events(f)) == 3

      by_lot = Map.new(mutations, &{&1.inventory_item_id, &1})
      assert %{ingredient_id: id, unit: "g"} = by_lot[early.id]
      assert id == first.id

      assert %{quantity_before_milli: 150, quantity_delta_milli: -150, quantity_after_milli: 0} =
               by_lot[early.id]

      assert %{quantity_before_milli: 1000, quantity_delta_milli: -50, quantity_after_milli: 950} =
               by_lot[late.id]

      assert %{quantity_delta_milli: -200, quantity_after_milli: 300} = by_lot[other.id]

      for event <- events(f) do
        assert event.trigger_type == :cooking
        assert event.source_user_id == f.user.id
      end

      for item <- open, do: assert(Repo.get(ShoppingItem, item.id) == nil)
      assert Repo.get(ShoppingItem, closed.id)
    end

    test "clamps at zero and reports a shortage per ingredient", f do
      [first, second] = f.ingredients
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      short = lot!(f, first, %{quantity_milli: 150})

      assert {:ok, %{inventory_mutations: [mutation], shortages: shortages}} =
               CookingService.finish_session(f.actor, session.session_id, @instant)

      assert mutation.inventory_item_id == short.id
      assert mutation.quantity_delta_milli == -150
      assert mutation.quantity_after_milli == 0
      assert Repo.get!(InventoryItem, short.id).quantity_milli == 0

      assert Enum.sort_by(shortages, & &1.ingredient_id) ==
               Enum.sort_by(
                 [
                   %{
                     ingredient_id: first.id,
                     ingredient_name: first.name,
                     unit: "g",
                     requested_milli: 200,
                     missing_milli: 50
                   },
                   %{
                     ingredient_id: second.id,
                     ingredient_name: second.name,
                     unit: "g",
                     requested_milli: 200,
                     missing_milli: 200
                   }
                 ],
                 & &1.ingredient_id
               )

      assert Repo.get!(ScheduledMeal, meal.id).is_cooked
      assert length(events(f)) == 1
    end

    test "lot usability uses the Account's day, not the UTC day", f do
      [first, _second] = f.ingredients
      set_timezone!(f.account, "Pacific/Auckland")
      meal = meal!(f, @auckland_day)
      session = start!(f, meal)

      # Expired on the 8th: usable by the UTC day, expired on the Auckland 9th.
      stale = lot!(f, first, %{expired_at: ~U[2026-10-08 12:00:00Z]})
      fresh = lot!(f, first, %{expired_at: ~U[2026-10-12 12:00:00Z]})

      assert {:ok, %{inventory_mutations: [mutation]}} =
               CookingService.finish_session(f.actor, session.session_id, @instant)

      assert mutation.inventory_item_id == fresh.id
      assert Repo.get!(InventoryItem, stale.id).quantity_milli == 1000
    end

    test "a second finish is cooking_already_finished and changes nothing", f do
      [first, _] = f.ingredients
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      lot = lot!(f, first, %{})

      assert {:ok, _} = CookingService.finish_session(f.actor, session.session_id, @instant)
      before_events = events(f)

      assert {:error, :cooking_already_finished} =
               CookingService.finish_session(f.actor, session.session_id, @instant)

      assert events(f) == before_events
      assert Repo.get!(InventoryItem, lot.id).quantity_milli == 800
    end

    test "a meal already marked cooked refuses a new session's finish", f do
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      meal |> ScheduledMeal.changeset(%{is_cooked: true}) |> Repo.update!()

      assert {:error, :cooking_already_finished} =
               CookingService.finish_session(f.actor, session.session_id, @instant)

      assert events(f) == []
    end

    test "a missing or malformed session id is session_not_found", f do
      assert {:error, :session_not_found} =
               CookingService.finish_session(f.actor, Ecto.UUID.generate(), @instant)

      assert {:error, :session_not_found} =
               CookingService.finish_session(f.actor, "not-a-uuid", @instant)
    end

    test "steps and questions on a finished session are cooking_session_not_active", f do
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      step_id = Ecto.UUID.generate()
      assert {:ok, _} = CookingService.finish_session(f.actor, session.session_id, @instant)

      assert {:error, :cooking_session_not_active} =
               CookingService.track_step(f.actor, session.session_id, step_id, :started)

      assert {:error, :cooking_session_not_active} =
               CookingService.answer_question(f.actor, session.session_id, "hola")
    end
  end
end
