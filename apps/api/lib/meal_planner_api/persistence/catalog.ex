defmodule MealPlannerApi.Persistence.Catalog do
  @moduledoc "Persistence helpers for ingredients, recipes and cost cache."

  import Ecto.Query, warn: false

  alias MealPlannerApi.Repo

  alias MealPlannerApi.Persistence.Catalog.{
    Ingredient,
    Recipe,
    RecipeDailyCost,
    RecipeIngredient,
    RecipeStep
  }

  def create_ingredient(attrs), do: %Ingredient{} |> Ingredient.changeset(attrs) |> Repo.insert()

  @doc """
  Inserts the Ingredient, or updates the one with the same name. `allergens`
  is never updated: only `apply_allergen_reviews/1` writes it on an existing
  Ingredient. `allergens_proposed` is refreshed only while the Ingredient is
  still unreviewed, and a refresh only adds codes: the new proposal is merged
  into the stored one, in `Ingredient.codes/0` order. A stored code may be one
  a human reviewed before the Diet marks reset (issue #441), so it is never
  dropped. A missing proposal keeps the stored one.
  """
  def upsert_ingredient_by_name(attrs) do
    %Ingredient{}
    |> Ingredient.changeset(attrs)
    |> Repo.insert(
      on_conflict:
        from(i in Ingredient,
          update: [
            set: [
              category: fragment("EXCLUDED.category"),
              sku_reference: fragment("EXCLUDED.sku_reference"),
              calories_per_100: fragment("EXCLUDED.calories_per_100"),
              protein_g_per_100: fragment("EXCLUDED.protein_g_per_100"),
              carbs_g_per_100: fragment("EXCLUDED.carbs_g_per_100"),
              fat_g_per_100: fragment("EXCLUDED.fat_g_per_100"),
              updated_at: fragment("EXCLUDED.updated_at"),
              allergens_proposed:
                fragment(
                  """
                  CASE
                    WHEN ? IS NOT NULL OR EXCLUDED.allergens_proposed IS NULL THEN ?
                    WHEN ? IS NULL THEN EXCLUDED.allergens_proposed
                    ELSE ARRAY(
                      SELECT code FROM unnest(?::varchar[]) WITH ORDINALITY AS c(code, position)
                      WHERE code = ANY(? || EXCLUDED.allergens_proposed)
                      ORDER BY position
                    )
                  END
                  """,
                  i.allergens,
                  i.allergens_proposed,
                  i.allergens_proposed,
                  ^Ingredient.codes(),
                  i.allergens_proposed
                )
            ]
          ]
        ),
      conflict_target: [:name]
    )
  end

  @doc "The Ingredients nobody has reviewed (`allergens` NULL), by name."
  @spec list_unreviewed_ingredients() :: [Ingredient.t()]
  def list_unreviewed_ingredients do
    from(i in Ingredient, where: is_nil(i.allergens), order_by: [asc: i.name, asc: i.id])
    |> Repo.all()
  end

  @doc "How many Ingredients nobody has reviewed (`allergens` NULL)."
  @spec count_unreviewed_ingredients() :: non_neg_integer()
  def count_unreviewed_ingredients,
    do: Repo.aggregate(from(i in Ingredient, where: is_nil(i.allergens)), :count)

  @doc """
  Writes the reviewed `allergens` of each `{ingredient_id, codes}`, in one
  transaction. An Ingredient whose `allergens` is no longer NULL is left as it
  is, so a review never overwrites an earlier one. Returns how many were
  written, how many were already reviewed, and the ids that match no
  Ingredient, in the order given.
  """
  @spec apply_allergen_reviews([{Ecto.UUID.t(), [String.t()]}]) ::
          {:ok,
           %{
             written: non_neg_integer(),
             already_reviewed: non_neg_integer(),
             not_found: [Ecto.UUID.t()]
           }}
  def apply_allergen_reviews(reviews) do
    now = DateTime.utc_now()

    Repo.transaction(fn ->
      reviews
      |> Enum.reduce(
        %{written: 0, already_reviewed: 0, not_found: []},
        &apply_allergen_review(&1, &2, now)
      )
      |> Map.update!(:not_found, &Enum.reverse/1)
    end)
  end

  defp apply_allergen_review({id, codes}, acc, now) do
    {count, _} =
      from(i in Ingredient, where: i.id == ^id and is_nil(i.allergens))
      |> Repo.update_all(set: [allergens: codes, updated_at: now])

    cond do
      count == 1 ->
        %{acc | written: acc.written + 1}

      Repo.exists?(from(i in Ingredient, where: i.id == ^id)) ->
        %{acc | already_reviewed: acc.already_reviewed + 1}

      true ->
        %{acc | not_found: [id | acc.not_found]}
    end
  end

  def list_ingredients, do: Repo.all(Ingredient)

  @doc """
  The Ingredients whose name holds `query`, ignoring case, at most `limit` of
  them: the names that start with it first, then by name. `%`, `_` and `\\`
  in `query` match themselves.
  """
  @spec search_ingredients(String.t(), pos_integer()) :: [Ingredient.t()]
  def search_ingredients(query, limit) when is_binary(query) and limit > 0 do
    escaped = String.replace(query, ~r/[\\%_]/, "\\\\\\0")

    from(i in Ingredient,
      where: ilike(i.name, ^"%#{escaped}%"),
      order_by: [
        asc: fragment("CASE WHEN ? ILIKE ? THEN 0 ELSE 1 END", i.name, ^"#{escaped}%"),
        asc: i.name
      ],
      limit: ^limit
    )
    |> Repo.all()
  end

  def create_recipe(attrs), do: %Recipe{} |> Recipe.changeset(attrs) |> Repo.insert()

  def get_recipe!(id), do: Repo.get!(Recipe, id)

  def get_recipe_with_details!(id) do
    Recipe
    |> Repo.get!(id)
    |> Repo.preload([:recipe_steps, :recipe_ingredients, :daily_costs])
  end

  def add_recipe_step(attrs), do: %RecipeStep{} |> RecipeStep.changeset(attrs) |> Repo.insert()

  def add_recipe_ingredient(attrs),
    do: %RecipeIngredient{} |> RecipeIngredient.changeset(attrs) |> Repo.insert()

  def upsert_recipe_daily_cost(attrs) do
    %RecipeDailyCost{}
    |> RecipeDailyCost.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace, [:total_cents_ars, :updated_at]},
      conflict_target: [:recipe_id, :supermarket_id, :date]
    )
  end

  def recipes_for_slot(account_id, slot) do
    slot_str = if is_atom(slot), do: Atom.to_string(slot), else: slot

    from(r in Recipe,
      where: is_nil(r.account_id) or r.account_id == ^account_id,
      where: is_nil(r.superseded_by_id),
      where: ^slot_str in r.suitable_for_slots
    )
    |> Repo.all()
  end
end
