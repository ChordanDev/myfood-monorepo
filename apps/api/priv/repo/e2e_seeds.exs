# Seeds the `e2e` database for the Maestro flows of `apps/mobile/e2e/`:
#
#     MIX_ENV=e2e E2E_LOGIN_EMAIL=... E2E_LOGIN_CODE=... mix run priv/repo/e2e_seeds.exs
#
# `config/runtime.exs` refuses one of the two variables without the other.
#
# It leaves the same data however many times it runs:
#
#   * an Account in a trial that never ends, with a Budget, and its owner,
#     the User of `E2E_LOGIN_EMAIL`, whose onboarding is complete;
#   * four catalog Recipes per Meal slot, with ingredients, so a Planning
#     session has a proposal under the optimizer's variety rules and its
#     Shopping list has items;
#   * none of the data a journey leaves behind: the Account's Planning
#     sessions, Scheduled meals, Shopping list, Cart, Inventory and
#     favorites are deleted, and so are the login codes and request
#     counters of the email. Its device sessions stay, so a signed-in app
#     stays signed in.
#
# Run it with the API stopped, or restart the API after it: a running
# Planning session keeps its state in memory.

import Ecto.Query

alias MealPlannerApi.Persistence.Accounts
alias MealPlannerApi.Persistence.Accounts.Account
alias MealPlannerApi.Persistence.Accounts.AccountMembership
alias MealPlannerApi.Persistence.Accounts.User
alias MealPlannerApi.Persistence.Accounts.UserEmail
alias MealPlannerApi.Persistence.Accounts.UserSlotCookingTime
alias MealPlannerApi.Persistence.Auth.EmailAuthEvent
alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
alias MealPlannerApi.Persistence.Catalog
alias MealPlannerApi.Persistence.Catalog.Ingredient
alias MealPlannerApi.Persistence.Catalog.Recipe
alias MealPlannerApi.Persistence.Catalog.RecipeIngredient
alias MealPlannerApi.Persistence.Catalog.RecipeStep
alias MealPlannerApi.Repo
alias MealPlannerApi.Services.OnboardingService

if Mix.env() not in [:e2e, :test] do
  Mix.raise(
    "priv/repo/e2e_seeds.exs runs in MIX_ENV=e2e (or test, for its tests), not #{Mix.env()}"
  )
end

# A database named for `e2e` only: the seed overwrites shared catalog rows
# and deletes journey data, which must never happen to a `dev` database.
database = Repo.config()[:database]

if Mix.env() == :e2e and not String.ends_with?(database, "_e2e") do
  Mix.raise(
    "priv/repo/e2e_seeds.exs refuses the database #{database}: its name must end in _e2e " <>
      "(set MYFOOD_E2E_DATABASE)"
  )
end

email =
  case System.get_env("E2E_LOGIN_EMAIL") do
    value when is_binary(value) and value != "" -> UserEmail.normalize(value)
    _missing -> Mix.raise("Set E2E_LOGIN_EMAIL to the email the Maestro flows sign in with")
  end

account_attrs = %{
  name: "E2E Account",
  plan: :individual,
  default_budget_cents: 95_000,
  trial_started_at: ~U[2026-01-01 00:00:00Z],
  trial_ends_at: ~U[2099-01-01 00:00:00Z]
}

onboarding = %{
  profile: %{name: "E2E User", household_size: 2, cooking_skill: "intermediate"},
  timezone: "America/Argentina/Buenos_Aires",
  preferences: %{diet: "omnivore", hard_restrictions: [], soft_preferences: []},
  slot_cooking_times:
    Map.new(
      UserSlotCookingTime.slots(),
      &{&1, %{cooking_time_minutes: 30, hunger_level: :normal}}
    )
}

