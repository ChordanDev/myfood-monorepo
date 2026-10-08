defmodule MealPlannerApiWeb.RecipeController do
  use MealPlannerApiWeb, :controller
  alias MealPlannerApi.Services.RecipeService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers

  def show(conn, %{"id" => id}) do
    user =
      Guardian.Plug.current_resource(conn)
      |> AccountScopeHelpers.scope_user_to_membership(conn.assigns.current_membership)

    case RecipeService.get_recipe(user, id) do
      {:ok, recipe} ->
        json(conn, %{data: recipe})

      {:error, :subscription_required} ->
        conn |> ApiError.error(:forbidden)

      # A missing recipe, a malformed id and a recipe of another Account.
      {:error, _} ->
        conn |> ApiError.error(:recipe_not_found)
    end
  end
end
