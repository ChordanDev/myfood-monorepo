defmodule MealPlannerApi.Generation.ServerTestFixtures do
  @moduledoc """
  Shared fixture builders for `Generation.Server` integration tests.

  These helpers hand-build the entities needed to drive `Server.confirm/2`
  end-to-end through the existing DB layer (`Catalog`, `PlanningRepo`,
  `Data.RecipeRepo`) without dragging in a DataCase — tests that use these
  helpers must declare `async: false` and `setup` with
  `Ecto.Adapters.SQL.Sandbox.checkout(MealPlannerApi.Repo)`.

  Conventions:

    * Recipe `id`s are integers (Ecto autogenerates them).
    * Scheduled meal / proposal / generation_run ids are binary_ids
      (`Ecto.UUID`); both kinds flow through the existing schema unchanged.
    * Slots are inserted into `proposal.proposal_json["slots"]` as plain
      maps with the exact shape `Generation.Server.persist_scheduled_meals/2`
      consumes (`slot_key`, `recipe_id`, `name`, `price_cents`).
  """

  # The whole module, not `only: [assert_receive: 1]`: on Elixir 1.17 the
  # macro expands to a call to `flunk/1` in the caller, which must be
  # imported too.
  import ExUnit.Assertions

  alias MealPlannerApi.Data.{PlanningRepo, RecipeRepo, ShoppingRepo}
  alias MealPlannerApi.Persistence.Accounts.Account, as: PersistenceAccount
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.Ingredient
  alias MealPlannerApi.Persistence.Catalog.Recipe
  alias MealPlannerApi.Persistence.Planning.PlanningProposal
  alias MealPlannerApi.Persistence.Planning.PlanningGenerationRun
  alias MealPlannerApi.Persistence.Shopping.CheckoutSession
  alias MealPlannerApi.Persistence.Shopping.ShoppingItem
  alias MealPlannerApi.Repo

  # How long `stop_generation_server/1` waits for the generation a server is
  # running. Half of the default timeout of an ExUnit test.
  @pipeline_timeout_ms 30_000

  @doc "Insert an Account backed by the `:individual` subscription plan."
  @spec insert_account(String.t()) :: PersistenceAccount.t()
  def insert_account(name) do
    plan = Repo.get_by!(MealPlannerApi.Subscriptions.Plan, name: "family_4")

    {:ok, account} =
      %PersistenceAccount{}
      |> PersistenceAccount.changeset(%{
        name: name,
        plan: :family_4,
        default_budget_cents: 0,
        subscription_plan_id: plan.id
      })
      |> Repo.insert()

    account
  end

  @doc "Insert a User with one `:active` membership on the given account."
  @spec insert_user_with_membership(PersistenceAccount.t(), String.t(), atom()) ::
          PersistenceUser.t()
  def insert_user_with_membership(account, email, role \\ :owner) do
    user =
      %PersistenceUser{}
      |> PersistenceUser.changeset(%{email: email, name: email, role: role})
      |> Repo.insert!()

    %AccountMembership{}
    |> AccountMembership.changeset(%{
      account_id: account.id,
      user_id: user.id,
      role: role,
      status: :active,
      joined_at: DateTime.utc_now()
    })
    |> Repo.insert!()

    user
  end

  @doc "Insert an Ingredient with the given name."
  @spec insert_ingredient(String.t()) :: Ingredient.t()
  def insert_ingredient(name) do
    {:ok, ingredient} = Catalog.create_ingredient(%{name: name, category: :otros})
    ingredient
  end

  @doc """
  Insert a Recipe, optionally associated with `account_id` and `user_id`,
  and return the persisted struct.
  """
  @spec insert_recipe(String.t(), keyword()) :: Recipe.t()
  def insert_recipe(name, opts \\ []) do
    base = %{
      name: name,
      description: "Test recipe: #{name}",
      servings: 2,
      cooking_time_minutes: 30,
      suitable_for_slots: ["lunch", "dinner"],
      source: :user_created
    }

    base =
      case Keyword.fetch(opts, :account_id) do
        {:ok, account_id} -> Map.put(base, :account_id, account_id)
        :error -> base
      end

    base =
      case Keyword.fetch(opts, :created_by_user_id) do
        {:ok, user_id} -> Map.put(base, :created_by_user_id, user_id)
        :error -> base
      end

    {:ok, recipe} = Catalog.create_recipe(base)
    recipe
  end

  @doc """
  Attach a `recipe_ingredients` row linking `recipe` to `ingredient` with the
  given quantity and unit.
  """
  @spec attach_recipe_ingredient(Recipe.t(), Ingredient.t(), pos_integer(), atom()) :: any()
  def attach_recipe_ingredient(recipe, ingredient, quantity_milli, unit) do
    {:ok, _} =
      RecipeRepo.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: quantity_milli,
        unit: unit
      })
  end

  @doc """
  Build a `:processing` generation_run + `:pending` proposal owned by
  `account`/`user`, optionally preloaded with `slots` in the `proposal_json`.
  """
  @spec insert_proposal_with_slots(PersistenceAccount.t(), PersistenceUser.t(), [map()]) ::
          {PlanningGenerationRun.t(), PlanningProposal.t()}
  def insert_proposal_with_slots(account, user, slots) when is_list(slots) do
    {:ok, run} =
      PlanningRepo.create_generation_run(%{
        account_id: account.id,
        user_id: user.id,
        status: :processing,
        started_at: DateTime.utc_now(),
        input_context: %{}
      })

    {:ok, proposal} =
      PlanningRepo.create_proposal(%{
        generation_run_id: run.id,
        proposal_json: %{slots: slots, generated_at: DateTime.utc_now() |> DateTime.to_iso8601()},
        status: :pending
      })

    {run, proposal}
  end

  @doc "Slot builder mirroring the shape consumed by `persist_scheduled_meals/2`."
  @spec slot(Date.t(), atom(), pos_integer()) :: map()
  def slot(date, slot, recipe_id) do
    %{
      slot_key: "#{Date.to_iso8601(date)}_#{slot}",
      date: Date.to_iso8601(date),
      slot: Atom.to_string(slot),
      recipe_id: recipe_id,
      recipe_name: "Recipe #{recipe_id}",
      price_cents: 1000
    }
  end

  @doc "Total persisted CheckoutSession rows for an account."
  @spec count_checkout_sessions(PersistenceAccount.t()) :: non_neg_integer()
  def count_checkout_sessions(account) do
    ShoppingRepo.list_checkout_sessions(account.id) |> length()
  end

  @doc "Total persisted ShoppingItem rows across all of an account's sessions."
  @spec count_shopping_items(PersistenceAccount.t()) :: non_neg_integer()
  def count_shopping_items(account) do
    account.id
    |> ShoppingRepo.list_checkout_sessions()
    |> Enum.flat_map(&ShoppingRepo.list_shopping_items/1)
    |> length()
  end

  @doc "Fetch a CheckoutSession struct for direct assertions."
  @spec get_session(binary()) :: CheckoutSession.t() | nil
  def get_session(id), do: Repo.get(CheckoutSession, id)

  @doc "Fetch a ShoppingItem struct for direct assertions."
  @spec get_item(binary()) :: ShoppingItem.t() | nil
  def get_item(id), do: Repo.get(ShoppingItem, id)

  @doc """
  Stop the generation server that a cold `Server.start_generation/4` started
  for the account, once the generation it is running has finished.

  Such a server lives under the application supervision tree, so nothing
  stops it when the test ends, and it runs the generation pipeline in its
  own process on the sandbox connection of the test. Call this at the end of
  the test body, while the test process still owns the connection.

  The wait is `:sys.get_state/2`: the server takes its messages in the order
  they arrived, so it answers after every message that was already in its
  mailbox, the `:run_optimization` it sent itself included, and the pipeline
  has left the database by then. The timeout is explicit and generous,
  because `Server.get_status/1` only offers the 5 second default of
  `GenServer.call/2`; a pipeline slower than that fails the test here, with
  the exit of the call.

  What it does not cover: a message the server handles before the wait may
  queue another generation behind it (a chat modification does), and that
  one would be cut by the stop.
  """
  @spec stop_generation_server(Ecto.UUID.t()) :: :ok
  def stop_generation_server(account_id) do
    [{pid, _value}] =
      Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account_id})

    ref = Process.monitor(pid)
    %{account_id: ^account_id} = :sys.get_state(pid, @pipeline_timeout_ms)

    :ok = DynamicSupervisor.terminate_child(MealPlannerApi.Generation.ServerSupervisor, pid)
    assert_receive {:DOWN, ^ref, :process, ^pid, _reason}

    :ok
  end
end