# Four Recipes per Meal slot: a Planning session needs a candidate for every
# slot of every day, and the optimizer allows one Recipe at most twice in any
# 7 days and never in the same slot on consecutive days, so the default 7-day
# Planning Range needs four. The Recipes of a slot share their Ingredients, so
# the Shopping list a journey checks does not depend on which one is planned.
# Quantities are in thousandths of the unit.
recipes = [
  %{
    name: "E2E Avena con banana",
    slots: [:breakfast],
    step: "Cocinar la avena y servir con banana.",
    ingredients: [
      {"Avena", :granos, 80_000, :g},
      {"Banana", :frutas, 1_000, :unit}
    ]
  },
  %{
    name: "E2E Porridge de avena y banana",
    slots: [:breakfast],
    step: "Hervir la avena con agua y sumar la banana pisada.",
    ingredients: [
      {"Avena", :granos, 80_000, :g},
      {"Banana", :frutas, 1_000, :unit}
    ]
  },
  %{
    name: "E2E Avena tostada con banana",
    slots: [:breakfast],
    step: "Tostar la avena en sartén y servir con banana en rodajas.",
    ingredients: [
      {"Avena", :granos, 80_000, :g},
      {"Banana", :frutas, 1_000, :unit}
    ]
  },
  %{
    name: "E2E Licuado de banana y avena",
    slots: [:breakfast],
    step: "Licuar la banana con la avena y servir frío.",
    ingredients: [
      {"Avena", :granos, 80_000, :g},
      {"Banana", :frutas, 1_000, :unit}
    ]
  },
  %{
    name: "E2E Pollo con arroz",
    slots: [:lunch],
    step: "Dorar el pollo y servir con arroz.",
    ingredients: [
      {"Pollo", :carnes, 300_000, :g},
      {"Arroz", :granos, 200_000, :g}
    ]
  },
  %{
    name: "E2E Arroz con pollo",
    slots: [:lunch],
    step: "Cocinar el arroz junto con el pollo en trozos.",
    ingredients: [
      {"Pollo", :carnes, 300_000, :g},
      {"Arroz", :granos, 200_000, :g}
    ]
  },
  %{
    name: "E2E Pollo salteado con arroz",
    slots: [:lunch],
    step: "Saltear el pollo en tiras y servir sobre arroz.",
    ingredients: [
      {"Pollo", :carnes, 300_000, :g},
      {"Arroz", :granos, 200_000, :g}
    ]
  },
  %{
    name: "E2E Bowl de pollo y arroz",
    slots: [:lunch],
    step: "Servir el arroz en un bowl con el pollo a la plancha.",
    ingredients: [
      {"Pollo", :carnes, 300_000, :g},
      {"Arroz", :granos, 200_000, :g}
    ]
  },
  %{
    name: "E2E Fideos con tomate",
    slots: [:dinner],
    step: "Hervir los fideos y mezclar con tomate.",
    ingredients: [
      {"Fideos", :granos, 250_000, :g},
      {"Tomate", :verduras, 200_000, :g}
    ]
  },
  %{
    name: "E2E Fideos al pomodoro",
    slots: [:dinner],
    step: "Hacer una salsa con el tomate y mezclar con los fideos.",
    ingredients: [
      {"Fideos", :granos, 250_000, :g},
      {"Tomate", :verduras, 200_000, :g}
    ]
  },
  %{
    name: "E2E Fideos salteados con tomate",
    slots: [:dinner],
    step: "Saltear los fideos hervidos con tomate en cubos.",
    ingredients: [
      {"Fideos", :granos, 250_000, :g},
      {"Tomate", :verduras, 200_000, :g}
    ]
  },
  %{
    name: "E2E Tomates rellenos de fideos",
    slots: [:dinner],
    step: "Rellenar los tomates con fideos cortos y gratinar.",
    ingredients: [
      {"Fideos", :granos, 250_000, :g},
      {"Tomate", :verduras, 200_000, :g}
    ]
  }
]

# What a journey leaves behind in the Account, in an order the foreign keys
# accept. Deleting the Scheduled meals cascades to the Shopping items,
# removals, cooking sessions and slot favorites of each meal.
journey_tables = ~w(
  scheduled_meals shopping_items shopping_removals prepared_leftovers cooking_sessions
  inventory_mutation_events inventory_items checkout_sessions planning_generation_runs
  planning_sessions favorite_recipes slot_favorites idempotency_keys
)

{:ok, _done} =
  Repo.transaction(fn ->
    user =
      case Repo.one(from(u in User, where: fragment("lower(?)", u.email) == ^email)) do
        %User{} = user ->
          user

        nil ->
          {:ok, account} = Accounts.create_account(account_attrs)

          {:ok, user} =
            Accounts.create_user(%{
              account_id: account.id,
              email: email,
              name: "E2E User",
              role: :owner
            })

          user
      end

    account = Repo.get!(Account, user.account_id)
    {:ok, account} = account |> Account.changeset(account_attrs) |> Repo.update()

    if not Repo.exists?(
         from(m in AccountMembership,
           where: m.user_id == ^user.id,
           where: m.account_id == ^account.id
         )
       ) do
      {:ok, _membership} =
        %AccountMembership{}
        |> AccountMembership.changeset(%{
          account_id: account.id,
          user_id: user.id,
          role: :owner,
          status: :active,
          joined_at: ~U[2026-01-01 00:00:00Z]
        })
        |> Repo.insert()
    end

    {:ok, _completion} = OnboardingService.complete(user.id, account.id, onboarding)

    for table <- journey_tables do
      Repo.delete_all(from(row in table, where: row.account_id == type(^account.id, Ecto.UUID)))
    end

    Repo.delete_all(from(c in EmailVerificationCode, where: c.email == ^email))
    Repo.delete_all(from(e in EmailAuthEvent, where: e.email == ^email))

    for recipe <- recipes do
      catalog_recipe =
        case Repo.one(
               from(r in Recipe,
                 where: r.name == ^recipe.name,
                 where: r.source == :traditional,
                 where: is_nil(r.account_id),
                 where: is_nil(r.superseded_by_id),
                 limit: 1
               )
             ) do
          %Recipe{} = existing ->
            existing

          nil ->
            {:ok, created} =
              Catalog.create_recipe(%{
                name: recipe.name,
                source: :traditional,
                servings: 2,
                suitable_for_slots: recipe.slots
              })

            created
        end

      if not Repo.exists?(from(s in RecipeStep, where: s.recipe_id == ^catalog_recipe.id)) do
        {:ok, _step} =
          Catalog.add_recipe_step(%{
            recipe_id: catalog_recipe.id,
            step_number: 1,
            instructions: recipe.step
          })
      end

      for {name, category, quantity_milli, unit} <- recipe.ingredients do
        # The upsert answers a fresh id when the name already exists, so the
        # row is read back by name.
        {:ok, _ingredient} =
          Catalog.upsert_ingredient_by_name(%{name: name, category: category, allergens: []})

        ingredient = Repo.get_by!(Ingredient, name: name)

        if is_nil(
             Repo.get_by(RecipeIngredient,
               recipe_id: catalog_recipe.id,
               ingredient_id: ingredient.id,
               unit: unit
             )
           ) do
          {:ok, _recipe_ingredient} =
            Catalog.add_recipe_ingredient(%{
              recipe_id: catalog_recipe.id,
              ingredient_id: ingredient.id,
              quantity_milli: quantity_milli,
              unit: unit
            })
        end
      end
    end
  end)

IO.puts("E2E seed data ready for #{email}.")
