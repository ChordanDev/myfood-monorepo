defmodule MealPlannerApiWeb.RecipeControllerTest do
  @moduledoc """
  `GET /api/recipes/:id` (issue #32): the projection of the frozen Recipe
  version, its key sets against the payload fixture the mobile app is tested
  with, and the errors in the envelope.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers
  import MealPlannerApiWeb.ChannelHelpers, only: [persist_trial_window!: 2]

  alias MealPlannerApi.Persistence.{Catalog, Shopping}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.RecipeVersions

  # The frozen payload the mobile recipe screen is tested against. The key
  # sets asserted below keep it from drifting away from the route.
  @fixture_path Path.expand(
                  "../../../../mobile/src/features/recipe/fixtures/recipeDetail.json",
                  __DIR__
                )

  setup do
    user =
      user_with_memberships(%{email: "detail-#{Ecto.UUID.generate()}@example.com"}, [
        {%{plan: :family_4, name: "Detail household"}, :owner}
      ])

    membership = hd(user.memberships)
    persist_trial_window!(membership.account, :eligible)

    {:ok, potato} = Catalog.create_ingredient(%{name: "Detail potato", category: :verduras})
    {:ok, oil} = Catalog.create_ingredient(%{name: "Detail oil", category: :no_perecederos})
    {:ok, egg} = Catalog.create_ingredient(%{name: "Detail egg", category: :otros})

    %{
      user: user,
      account: membership.account,
      token: issue_access_v2_token(user, membership),
      potato: potato,
      oil: oil,
      egg: egg
    }
  end

  describe "GET /api/recipes/:id" do
    test "responds with the projection of the frozen version of a catalog recipe", f do
      recipe = recipe!(f, %{account_id: nil, source: :traditional})

      {:ok, supermarket} =
        Shopping.upsert_supermarket_by_name(%{name: "Detail market", chain: "Detail chain"})

      {:ok, _} =
        Catalog.upsert_recipe_daily_cost(%{
          recipe_id: recipe.id,
          supermarket_id: supermarket.id,
          total_cents_ars: 385_000,
          date: Date.utc_today()
        })

      data = f |> request(recipe.id) |> json_response(200) |> Map.fetch!("data")

      assert Map.delete(data, "ingredients") == %{
               "id" => recipe.id,
               "recipeVersionId" => RecipeVersions.freeze(recipe.id).id,
               "successorRecipeId" => nil,
               "source" => "traditional",
               "name" => "Detail tortilla",
               "description" => "Potato and egg tortilla",
               "servings" => 4,
               "durationMinutes" => 40,
               "steps" => [
                 %{"order" => 1, "text" => "Slice the potatoes", "durationMinutes" => 15},
                 %{"order" => 2, "text" => "Fry them in the oil", "durationMinutes" => 15},
                 %{"order" => 3, "text" => "Add the eggs and set", "durationMinutes" => nil}
               ],
               "estimatedCostCents" => 385_000,
               "tags" => [],
               "imageUrl" => nil,
               "theme" => nil
             }

      # The snapshot orders its ingredient lines by their own id.
      assert Enum.sort_by(data["ingredients"], & &1["name"]) == [
               %{
                 "ingredientId" => f.egg.id,
                 "name" => "Detail egg",
                 "category" => "otros",
                 "quantityMilli" => 4000,
                 "unit" => "unit"
               },
               %{
                 "ingredientId" => f.oil.id,
                 "name" => "Detail oil",
                 "category" => "no_perecederos",
                 "quantityMilli" => 60_000,
                 "unit" => "ml"
               },
               %{
                 "ingredientId" => f.potato.id,
                 "name" => "Detail potato",
                 "category" => "verduras",
                 "quantityMilli" => 500_000,
                 "unit" => "g"
               }
             ]
    end

    test "answers a cost of 0 for a recipe no daily cost was computed for", f do
      recipe = recipe!(f)

      assert %{"estimatedCostCents" => 0} =
               f |> request(recipe.id) |> json_response(200) |> Map.fetch!("data")
    end

    test "has exactly the key sets of the frozen mobile payload fixture", f do
      recipe = recipe!(f, %{account_id: nil, source: :traditional})
      fixture = @fixture_path |> File.read!() |> Jason.decode!()

      assert Map.keys(fixture) == ["data"]
      assert key_sets(f |> request(recipe.id) |> json_response(200)) == key_sets(fixture)
    end

    test "an ai_generated recipe of the Account answers the same key sets as a catalog one", f do
      catalog = recipe!(f, %{account_id: nil, source: :traditional})
      generated = recipe!(f, %{account_id: f.account.id, source: :ai_generated})

      catalog_body = f |> request(catalog.id) |> json_response(200)
      generated_body = f |> request(generated.id) |> json_response(200)

      assert catalog_body["data"]["source"] == "traditional"
      assert generated_body["data"]["source"] == "ai_generated"
      assert generated_body["data"]["id"] == generated.id
      assert key_sets(generated_body) == key_sets(catalog_body)

      assert Map.drop(generated_body["data"], ~w(id recipeVersionId source ingredients)) ==
               Map.drop(catalog_body["data"], ~w(id recipeVersionId source ingredients))
    end

    test "adds up the times the recipe has and answers null when it has none", f do
      prep_only = recipe!(f, %{cook_time_minutes: nil})
      untimed = recipe!(f, %{prep_time_minutes: nil, cook_time_minutes: nil})

      assert json_response(request(f, prep_only.id), 200)["data"]["durationMinutes"] == 15
      assert json_response(request(f, untimed.id), 200)["data"]["durationMinutes"] == nil
    end

    test "reads the category live and answers null once the Ingredient is gone", f do
      {:ok, recipe} =
        Catalog.create_recipe(%{account_id: f.account.id, name: "Stew", source: :user_created})

      {:ok, line} =
        Catalog.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: f.potato.id,
          quantity_milli: 250_000,
          unit: :g
        })

      assert [%{"category" => "verduras"}] =
               json_response(request(f, recipe.id), 200)["data"]["ingredients"]

      # The version is frozen by now: the line and its Ingredient can go.
      Repo.delete!(line)
      Repo.delete!(f.potato)

      assert json_response(request(f, recipe.id), 200)["data"]["ingredients"] == [
               %{
                 "ingredientId" => f.potato.id,
                 "name" => "Detail potato",
                 "category" => nil,
                 "quantityMilli" => 250_000,
                 "unit" => "g"
               }
             ]
    end

    test "points a corrected recipe at its successor", f do
      recipe = recipe!(f)
      {:ok, successor} = RecipeVersions.correct(recipe.id, %{name: "Corrected tortilla"})

      original = json_response(request(f, recipe.id), 200)["data"]
      current = json_response(request(f, successor.recipe_id), 200)["data"]

      assert original["name"] == "Detail tortilla"
      assert original["successorRecipeId"] == successor.recipe_id
      assert current["name"] == "Corrected tortilla"
      assert current["recipeVersionId"] == successor.id
      assert current["successorRecipeId"] == nil
    end

    # The version of a corrected recipe is not frozen by the SQL function that
    # orders the steps of a first version.
    test "answers the steps of a corrected recipe by step number", f do
      recipe = recipe!(f)

      {:ok, successor} =
        RecipeVersions.correct(recipe.id, %{
          recipe_steps: [
            %{step_number: 2, instructions: "Fry them in butter", duration_minutes: nil},
            %{step_number: 1, instructions: "Dice the potatoes", duration_minutes: 10}
          ]
        })

      steps = json_response(request(f, successor.recipe_id), 200)["data"]["steps"]

      assert Enum.map(steps, &{&1["order"], &1["text"]}) == [
               {1, "Dice the potatoes"},
               {2, "Fry them in butter"}
             ]
    end
  end

  describe "GET /api/recipes/:id errors" do
    test "an unknown id, a malformed id and a recipe of another Account answer recipe_not_found",
         f do
      other =
        user_with_memberships(%{email: "detail-other-#{Ecto.UUID.generate()}@example.com"}, [
          {%{plan: :individual, name: "Other household"}, :owner}
        ])

      {:ok, foreign} =
        Catalog.create_recipe(%{
          account_id: hd(other.memberships).account_id,
          name: "Foreign",
          source: :ai_generated
        })

      for id <- [Ecto.UUID.generate(), "not-a-uuid", foreign.id] do
        assert %{"error" => %{"code" => "recipe_not_found", "message" => message}} =
                 f |> request(id) |> json_response(404)

        assert is_binary(message) and message != ""
      end
    end

    test "an Account without access answers forbidden", f do
      recipe = recipe!(f)
      persist_trial_window!(f.account, :expired)

      assert %{"error" => %{"code" => "forbidden", "message" => message}} =
               f |> request(recipe.id) |> json_response(403)

      assert is_binary(message) and message != ""
    end

    # The membership check of `RecipeAccess` is not reachable through the
    # route: the auth pipeline answers first.
    test "a member who is no longer active is stopped before the recipe is read", f do
      recipe = recipe!(f)

      f.user.memberships
      |> hd()
      |> Ecto.Changeset.change(status: :suspended)
      |> Repo.update!()

      assert %{"error" => %{"code" => "account_not_found"}} =
               f |> request(recipe.id) |> json_response(401)
    end
  end

  defp request(f, id) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> f.token)
    |> get("/api/recipes/#{id}")
  end

  # The keys of the body at the three levels the mobile recipe type has.
  defp key_sets(%{"data" => data}) do
    %{
      data: data |> Map.keys() |> Enum.sort(),
      ingredients: nested_key_sets(data["ingredients"]),
      steps: nested_key_sets(data["steps"])
    }
  end

  # One sorted key list when every entry has the same keys; an empty list
  # yields `[]`, which no fixture matches.
  defp nested_key_sets(entries) do
    entries |> Enum.map(&(&1 |> Map.keys() |> Enum.sort())) |> Enum.uniq()
  end

  # A recipe with three steps and one ingredient line per unit, like the one
  # in the fixture.
  defp recipe!(f, attrs \\ %{}) do
    {:ok, recipe} =
      Catalog.create_recipe(
        Map.merge(
          %{
            account_id: f.account.id,
            name: "Detail tortilla",
            description: "Potato and egg tortilla",
            source: :user_created,
            servings: 4,
            prep_time_minutes: 15,
            cook_time_minutes: 25
          },
          attrs
        )
      )

    for {number, instructions, duration} <- [
          # Inserted out of order: the route answers them by step number.
          {2, "Fry them in the oil", 15},
          {1, "Slice the potatoes", 15},
          {3, "Add the eggs and set", nil}
        ] do
      {:ok, _} =
        Catalog.add_recipe_step(%{
          recipe_id: recipe.id,
          step_number: number,
          instructions: instructions,
          duration_minutes: duration
        })
    end

    for {ingredient, quantity_milli, unit} <- [
          {f.potato, 500_000, :g},
          {f.oil, 60_000, :ml},
          {f.egg, 4000, :unit}
        ] do
      {:ok, _} =
        Catalog.add_recipe_ingredient(%{
          recipe_id: recipe.id,
          ingredient_id: ingredient.id,
          quantity_milli: quantity_milli,
          unit: unit
        })
    end

    recipe
  end
end
