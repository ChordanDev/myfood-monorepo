defmodule MealPlannerApiWeb.FavoritesControllerTest do
  @moduledoc """
  `GET`/`POST /api/me/favorites` and `DELETE /api/me/favorites/:recipe_id`
  (issue #34): the favorites of one User inside an Account, the idempotent
  add, the delete that never fails, and the key sets against the payload
  fixture the mobile app is tested with.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.FavoriteRecipe
  alias MealPlannerApi.Repo

  # The frozen payload the mobile favorites list is tested against. The key
  # sets asserted below keep it from drifting away from the route.
  @fixture_path Path.expand(
                  "../../../../mobile/src/features/favorites/fixtures/favorites.json",
                  __DIR__
                )

  setup do
    user =
      user_with_memberships(%{email: "fav-#{Ecto.UUID.generate()}@example.com"}, [
        {%{plan: :family_4, name: "Favorites household"}, :owner}
      ])

    membership = hd(user.memberships)

    {:ok, potato} = Catalog.create_ingredient(%{name: "Fav potato", category: :verduras})
    {:ok, oil} = Catalog.create_ingredient(%{name: "Fav oil", category: :no_perecederos})
    {:ok, egg} = Catalog.create_ingredient(%{name: "Fav egg", category: :otros})
    {:ok, salt} = Catalog.create_ingredient(%{name: "Fav salt", category: :no_perecederos})

    %{
      user: user,
      membership: membership,
      account: membership.account,
      token: issue_access_v2_token(user, membership),
      potato: potato,
      oil: oil,
      egg: egg,
      salt: salt
    }
  end

  describe "authentication" do
    test "every route answers 401 unauthenticated without a bearer token", %{conn: conn} do
      recipe_id = Ecto.UUID.generate()

      for conn <- [
            get(conn, "/api/me/favorites"),
            post(build_conn(), "/api/me/favorites", %{"recipeId" => recipe_id}),
            delete(build_conn(), "/api/me/favorites/#{recipe_id}")
          ] do
        assert %{"error" => %{"code" => "unauthenticated", "message" => _}} =
                 json_response(conn, 401)
      end
    end
  end

  describe "GET /api/me/favorites" do
    test "answers an empty list for a User with no favorites", f do
      assert f |> list() |> json_response(200) == %{"data" => []}
    end

    test "lists the summaries of the added favorites by name", f do
      tortilla = recipe!(f, %{name: "Tortilla"})

      arroz =
        recipe!(f, %{name: "Arroz con pollo", prep_time_minutes: nil, cook_time_minutes: 30})

      assert f |> add(tortilla.id) |> json_response(200)
      assert f |> add(arroz.id) |> json_response(200)

      body = f |> list() |> json_response(200) |> assert_camel_case_keys()

      assert [first, second] = body["data"]

      assert first == %{
               "recipeId" => arroz.id,
               "name" => "Arroz con pollo",
               "mainIngredients" => ["Fav potato", "Fav oil", "Fav egg"],
               "durationMinutes" => 30
             }

      assert %{"recipeId" => tortilla_id, "name" => "Tortilla", "durationMinutes" => 40} = second
      assert tortilla_id == tortilla.id
    end

    test "has exactly the key sets of the frozen mobile payload fixture", f do
      recipe = recipe!(f)
      fixture = @fixture_path |> File.read!() |> Jason.decode!()

      assert Map.keys(fixture) == ["data"]
      assert [_ | _] = fixture["data"]

      assert f |> add(recipe.id) |> json_response(200)

      body = f |> list() |> json_response(200)

      assert key_sets(body) == key_sets(fixture)
    end

    test "does not show the favorites of another member of the same Account", f do
      recipe = recipe!(f)
      assert f |> add(recipe.id) |> json_response(200)

      other = member_of!(f.account, "fav-mate-#{Ecto.UUID.generate()}@example.com")

      assert other |> list() |> json_response(200) == %{"data" => []}
      assert f |> list() |> json_response(200) |> Map.fetch!("data") |> length() == 1
    end
  end

  describe "POST /api/me/favorites" do
    test "answers 200 with the summary of the favorite", f do
      recipe = recipe!(f)

      assert %{"data" => data} = f |> add(recipe.id) |> json_response(200)

      assert data == %{
               "recipeId" => recipe.id,
               "name" => "Fav tortilla",
               "mainIngredients" => ["Fav potato", "Fav oil", "Fav egg"],
               "durationMinutes" => 40
             }
    end

    test "adding twice answers 200 with the same favorite and keeps one row", f do
      recipe = recipe!(f)

      first = f |> add(recipe.id) |> json_response(200)
      second = f |> add(recipe.id) |> json_response(200)

      assert first == second
      assert Repo.aggregate(FavoriteRecipe, :count) == 1
      assert f |> list() |> json_response(200) |> Map.fetch!("data") |> length() == 1
    end

    test "writes the row for the User of the token inside the Account", f do
      recipe = recipe!(f)
      assert f |> add(recipe.id) |> json_response(200)

      assert %FavoriteRecipe{} =
               Repo.get_by(FavoriteRecipe,
                 account_id: f.account.id,
                 user_id: f.user.id,
                 recipe_id: recipe.id
               )
    end

    test "the same recipe can be a favorite of two members of the Account", f do
      recipe = recipe!(f)
      other = member_of!(f.account, "fav-twin-#{Ecto.UUID.generate()}@example.com")

      assert f |> add(recipe.id) |> json_response(200)
      assert other |> add(recipe.id) |> json_response(200)

      assert Repo.aggregate(FavoriteRecipe, :count) == 2
    end

    test "an unknown, malformed or foreign recipe answers recipe_not_found", f do
      other =
        user_with_memberships(%{email: "fav-foreign-#{Ecto.UUID.generate()}@example.com"}, [
          {%{plan: :individual, name: "Foreign household"}, :owner}
        ])

      {:ok, foreign} =
        Catalog.create_recipe(%{
          account_id: hd(other.memberships).account_id,
          name: "Foreign",
          source: :ai_generated
        })

      for id <- [Ecto.UUID.generate(), "not-a-uuid", foreign.id] do
        assert %{"error" => %{"code" => "recipe_not_found", "message" => message}} =
                 f |> add(id) |> json_response(404)

        assert is_binary(message) and message != ""
      end

      assert Repo.aggregate(FavoriteRecipe, :count) == 0
    end

    test "a body without a string recipeId answers validation_error", f do
      for body <- [%{}, %{"recipeId" => nil}, %{"recipeId" => 12}] do
        conn =
          build_conn()
          |> put_req_header("authorization", "Bearer " <> f.token)
          |> post("/api/me/favorites", body)

        assert %{"error" => %{"code" => "validation_error", "message" => message}} =
                 json_response(conn, 422)

        assert message =~ "recipeId"
      end
    end
  end

  describe "DELETE /api/me/favorites/:recipe_id" do
    test "removes the favorite and answers 204 with no body", f do
      recipe = recipe!(f)
      assert f |> add(recipe.id) |> json_response(200)

      conn = remove(f, recipe.id)

      assert response(conn, 204) == ""
      assert f |> list() |> json_response(200) == %{"data" => []}
    end

    test "answers 204 when the recipe is not a favorite", f do
      recipe = recipe!(f)

      assert f |> remove(recipe.id) |> response(204) == ""
      assert f |> remove(Ecto.UUID.generate()) |> response(204) == ""
      assert f |> remove("not-a-uuid") |> response(204) == ""
    end

    test "only removes the favorite of the User of the token", f do
      recipe = recipe!(f)
      other = member_of!(f.account, "fav-del-#{Ecto.UUID.generate()}@example.com")

      assert f |> add(recipe.id) |> json_response(200)
      assert other |> add(recipe.id) |> json_response(200)

      assert other |> remove(recipe.id) |> response(204) == ""

      assert [%{"recipeId" => id}] = f |> list() |> json_response(200) |> Map.fetch!("data")
      assert id == recipe.id
      assert other |> list() |> json_response(200) == %{"data" => []}
    end
  end

  defp list(f), do: build_conn() |> authorize(f) |> get("/api/me/favorites")

  defp add(f, recipe_id) do
    build_conn() |> authorize(f) |> post("/api/me/favorites", %{"recipeId" => recipe_id})
  end

  defp remove(f, recipe_id),
    do: build_conn() |> authorize(f) |> delete("/api/me/favorites/#{recipe_id}")

  defp authorize(conn, f), do: put_req_header(conn, "authorization", "Bearer " <> f.token)

  # A second User with an active membership in the Account of `account`.
  defp member_of!(account, email) do
    user = user_with_memberships(%{email: email}, [])

    membership =
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account.id,
        user_id: user.id,
        role: :member,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert!()

    %{token: issue_access_v2_token(user, membership)}
  end

  # The keys of the body at the two levels the mobile favorites type has.
  defp key_sets(%{"data" => data}) do
    data |> Enum.map(&(&1 |> Map.keys() |> Enum.sort())) |> Enum.uniq()
  end

  # A recipe of 40 minutes with four ingredient lines; the quantities rank them
  # (potato, oil, egg, salt), and the summary keeps the first three.
  defp recipe!(f, attrs \\ %{}) do
    {:ok, recipe} =
      Catalog.create_recipe(
        Map.merge(
          %{
            account_id: f.account.id,
            name: "Fav tortilla",
            source: :user_created,
            servings: 4,
            prep_time_minutes: 15,
            cook_time_minutes: 25
          },
          attrs
        )
      )

    for {ingredient, quantity_milli, unit} <- [
          {f.oil, 60_000, :ml},
          {f.egg, 4000, :unit},
          {f.salt, 1000, :g},
          {f.potato, 500_000, :g}
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
