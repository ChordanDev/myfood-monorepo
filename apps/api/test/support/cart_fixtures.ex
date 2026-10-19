defmodule MealPlannerApi.CartFixtures do
  @moduledoc false
  import Ecto.Query
  alias MealPlannerApi.Generation.ServerTestFixtures, as: Fixtures
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Inventory.{InventoryItem, InventoryMutationEvent}
  alias MealPlannerApi.Persistence.{Planning, Shopping}
  alias MealPlannerApi.Persistence.Shopping.{CheckoutSession, ShoppingItem}
  alias MealPlannerApi.Repo

  def fixture do
    {:ok, f} =
      Repo.transaction(fn ->
        suffix = Ecto.UUID.generate()
        account = Fixtures.insert_account("Cart lifecycle #{suffix}")
        now = DateTime.utc_now()

        account =
          account
          |> Account.changeset(%{trial_started_at: now, trial_ends_at: DateTime.add(now, 86_400)})
          |> Repo.update!()

        owner = Fixtures.insert_user_with_membership(account, "cart-owner-#{suffix}@example.com")

        member =
          Fixtures.insert_user_with_membership(
            account,
            "cart-member-#{suffix}@example.com",
            :member
          )

        ingredient = Fixtures.insert_ingredient("Cart ingredient #{suffix}")

        recipe =
          Fixtures.insert_recipe("Cart recipe #{suffix}",
            account_id: account.id,
            user_id: owner.id
          )

        # The recipe needs 500 g of the Ingredient a serving. Today's dinner
        # is two servings, so each Shopping item below is the Shortage of its
        # meal with no Inventory, and a Shopping list read keeps it as it is.
        Fixtures.attach_recipe_ingredient(recipe, ingredient, 500, :g)

        # Two Scheduled meals, today's dinner and tomorrow's: the two Shopping
        # items share the Ingredient and the unit, so the Shopping list groups
        # them, but only one open item is allowed per Scheduled meal.
        [meal, next_meal] =
          for {days_ahead, servings} <- [{0, 2}, {1, 1}] do
            {:ok, meal} =
              Planning.schedule_meal(%{
                account_id: account.id,
                recipe_id: recipe.id,
                date: Date.add(Date.utc_today(), days_ahead),
                slot: :dinner,
                selected_quantity: servings
              })

            meal
          end

        items =
          for {quantity, planned_meal} <- [{1000, meal}, {500, next_meal}] do
            {:ok, item} =
              Shopping.create_shopping_item(%{
                account_id: account.id,
                scheduled_meal_id: planned_meal.id,
                planned_date: planned_meal.date,
                ingredient_id: ingredient.id,
                unit: :g,
                quantity_milli: quantity,
                status: :pending
              })

            item
          end

        %{
          account: account,
          owner: owner,
          member: member,
          ingredient: ingredient,
          recipe: recipe,
          meal: meal,
          next_meal: next_meal,
          items: items,
          actor: %{id: owner.id, account_id: account.id},
          other: %{id: member.id, account_id: account.id}
        }
      end)

    f
  end

  # The confirm payload of a Cart: every list line bought at `quantity`, for
  # 250 cents (nothing when nothing was bought). `nil` sends no lines, so
  # each one is bought at its suggested quantity.
  def payload(cart, quantity \\ 300, type \\ "physical")

  def payload(cart, nil, type),
    do: %{"session_id" => cart.session_id, "checkout_type" => type}

  def payload(cart, quantity, type) do
    lines =
      Enum.map(line_ids(cart), fn line_id ->
        %{
          "item_id" => line_id,
          "quantity_milli" => quantity,
          "total_cents" => if(quantity == 0, do: 0, else: 250)
        }
      end)

    cart |> payload(nil, type) |> Map.put("lines", lines)
  end

  # The list line ids of the reserved items: `"<ingredient_id>:<unit>"` for
  # planned items, the item's own id for a manual one.
  def line_ids(cart) do
    ids = Enum.map(cart.reservations, & &1.item_id)

    from(i in ShoppingItem, where: i.id in ^ids, order_by: i.id)
    |> Repo.all()
    |> Enum.map(fn
      %{source: :manual} = item -> item.id
      item -> "#{item.ingredient_id}:#{item.unit}"
    end)
    |> Enum.uniq()
  end

  # The reserved items as `Cart.remove/3` takes them.
  def reservations(cart) do
    Enum.map(cart.reservations, fn line ->
      %{"item_id" => line.item_id, "reservation_token" => line.reservation_token}
    end)
  end

  def manual_item!(f, attrs) do
    {:ok, item} = Shopping.create_manual_item(Map.put(attrs, :account_id, f.account.id))
    item
  end

  def reserve!(f, actor \\ nil) do
    {:ok, cart} = MealPlannerApi.Cart.reserve(actor || f.actor, Enum.map(f.items, & &1.id))
    cart
  end

  def expire!(cart) do
    Repo.get!(CheckoutSession, cart.session_id)
    |> CheckoutSession.changeset(%{lease_expires_at: DateTime.add(DateTime.utc_now(), -1)})
    |> Repo.update!()
  end

  def events(f),
    do:
      Repo.all(
        from(e in InventoryMutationEvent, where: e.account_id == ^f.account.id, order_by: e.id)
      )

  def stock(f),
    do: Repo.all(from(i in InventoryItem, where: i.account_id == ^f.account.id, order_by: i.id))

  def lines(f),
    do: Repo.all(from(i in ShoppingItem, where: i.account_id == ^f.account.id, order_by: i.id))

  def cleanup(f) do
    MealPlannerApi.Issue38Database.database!()

    # Remove mutable cart state for the migration round-trip, but retain the
    # immutable recipe history and its UUID-scoped ownership roots.
    Repo.transaction(fn ->
      Repo.delete_all(from(e in InventoryMutationEvent, where: e.account_id == ^f.account.id))
      Repo.delete_all(from(i in InventoryItem, where: i.account_id == ^f.account.id))
      Repo.delete_all(from(i in ShoppingItem, where: i.account_id == ^f.account.id))
      Repo.delete_all(from(c in CheckoutSession, where: c.account_id == ^f.account.id))
      Repo.delete_all(from(m in Planning.ScheduledMeal, where: m.account_id == ^f.account.id))
    end)
  end
end
