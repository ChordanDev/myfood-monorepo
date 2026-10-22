defmodule MealPlannerApi.PlanningAgentFixtures do
  @moduledoc """
  Fixtures for the planning agent tests (issue #423): an eligible Account
  with members, their restrictions, recipes, and a sandbox that agent
  Planning sessions (their own processes) share with the test.

  Tests that start sessions are `async: false` and call `sandbox_sessions!/0`
  in their setup.
  """

  import ExUnit.Callbacks, only: [on_exit: 1]

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Data.{RecipeRepo, ShoppingRepo, UserHardRestrictionRepo}
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.{AccountMembership, User}
  alias MealPlannerApi.Persistence.Accounts.{UserDietaryProfile, UserExcludedIngredient}
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.RecipeDailyCost
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.PlanningAgent.Consent
  alias MealPlannerApi.Repo
  alias MealPlannerApi.SubscriptionPlanFixtures

  @doc """
  Shares the sandbox with every process for the test, and stops every agent
  Planning session before the sandbox goes, so their terminate callbacks
  still reach the database.
  """
  def sandbox_sessions! do
    owner = Sandbox.start_owner!(Repo, shared: true)

    on_exit(fn ->
      stop_sessions()
      Sandbox.stop_owner(owner)
    end)

    SubscriptionPlanFixtures.ensure_plans!()
    :ok
  end

  @doc "Stops every running agent Planning session."
  def stop_sessions do
    MealPlannerApi.PlanningAgent.SessionSupervisor
    |> DynamicSupervisor.which_children()
    |> Enum.each(fn {_, pid, _, _} ->
      DynamicSupervisor.terminate_child(MealPlannerApi.PlanningAgent.SessionSupervisor, pid)
    end)
  end

  @doc """
  An eligible Account (a trial that covers now) with an active owner.
  Returns `%{account, user, membership}` of the owner.
  """
  def household!(opts \\ []) do
    plan = Repo.get_by!(MealPlannerApi.Subscriptions.Plan, name: "family_4")
    now = DateTime.utc_now()

    trial =
      case Keyword.get(opts, :eligible, true) do
        true -> %{trial_started_at: now, trial_ends_at: DateTime.add(now, 7 * 86_400)}
        false -> %{trial_started_at: DateTime.add(now, -30 * 86_400), trial_ends_at: now}
      end

    account =
      %Account{}
      |> Account.changeset(
        Map.merge(
          %{
            name: "Household #{System.unique_integer([:positive])}",
            plan: :family_4,
            default_budget_cents: Keyword.get(opts, :budget_cents, 0),
            subscription_plan_id: plan.id
          },
          trial
        )
      )
      |> Repo.insert!()

    member!(account, :owner)
  end

  @doc "An active member of `account`. Returns `%{account, user, membership}`."
  def member!(%Account{} = account, role \\ :member) do
    user =
      %User{}
      |> User.changeset(%{
        email: "#{Ecto.UUID.generate()}@myfood.local",
        name: "Member #{System.unique_integer([:positive])}",
        role: role
      })
      |> Repo.insert!()

    membership =
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account.id,
        user_id: user.id,
        role: role,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert!()

    %{account: account, user: user, membership: membership}
  end

  @doc "The attrs of `Session.start/2` for `who` over `range` (default: today and tomorrow)."
  def session_attrs(%{account: account, user: user, membership: membership}, range \\ nil) do
    today = MealPlannerApi.AccountClock.today(account.id)

    %{
      account_id: account.id,
      user_id: user.id,
      membership_id: membership.id,
      range: range || {today, Date.add(today, 1)}
    }
  end

  @doc "Records `user`'s AI-processing consent."
  def consent!(%User{id: id}), do: :ok = Consent.record(id)

  @doc "Sets `user`'s Diet."
  def diet!(%User{id: id}, diet) do
    %UserDietaryProfile{}
    |> UserDietaryProfile.changeset(%{user_id: id, diet_type: diet, macro_goal: :balanced})
    |> Repo.insert!()
  end

  @doc "Sets `user`'s Hard restriction codes."
  def hard_restrictions!(%User{id: id}, codes),
    do: :ok = UserHardRestrictionRepo.replace_codes(id, codes)

  @doc "Excludes `ingredient` for `user`, as an allergy or a dislike."
  def exclude!(%User{id: id}, ingredient, reason \\ :allergy) do
    %UserExcludedIngredient{}
    |> UserExcludedIngredient.changeset(%{
      user_id: id,
      ingredient_id: ingredient.id,
      reason: reason
    })
    |> Repo.insert!()
  end

  @doc "A catalog Ingredient; `allergens: nil` is one nobody reviewed."
  def ingredient!(name, allergens \\ []) do
    {:ok, ingredient} =
      Catalog.create_ingredient(%{
        name: "#{name} #{System.unique_integer([:positive])}",
        category: :otros,
        allergens: allergens
      })

    ingredient
  end

  @doc """
  A Recipe with `ingredients` (default: one reviewed Ingredient with no
  code). It belongs to `account` unless `account` is nil (the catalog).
  """
  def recipe!(account, name, slots, ingredients \\ nil) do
    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account && account.id,
        name: name,
        source: :user_created,
        servings: 2,
        suitable_for_slots: slots
      })

    Enum.each(ingredients || [ingredient!("#{name} base")], fn ingredient ->
      {:ok, _} =
        RecipeRepo.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: ingredient.id,
          quantity_milli: 100_000,
          unit: :g
        })
    end)

    recipe
  end

  @doc "One safe recipe of `account` for each planned slot."
  def recipes_for_every_slot!(account) do
    for slot <- ~w(breakfast lunch dinner), into: %{} do
      {slot, recipe!(account, "A #{slot} dish", [slot])}
    end
  end

  @doc "A Scheduled meal of `account`."
  def scheduled_meal!(account, recipe, date, slot, attrs \\ %{}) do
    {not_cooked_at, attrs} = Map.pop(attrs, :not_cooked_at)

    %ScheduledMeal{}
    |> ScheduledMeal.changeset(
      Map.merge(
        %{account_id: account.id, recipe_id: recipe.id, date: date, slot: slot},
        attrs
      )
    )
    |> Ecto.Changeset.change(not_cooked_at: not_cooked_at)
    |> Repo.insert!()
  end

  @doc """
  Prices `recipe` at `cents` (a `recipe_daily_costs` row), the estimated
  cost its frozen version carries. Call it before the recipe is frozen.
  """
  def recipe_cost!(recipe, cents) do
    {:ok, supermarket} =
      ShoppingRepo.create_supermarket(%{
        name: "Market #{System.unique_integer([:positive])}"
      })

    %RecipeDailyCost{}
    |> RecipeDailyCost.changeset(%{
      recipe_id: recipe.id,
      supermarket_id: supermarket.id,
      total_cents_ars: cents,
      date: Date.utc_today()
    })
    |> Repo.insert!()
  end
end
