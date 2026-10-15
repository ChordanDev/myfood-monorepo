defmodule MealPlannerApiWeb.IngredientController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.IngredientService
  alias MealPlannerApiWeb.ApiError

  # `GET /api/ingredients?query=`: the Ingredients of the catalogue whose name
  # holds `query`, ignoring case, as `{id, name}`. `IngredientService` bounds
  # how many. The catalogue is shared by every Account.
  def index(conn, params) do
    case IngredientService.search(params["query"]) do
      {:ok, ingredients} -> json(conn, %{data: ingredients})
      {:error, :invalid_query} -> ApiError.validation_error(conn, "query")
    end
  end
end
