defmodule MealPlannerApiWeb.CalendarConfirmAccessTest do
  @moduledoc """
  The access rule of `POST /api/calendar/meals/:id/confirm` (issue #397).
  Consuming Inventory from the calendar follows the access enforcement
  switch: with it on, an Account that is not eligible is refused; with it
  off, it confirms a past meal as cooked and its Inventory is consumed.

  Not async: the tests set `:revenuecat_access_enforcement`, a global setting,
  and fixture Accounts carry no trial, so turning it on while async tests run
  would refuse their requests.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query, only: [from: 2]
  import MealPlannerApi.AccountClockFixtures
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory.{InventoryItem, InventoryMutationEvent}
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.ChannelHelpers

  setup do
    %{token: token, user: user, account: account} =
      insert_identity_with_token!(plan: :family_4)

    today = pin_account_to_midday!(account)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Expired confirm recipe",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:lunch]
      })

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Expired confirm #{Ecto.UUID.generate()}",
        category: :otros
      })

    {:ok, _} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 200,
        unit: :g
      })

    lot =
      %InventoryItem{}
      |> InventoryItem.changeset(%{
        account_id: account.id,
        ingredient_id: ingredient.id,
        quantity_milli: 1000,
        unit: :g,
        source_kind: :planned,
        last_mutation_at: DateTime.utc_now(),
        expired_at: DateTime.add(DateTime.utc_now(), 30 * 86_400)
      })
      |> Repo.insert!()

    {:ok, meal} =
      Calendar.upsert_scheduled_meal(account.id, %{
        date: Date.add(today, -1),
        slot: :lunch,
        recipe_id: recipe.id
      })

    _ = ChannelHelpers.persist_trial_window!(Repo.reload!(account), :expired)

    previous = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)

    on_exit(fn ->
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, previous)
    end)

    %{token: token, account_id: account.id, lot: lot, meal: meal}
  end

  test "switch on: an expired Account is refused with 403 trial_expired and nothing is consumed",
       f do
    Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

    conn = confirm(f.token, f.meal.id)

    assert %{"error" => %{"code" => "trial_expired"}} = json_response(conn, 403)
    assert Repo.get!(InventoryItem, f.lot.id).quantity_milli == 1000
    assert mutation_events(f) == []

    stored = Repo.get!(ScheduledMeal, f.meal.id)
    refute stored.is_cooked
    assert stored.not_cooked_at == nil
  end

  test "switch off: an expired Account confirms a past meal as cooked and its Inventory is consumed",
       f do
    Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, false)

    conn = confirm(f.token, f.meal.id)

    assert %{"data" => %{"scheduledMeal" => %{"isCooked" => true}}} = json_response(conn, 200)
    assert Repo.get!(InventoryItem, f.lot.id).quantity_milli == 800

    assert [%{trigger_type: :cooking, operation: :subtract, quantity_delta_milli: -200}] =
             mutation_events(f)

    assert Repo.get!(ScheduledMeal, f.meal.id).is_cooked
  end

  defp confirm(token, meal_id) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> post("/api/calendar/meals/#{meal_id}/confirm", %{"cooked" => true})
  end

  defp mutation_events(f),
    do: Repo.all(from(e in InventoryMutationEvent, where: e.account_id == ^f.account_id))
end
