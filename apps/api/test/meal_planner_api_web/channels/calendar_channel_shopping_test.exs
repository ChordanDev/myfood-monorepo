defmodule MealPlannerApiWeb.CalendarChannelShoppingTest do
  @moduledoc """
  `upsert_meal` updates a Scheduled meal in place, so its Shopping items outlive a recipe
  swap unless the update drops them. These tests read the list back through
  `ShoppingService.get_shopping_list/2`, the same path as `GET /api/shopping-list`.
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.ShoppingService
  alias MealPlannerApiWeb.{CalendarChannel, UserSocket}

  setup do
    {:ok, user, account, token} = issue_identity_and_token("u_cal_shop", "acct_cal_shop")
    {:ok, socket} = connect(UserSocket, %{"token" => token})
    {:ok, _reply, socket} = subscribe_and_join(socket, CalendarChannel, "calendar:#{account.id}")

    old_ingredient = create_ingredient("Old recipe ingredient")
    new_ingredient = create_ingredient("New recipe ingredient")

    %{
      socket: socket,
      account: account,
      shopper: %{id: user.id, account_id: account.id},
      date: Date.add(Date.utc_today(), 1),
      old_ingredient: old_ingredient,
      new_ingredient: new_ingredient,
      old_recipe: create_recipe(account, user, "Old recipe", old_ingredient),
      new_recipe: create_recipe(account, user, "New recipe", new_ingredient)
    }
  end

  describe "upsert_meal that swaps the recipe of a Scheduled meal" do
    test "leaves only the new recipe's ingredients on the Shopping list", ctx do
      meal_id = upsert_meal(ctx, ctx.old_recipe)
      assert listed_ingredient_ids(ctx) == [ctx.old_ingredient.id]

      assert upsert_meal(ctx, ctx.new_recipe) == meal_id

      assert listed_ingredient_ids(ctx) == [ctx.new_ingredient.id]
    end

    test "drops an old recipe's item that was already in the cart", ctx do
      meal_id = upsert_meal(ctx, ctx.old_recipe)
      assert listed_ingredient_ids(ctx) == [ctx.old_ingredient.id]

      [item] = items_for_meal(meal_id)
      {:ok, _item} = Shopping.update_shopping_item(item, %{status: :in_cart})

      upsert_meal(ctx, ctx.new_recipe)

      assert listed_ingredient_ids(ctx) == [ctx.new_ingredient.id]
    end

    test "keeps the closed items of the old recipe untouched", ctx do
      meal_id = upsert_meal(ctx, ctx.old_recipe)
      assert listed_ingredient_ids(ctx) == [ctx.old_ingredient.id]

      [open_item] = items_for_meal(meal_id)

      closed_items =
        for status <- [:pending_delivery, :checked_out, :archived] do
          {:ok, item} =
            Shopping.create_shopping_item(%{
              account_id: ctx.account.id,
              scheduled_meal_id: meal_id,
              planned_date: ctx.date,
              ingredient_id: ctx.old_ingredient.id,
              quantity_milli: 250,
              unit: :g,
              status: status
            })

          item
        end

      upsert_meal(ctx, ctx.new_recipe)

      assert Repo.get(ShoppingItem, open_item.id) == nil

      for closed <- closed_items do
        kept = Repo.get!(ShoppingItem, closed.id)

        assert Map.take(kept, [:status, :planned_date, :ingredient_id, :quantity_milli]) ==
                 Map.take(closed, [:status, :planned_date, :ingredient_id, :quantity_milli])
      end
    end

    test "keeps the open items when the recipe does not change", ctx do
      meal_id = upsert_meal(ctx, ctx.old_recipe)
      assert listed_ingredient_ids(ctx) == [ctx.old_ingredient.id]

      [item] = items_for_meal(meal_id)
      {:ok, _item} = Shopping.update_shopping_item(item, %{status: :in_cart})

      upsert_meal(ctx, ctx.old_recipe)

      assert [%{id: id, status: :in_cart}] = items_for_meal(meal_id)
      assert id == item.id
    end
  end

  defp upsert_meal(ctx, recipe) do
    ref =
      push(ctx.socket, "upsert_meal", %{
        "date" => Date.to_iso8601(ctx.date),
        "slot" => "lunch",
        "recipe_id" => recipe.id
      })

    assert_reply(ref, :ok, %{meal_id: meal_id})
    meal_id
  end

  defp listed_ingredient_ids(ctx) do
    {:ok, list} =
      ShoppingService.get_shopping_list(ctx.shopper, %{
        "from_date" => Date.to_iso8601(Date.utc_today()),
        "to_date" => Date.to_iso8601(Date.add(ctx.date, 1))
      })

    list.items |> Enum.flat_map(& &1.lines) |> Enum.map(& &1.ingredient_id) |> Enum.sort()
  end

  defp items_for_meal(meal_id) do
    import Ecto.Query, only: [from: 2]

    Repo.all(from(i in ShoppingItem, where: i.scheduled_meal_id == ^meal_id))
  end

  defp create_ingredient(name) do
    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "#{name} #{System.unique_integer([:positive])}",
        category: :carnes,
        calories_per_100: 250,
        protein_g_per_100: Decimal.new("26.0"),
        carbs_g_per_100: Decimal.new("0.0"),
        fat_g_per_100: Decimal.new("15.0")
      })

    ingredient
  end

  defp create_recipe(account, user, name, ingredient) do
    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: name,
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:lunch]
      })

    {:ok, _recipe_ingredient} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 500,
        unit: :g
      })

    recipe
  end
end
