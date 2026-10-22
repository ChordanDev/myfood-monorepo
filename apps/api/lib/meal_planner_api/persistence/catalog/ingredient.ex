defmodule MealPlannerApi.Persistence.Catalog.Ingredient do
  use Ecto.Schema
  import Ecto.Changeset

  alias MealPlannerApi.Persistence.Accounts.UserHardRestriction
  alias MealPlannerApi.Persistence.Catalog.DietRules

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "ingredients" do
    field(:name, :string)

    field(:category, Ecto.Enum,
      values: [
        :lacteos,
        :frutas,
        :verduras,
        :carnes,
        :granos,
        :congelados,
        :no_perecederos,
        :otros
      ]
    )

    field(:sku_reference, :string)
    field(:calories_per_100, :integer)
    field(:protein_g_per_100, :decimal)
    field(:carbs_g_per_100, :decimal)
    field(:fat_g_per_100, :decimal)

    # The codes this Ingredient carries (`codes/0`): Hard restriction codes
    # and Diet marks. NULL means nobody has reviewed it (the planner treats it
    # as carrying every code); `[]` means it was reviewed and carries none.
    field(:allergens, {:array, :string})

    # The codes `mix ai_populate` proposes for an unreviewed Ingredient: a hint
    # for the reviewer, never read by the planner.
    field(:allergens_proposed, {:array, :string})

    has_many(:recipe_ingredients, MealPlannerApi.Persistence.Catalog.RecipeIngredient)

    timestamps(type: :utc_datetime_usec)
  end

  @doc """
  The codes an Ingredient can carry in `allergens`: the Hard restriction codes,
  then the Diet marks (`DietRules.mark_codes/0`), in catalog order.
  """
  @spec codes() :: [String.t()]
  def codes, do: UserHardRestriction.codes() ++ DietRules.mark_codes()

  def changeset(ingredient, attrs) do
    ingredient
    |> cast(attrs, [
      :name,
      :category,
      :sku_reference,
      :calories_per_100,
      :protein_g_per_100,
      :carbs_g_per_100,
      :fat_g_per_100,
      :allergens,
      :allergens_proposed
    ])
    |> validate_required([:name, :category])
    |> validate_number(:calories_per_100, greater_than_or_equal_to: 0)
    |> validate_number(:protein_g_per_100, greater_than_or_equal_to: 0)
    |> validate_number(:carbs_g_per_100, greater_than_or_equal_to: 0)
    |> validate_number(:fat_g_per_100, greater_than_or_equal_to: 0)
    |> validate_subset(:allergens, codes())
    |> check_constraint(:allergens, name: :ingredients_allergens_check)
    |> validate_subset(:allergens_proposed, codes())
    |> check_constraint(:allergens_proposed, name: :ingredients_allergens_proposed_check)
    |> unique_constraint(:name)
  end
end
