defmodule MealPlannerApi.Data.ShoppingRepo.UpsertOpenShoppingItemTest do
  @moduledoc """
  Tests for `ShoppingRepo.upsert_open_shopping_item/1`, the write the plan
  confirm rebuild uses: a Shopping list read can store an open Shopping item
  between the rebuild's wipe and its insert, and the rebuild has to win.
  """
  use ExUnit.Case, async: true

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Data.ShoppingRepo
  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    suffix = Ecto.UUID.generate()
    account = Fixtures.insert_account("Upsert open item #{suffix}")
    ingredient = Fixtures.insert_ingredient("Upsert open item ingredient #{suffix}")
    recipe = Fixtures.insert_recipe("Upsert open item recipe #{suffix}", account_id: account.id)

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account.id,
        recipe_id: recipe.id,
        date: Date.utc_today(),
        slot: :dinner
      })

    {:ok, checkout} =
      ShoppingRepo.create_checkout_session(%{
        account_id: account.id,
        status: :draft,
        checkout_type: :physical
      })

    attrs = %{
      account_id: account.id,
      scheduled_meal_id: meal.id,
      planned_date: meal.date,
      ingredient_id: ingredient.id,
      unit: :g,
      quantity_milli: 250,
      checkout_session_id: checkout.id,
      status: :pending
    }

    {:ok, account: account, checkout: checkout, attrs: attrs}
  end

  test "stores a Shopping item when no open one has its planned key", ctx do
    assert {:ok, item} = ShoppingRepo.upsert_open_shopping_item(ctx.attrs)

    assert [stored] = Shopping.list_items_for_account(ctx.account.id)
    assert stored.id == item.id
    assert stored.quantity_milli == 250
    assert stored.checkout_session_id == ctx.checkout.id
  end

  for open_status <- [:pending, :in_cart] do
    test "replaces the #{open_status} Shopping item that has the same planned key", ctx do
      {:ok, derived} =
        ctx.attrs
        |> Map.merge(%{
          quantity_milli: 100,
          checkout_session_id: nil,
          status: unquote(open_status),
          reservation_token: Ecto.UUID.generate()
        })
        |> Shopping.create_shopping_item()

      assert {:ok, item} = ShoppingRepo.upsert_open_shopping_item(ctx.attrs)
      assert item.id == derived.id

      assert [stored] = Shopping.list_items_for_account(ctx.account.id)
      assert stored.id == derived.id
      assert stored.status == :pending
      assert stored.reservation_token == nil
      assert stored.quantity_milli == 250
      assert stored.checkout_session_id == ctx.checkout.id
      assert DateTime.compare(stored.updated_at, derived.updated_at) != :lt
      assert stored.inserted_at == derived.inserted_at
    end
  end

  test "stores a new Shopping item next to closed ones with the same planned key", ctx do
    for closed_status <- [:checked_out, :pending_delivery, :archived] do
      {:ok, _closed} =
        Shopping.create_shopping_item(%{
          ctx.attrs
          | checkout_session_id: nil,
            status: closed_status
        })
    end

    assert {:ok, item} = ShoppingRepo.upsert_open_shopping_item(ctx.attrs)

    items = Shopping.list_items_for_account(ctx.account.id, include_archived: true)
    assert length(items) == 4
    assert [open] = Enum.filter(items, &(&1.status == :pending))
    assert open.id == item.id
  end

  test "returns the changeset when the Shopping item cannot be stored", ctx do
    assert {:error, %Ecto.Changeset{}} =
             ShoppingRepo.upsert_open_shopping_item(%{
               ctx.attrs
               | ingredient_id: Ecto.UUID.generate()
             })

    assert Shopping.list_items_for_account(ctx.account.id) == []
  end
end
