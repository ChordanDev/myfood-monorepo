defmodule MealPlannerApiWeb.FavoritesController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.RecipeService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers

  # `GET /api/me/favorites`: the summaries of the favorites of the User of the
  # token, in the active Account, by recipe name.
  def index(conn, _params) do
    case RecipeService.list_favorites(scoped_user(conn)) do
      {:ok, favorites} -> json(conn, %{data: favorites})
      {:error, _reason} -> ApiError.server_fault(conn)
    end
  end

  # `POST /api/me/favorites` with `{recipeId}`: idempotent. It answers 200 with
  # the summary of the favorite whether it was added now or already was one.
  def create(conn, %{"recipe_id" => recipe_id}) when is_binary(recipe_id) do
    case RecipeService.add_favorite(scoped_user(conn), recipe_id) do
      {:ok, favorite} -> json(conn, %{data: favorite})
      {:error, :not_found} -> ApiError.error(conn, :recipe_not_found)
      {:error, _reason} -> ApiError.server_fault(conn)
    end
  end

  def create(conn, _params), do: ApiError.validation_error(conn, "recipeId")

  # `DELETE /api/me/favorites/:recipe_id`: 204 whether the recipe was a
  # favorite or not, so the app can repeat it safely.
  def delete(conn, %{"recipe_id" => recipe_id}) do
    case RecipeService.remove_favorite(scoped_user(conn), recipe_id) do
      :ok -> send_resp(conn, 204, "")
      {:error, _reason} -> ApiError.server_fault(conn)
    end
  end

  defp scoped_user(conn) do
    conn
    |> Guardian.Plug.current_resource()
    |> AccountScopeHelpers.scope_user_to_membership(conn.assigns.current_membership)
  end
end
