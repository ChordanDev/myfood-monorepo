defmodule MealPlannerApi.Services.RecipeService do
  @moduledoc """
  Recipe management orchestration.

  Coordinates the recipe detail and the favorites of a User.
  """

  alias MealPlannerApi.Data.RecipeRepo
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Services.RecipeAccess
  alias MealPlannerApi.Services.RecipeDetail
  alias MealPlannerApi.Services.RecipeVersions

  # -------------------------------------------------------------------------
  # Recipe detail
  # -------------------------------------------------------------------------

  @doc """
  Returns the detail of a recipe the user's Account can see, as the projection
  of its frozen version (`RecipeDetail.project/2`).
  """
  @spec get_recipe(map(), String.t()) ::
          {:ok, map()} | {:error, :not_found | :subscription_required}
  def get_recipe(user, recipe_id) do
    with {:ok, ids} <- RecipeAccess.authorize(user),
         {:ok, _} <- Ecto.UUID.cast(recipe_id),
         recipe when not is_nil(recipe) <-
           RecipeRepo.get_visible_recipe(ids.account_id, recipe_id),
         version when not is_nil(version) <-
           RecipeVersions.freeze(recipe.id) do
      {:ok, RecipeDetail.project(recipe, version)}
    else
      {:error, reason} -> {:error, reason}
      _ -> {:error, :not_found}
    end
  end

  # -------------------------------------------------------------------------
  # Favorites
  # -------------------------------------------------------------------------

  # How many ingredient names a favorite summary carries.
  @main_ingredients 3

  @doc """
  Marks a recipe the Account can see as a favorite of the User. Idempotent:
  adding a recipe that already is a favorite changes nothing and answers the
  same summary.
  """
  @spec add_favorite(map(), String.t()) :: {:ok, map()} | {:error, :not_found | term()}
  def add_favorite(user, recipe_id) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user),
         {:ok, _} <- Ecto.UUID.cast(recipe_id),
         %{} = recipe <-
           RecipeRepo.get_visible_recipe_with_ingredients(identity.account_id, recipe_id),
         {:ok, _favorite} <- RecipeRepo.add_favorite(identity, recipe.id) do
      {:ok, serialize_favorite(recipe)}
    else
      {:error, reason} -> {:error, reason}
      # An unknown recipe, a malformed id and a recipe of another Account.
      _ -> {:error, :not_found}
    end
  end

  @doc "Removes the favorite of the User. Removing one that is not there is not an error."
  @spec remove_favorite(map(), String.t()) :: :ok | {:error, term()}
  def remove_favorite(user, recipe_id) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user) do
      case Ecto.UUID.cast(recipe_id) do
        {:ok, recipe_id} -> RecipeRepo.remove_favorite(identity, recipe_id)
        :error -> :ok
      end
    end
  end

  @doc "The summaries of the favorites of the User, by recipe name."
  @spec list_favorites(map()) :: {:ok, [map()]} | {:error, term()}
  def list_favorites(user) do
    with {:ok, identity} <- Identity.ensure_persistent_identity(user) do
      {:ok, identity |> RecipeRepo.list_favorites() |> Enum.map(&serialize_favorite/1)}
    end
  end

  # -------------------------------------------------------------------------
  # Helpers
  # -------------------------------------------------------------------------

  # What the favorites list shows of a recipe: its name, the three ingredients
  # it uses most of (by quantity, ties by name) and the minutes it takes.
  defp serialize_favorite(recipe) do
    %{
      recipe_id: recipe.id,
      name: recipe.name,
      main_ingredients: main_ingredients(recipe.recipe_ingredients),
      duration_minutes: duration_minutes(recipe)
    }
  end

  defp main_ingredients(lines) do
    lines
    |> Enum.sort_by(&{-(&1.quantity_milli || 0), &1.ingredient.name})
    |> Enum.take(@main_ingredients)
    |> Enum.map(& &1.ingredient.name)
  end

  # Prep plus cook, counting a missing one as 0; nil when the recipe has neither.
  defp duration_minutes(%{prep_time_minutes: nil, cook_time_minutes: nil}), do: nil

  defp duration_minutes(recipe),
    do: (recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0)
end
