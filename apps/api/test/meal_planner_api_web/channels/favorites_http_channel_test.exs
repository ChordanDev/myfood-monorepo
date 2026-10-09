defmodule MealPlannerApiWeb.FavoritesHttpChannelTest do
  @moduledoc """
  The favorites routes (issue #34) and the `toggle_favorite` event of the
  calendar channel write the same `favorite_recipes` row, so each one sees
  what the other did.
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  import MealPlannerApi.FactoryHelpers
  import Phoenix.ConnTest, only: [build_conn: 0, delete: 2, get: 2, json_response: 2, post: 3]
  import Plug.Conn, only: [put_req_header: 3]

  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.FavoriteRecipe
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.{CalendarChannel, UserSocket}

  setup do
    user =
      user_with_memberships(%{email: "fav-chan-#{Ecto.UUID.generate()}@example.com"}, [
        {%{plan: :family_4, name: "Favorites channel household"}, :owner}
      ])

    membership = hd(user.memberships)
    token = issue_access_v2_token(user, membership)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: membership.account_id,
        created_by_user_id: user.id,
        name: "Channel favorite",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:lunch]
      })

    {:ok, socket} = connect(UserSocket, %{"token" => token})

    {:ok, _reply, socket} =
      subscribe_and_join(socket, CalendarChannel, "calendar:#{membership.account_id}")

    %{user: user, membership: membership, token: token, recipe: recipe, socket: socket}
  end

  test "a favorite added over HTTP is the row the channel toggle removes", f do
    recipe_id = f.recipe.id

    assert %{"data" => %{"recipeId" => ^recipe_id}} =
             f |> http_post(recipe_id) |> json_response(200)

    assert Repo.aggregate(FavoriteRecipe, :count) == 1

    ref = push(f.socket, "toggle_favorite", %{"recipe_id" => recipe_id})
    assert_reply(ref, :ok, %{is_favorite: false, recipe_id: ^recipe_id})

    assert Repo.aggregate(FavoriteRecipe, :count) == 0
    assert f |> http_list() |> json_response(200) == %{"data" => []}
  end

  test "a favorite toggled on by the channel is listed, kept by a repeated POST and deleted over HTTP",
       f do
    recipe_id = f.recipe.id

    ref = push(f.socket, "toggle_favorite", %{"recipe_id" => recipe_id})
    assert_reply(ref, :ok, %{is_favorite: true, recipe_id: ^recipe_id})

    assert %{"data" => [%{"recipeId" => ^recipe_id}]} = f |> http_list() |> json_response(200)

    assert f |> http_post(recipe_id) |> json_response(200)
    assert Repo.aggregate(FavoriteRecipe, :count) == 1

    conn = f |> authorize(build_conn()) |> delete("/api/me/favorites/#{recipe_id}")
    assert conn.status == 204
    assert Repo.aggregate(FavoriteRecipe, :count) == 0
  end

  defp http_list(f), do: f |> authorize(build_conn()) |> get("/api/me/favorites")

  defp http_post(f, recipe_id) do
    f |> authorize(build_conn()) |> post("/api/me/favorites", %{"recipeId" => recipe_id})
  end

  defp authorize(f, conn), do: put_req_header(conn, "authorization", "Bearer " <> f.token)
end
