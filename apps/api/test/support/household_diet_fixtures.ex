defmodule MealPlannerApi.HouseholdDietFixtures do
  @moduledoc """
  A household Account whose members have different dietary rules (issue
  #311): the requester plans, and the rules of every other active member
  must shape the plan too.

  `household_diet!/2` adds two members to an Account the test already made:

    * an `:active` member with an Excluded ingredient tagged `allergy` and
      the `peanut` Hard restriction;
    * an `:invited` member who excludes the ingredient of the safe recipe.

  And three Recipes of that Account:

    * a safe recipe for lunch and dinner;
    * a recipe with the excluded ingredient and one with a peanut
      ingredient, for breakfast, lunch and dinner.

  Breakfast has only the blocked recipes, so a plan that ignores the active
  member plans one of them there, whatever order the candidates come in. A
  plan that counts the invited member loses the safe recipe.
  """

  alias MealPlannerApi.Data.{RecipeRepo, UserHardRestrictionRepo}
  alias MealPlannerApi.Persistence.Accounts.{AccountMembership, User, UserExcludedIngredient}
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Repo

  @type household :: %{
          member: User.t(),
          invited: User.t(),
          safe_recipe_ids: [Ecto.UUID.t()],
          blocked_recipe_ids: [Ecto.UUID.t()]
        }

  @doc "Adds the members and the Recipes to `account`; `requester` creates the Recipes."
  @spec household_diet!(map(), map()) :: household()
  def household_diet!(account, requester) do
    member = insert_member!(account, :active)
    invited = insert_member!(account, :invited)

    rice = insert_ingredient!("Rice", [])
    shrimp = insert_ingredient!("Shrimp", [])
    peanut = insert_ingredient!("Peanut butter", ["peanut"])

    exclude!(member, shrimp)
    :ok = UserHardRestrictionRepo.replace_codes(member.id, ["peanut"])
    exclude!(invited, rice)

    all_slots = [:breakfast, :lunch, :dinner]
    safe = insert_recipe!(account, requester, "Rice bowl", [:lunch, :dinner], rice)
    shrimp_recipe = insert_recipe!(account, requester, "Shrimp toast", all_slots, shrimp)
    peanut_recipe = insert_recipe!(account, requester, "Peanut noodles", all_slots, peanut)

    %{
      member: member,
      invited: invited,
      safe_recipe_ids: [safe.id],
      blocked_recipe_ids: [shrimp_recipe.id, peanut_recipe.id]
    }
  end

  @doc "A Recipe of `account` with one Ingredient that no rule of the household blocks."
  @spec insert_safe_recipe!(map(), map(), String.t(), [atom()]) :: Catalog.Recipe.t()
  def insert_safe_recipe!(account, requester, name, slots) do
    insert_recipe!(account, requester, name, slots, insert_ingredient!("#{name} base", []))
  end

  @doc "A Recipe of `account` with one Ingredient that `excluded_by` excludes for an allergy."
  @spec insert_excluded_recipe!(map(), map(), map(), String.t(), [atom()]) :: Catalog.Recipe.t()
  def insert_excluded_recipe!(account, requester, excluded_by, name, slots) do
    ingredient = insert_ingredient!("#{name} base", [])
    exclude!(excluded_by, ingredient)
    insert_recipe!(account, requester, name, slots, ingredient)
  end

  defp insert_member!(account, status) do
    user =
      %User{}
      |> User.changeset(%{
        email: "#{Ecto.UUID.generate()}@myfood.local",
        name: "Household #{status}",
        role: :member
      })
      |> Repo.insert!()

    %AccountMembership{}
    |> AccountMembership.changeset(%{
      account_id: account.id,
      user_id: user.id,
      role: :member,
      status: status,
      joined_at: if(status == :active, do: DateTime.utc_now())
    })
    |> Repo.insert!()

    user
  end

  defp insert_ingredient!(name, allergens) do
    {:ok, ingredient} =
      Catalog.create_ingredient(%{
        name: "#{name} #{System.unique_integer([:positive])}",
        category: :otros,
        allergens: allergens
      })

    ingredient
  end

  defp exclude!(user, ingredient) do
    %UserExcludedIngredient{}
    |> UserExcludedIngredient.changeset(%{
      user_id: user.id,
      ingredient_id: ingredient.id,
      reason: :allergy
    })
    |> Repo.insert!()
  end

  defp insert_recipe!(account, requester, name, slots, ingredient) do
    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: requester.id,
        name: name,
        source: :user_created,
        servings: 2,
        suitable_for_slots: slots
      })

    {:ok, _} =
      RecipeRepo.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 100_000,
        unit: :g
      })

    recipe
  end
end
