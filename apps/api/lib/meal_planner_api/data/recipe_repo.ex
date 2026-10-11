defmodule MealPlannerApi.Data.RecipeRepo do
  @moduledoc """
  Pure data access for recipes, ingredients, and their relationships.

  No business logic. No orchestration. Just queries and persistence.
  """

  import Ecto.Query, warn: false
  alias MealPlannerApi.Repo

  alias MealPlannerApi.Persistence.Catalog.{
    FavoriteRecipe,
    Ingredient,
    Recipe,
    RecipeIngredient,
    RecipeStep
  }

  @typedoc "The Account and the User a favorite belongs to."
  @type identity :: %{account_id: Ecto.UUID.t(), user_id: Ecto.UUID.t()}

  # -------------------------------------------------------------------------
  # Ingredients
  # -------------------------------------------------------------------------

  @spec create_ingredient(map()) :: {:ok, Ingredient.t()} | {:error, Ecto.Changeset.t()}
  def create_ingredient(attrs),
    do: %Ingredient{} |> Ingredient.changeset(attrs) |> Repo.insert()

  @spec upsert_ingredient_by_name(map()) :: {:ok, Ingredient.t()} | {:error, Ecto.Changeset.t()}
  def upsert_ingredient_by_name(attrs) do
    %Ingredient{}
    |> Ingredient.changeset(attrs)
    |> Repo.insert(
      on_conflict:
        {:replace,
         [
           :category,
           :sku_reference,
           :calories_per_100,
           :protein_g_per_100,
           :carbs_g_per_100,
           :fat_g_per_100,
           :updated_at
         ]},
      conflict_target: [:name]
    )
  end

  @spec get_ingredient!(Ecto.UUID.t()) :: Ingredient.t()
  def get_ingredient!(id), do: Repo.get!(Ingredient, id)

  @doc """
  Returns the category of the given ingredients, keyed by ingredient id, in
  one query. An id with no Ingredient row is absent from the map.
  """
  @spec ingredient_categories([binary()]) :: %{binary() => atom()}
  def ingredient_categories(ingredient_ids) when is_list(ingredient_ids) do
    from(i in Ingredient, where: i.id in ^ingredient_ids, select: {i.id, i.category})
    |> Repo.all()
    |> Map.new()
  end

  # -------------------------------------------------------------------------
  # Recipes
  # -------------------------------------------------------------------------

  @spec get_recipe!(Ecto.UUID.t()) :: Recipe.t()
  def get_recipe!(id), do: Repo.get!(Recipe, id)

  def get_visible_recipe(account_id, id) do
    Repo.one(
      from(r in Recipe,
        where: r.id == ^id and (r.account_id == ^account_id or is_nil(r.account_id))
      )
    )
  end

  @doc """
  Returns the theme of a Recipe visible to the Account (same rule as
  `get_visible_recipe/2`), or nil when it has none, is hidden or is missing.
  """
  @spec get_visible_recipe_theme(binary() | nil, binary()) :: map() | nil
  def get_visible_recipe_theme(nil, id) do
    # A catalog Recipe has no Account: only catalog Recipes are visible to it.
    Repo.one(from(r in Recipe, where: r.id == ^id and is_nil(r.account_id), select: r.theme))
  end

  def get_visible_recipe_theme(account_id, id) do
    Repo.one(
      from(r in Recipe,
        where: r.id == ^id and (is_nil(r.account_id) or r.account_id == ^account_id),
        select: r.theme
      )
    )
  end

  @spec get_recipe_with_details!(Ecto.UUID.t()) :: Recipe.t()
  def get_recipe_with_details!(id) do
    Recipe
    |> Repo.get!(id)
    |> Repo.preload([:recipe_steps, :recipe_ingredients, :daily_costs])
  end

  @spec get_recipe_with_ingredients!(Ecto.UUID.t()) :: Recipe.t()
  def get_recipe_with_ingredients!(id) do
    Recipe
    |> Repo.get!(id)
    |> Repo.preload(recipe_ingredients: [:ingredient])
  end

  # -------------------------------------------------------------------------
  # Recipe steps
  # -------------------------------------------------------------------------

  @spec add_recipe_step(map()) :: {:ok, RecipeStep.t()} | {:error, Ecto.Changeset.t()}
  def add_recipe_step(attrs),
    do: %RecipeStep{} |> RecipeStep.changeset(attrs) |> Repo.insert()

  @spec update_recipe_step(RecipeStep.t(), map()) ::
          {:ok, RecipeStep.t()} | {:error, Ecto.Changeset.t()}
  def update_recipe_step(step, attrs), do: step |> RecipeStep.changeset(attrs) |> Repo.update()

  @spec delete_recipe_step(Ecto.UUID.t()) :: :ok
  def delete_recipe_step(id) do
    Repo.delete!(Repo.get!(RecipeStep, id))
    :ok
  end

  # -------------------------------------------------------------------------
  # Recipe ingredients (associations)
  # -------------------------------------------------------------------------

  @spec add_recipe_ingredient(map()) :: {:ok, RecipeIngredient.t()} | {:error, Ecto.Changeset.t()}
  def add_recipe_ingredient(attrs),
    do: %RecipeIngredient{} |> RecipeIngredient.changeset(attrs) |> Repo.insert()

  @doc """
  Returns the recipe_ingredients for the given recipe ids grouped by recipe id.

  Shape: `%{recipe_id => [%{ingredient_id, unit, quantity_milli}]}`. Recipe ids
  with no `recipe_ingredients` are absent from the map (callers default via
  `Map.get(map, id, [])`). Feeds `GenerationService.build_cart_lines/2`.
  """
  @spec list_ingredients_for_recipes([binary()]) :: %{binary() => [map()]}
  def list_ingredients_for_recipes(recipe_ids) when is_list(recipe_ids) do
    from(ri in RecipeIngredient,
      where: ri.recipe_id in ^recipe_ids,
      select: %{
        recipe_id: ri.recipe_id,
        ingredient_id: ri.ingredient_id,
        unit: ri.unit,
        quantity_milli: ri.quantity_milli
      }
    )
    |> Repo.all()
    |> Enum.group_by(& &1.recipe_id, &Map.delete(&1, :recipe_id))
  end

  @spec delete_recipe_ingredient(Ecto.UUID.t()) :: :ok
  def delete_recipe_ingredient(id) do
    Repo.delete!(Repo.get!(RecipeIngredient, id))
    :ok
  end

  @spec get_recipe_ingredient_with_ingredient!(Ecto.UUID.t()) :: RecipeIngredient.t()
  def get_recipe_ingredient_with_ingredient!(id) do
    Repo.get!(RecipeIngredient, id) |> Repo.preload(:ingredient)
  end

  # -------------------------------------------------------------------------
  # Favorites
  # -------------------------------------------------------------------------

  # Favorites belong to a User inside an Account. Each function takes the
  # `identity` (`%{account_id: _, user_id: _}`, as `Identity.ensure_persistent_identity/1`
  # returns it) so a favorite is never read or written for the Account alone.

  @doc """
  Inserts the favorite of the User, or leaves the stored one as it is when the
  User already has it.
  """
  @spec add_favorite(identity(), Ecto.UUID.t()) ::
          {:ok, FavoriteRecipe.t()} | {:error, Ecto.Changeset.t()}
  def add_favorite(%{account_id: account_id, user_id: user_id}, recipe_id) do
    attrs = %{account_id: account_id, user_id: user_id, recipe_id: recipe_id}

    %FavoriteRecipe{}
    |> FavoriteRecipe.changeset(attrs)
    |> Repo.insert(on_conflict: :nothing, conflict_target: [:account_id, :user_id, :recipe_id])
  end

  @spec remove_favorite(identity(), Ecto.UUID.t()) :: :ok
  def remove_favorite(%{account_id: account_id, user_id: user_id}, recipe_id) do
    from(f in FavoriteRecipe,
      where: f.account_id == ^account_id and f.user_id == ^user_id and f.recipe_id == ^recipe_id
    )
    |> Repo.delete_all()

    :ok
  end

  @doc "The favorite recipes of the User, by name, with their ingredient lines."
  @spec list_favorites(identity()) :: [Recipe.t()]
  def list_favorites(%{account_id: account_id, user_id: user_id}) do
    from(f in FavoriteRecipe,
      join: r in assoc(f, :recipe),
      where: f.account_id == ^account_id and f.user_id == ^user_id,
      order_by: [asc: r.name, asc: r.id],
      preload: [recipe: [recipe_ingredients: :ingredient]]
    )
    |> Repo.all()
    |> Enum.map(& &1.recipe)
  end

  @doc "A recipe the Account can see, with its ingredient lines; nil when there is none."
  @spec get_visible_recipe_with_ingredients(Ecto.UUID.t(), Ecto.UUID.t()) :: Recipe.t() | nil
  def get_visible_recipe_with_ingredients(account_id, id) do
    from(r in Recipe,
      where: r.id == ^id and (r.account_id == ^account_id or is_nil(r.account_id)),
      preload: [recipe_ingredients: :ingredient]
    )
    |> Repo.one()
  end

  @spec list_by_ids([Ecto.UUID.t()]) :: [Recipe.t()]
  def list_by_ids(ids) when is_list(ids) do
    from(r in Recipe, where: r.id in ^ids)
    |> Repo.all()
  end

  @doc """
  Returns recipes with their prices preloaded.
  Used by GenerationServer to enrich optimizer responses with recipe names and prices.
  """
  @spec list_by_ids_with_prices([Ecto.UUID.t()]) :: [Recipe.t()]
  def list_by_ids_with_prices(recipe_ids) when is_list(recipe_ids) do
    from(r in Recipe,
      where: r.id in ^recipe_ids,
      preload: [:recipe_price]
    )
    |> Repo.all()
  end

  # -------------------------------------------------------------------------
  # Favorite IDs (for GenerationServer optimization hints)
  # -------------------------------------------------------------------------

  @doc """
  Returns the list of favorite recipe IDs of a User inside an Account.
  Used by GenerationServer to inject preferred_recipe_ids into the OR-Tools payload.

  Returns a list of maps with `:id` key, e.g. `[%{id: 1}, %{id: 5}]`.
  """
  @spec list_favorite_ids(identity()) :: [%{id: Ecto.UUID.t()}]
  def list_favorite_ids(%{account_id: account_id, user_id: user_id}) do
    from(f in FavoriteRecipe,
      where: f.account_id == ^account_id and f.user_id == ^user_id,
      select: %{id: f.recipe_id}
    )
    |> Repo.all()
  end
end
