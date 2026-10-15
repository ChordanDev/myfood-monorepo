defmodule MealPlannerApi.Data.IngredientAllergensTest do
  @moduledoc """
  The `allergens` of an Ingredient (issue #114): the tags the data migration
  writes from Ingredient names, the codes the changeset accepts, and the
  guard that no Ingredient ships without tags.
  """
  use ExUnit.Case, async: false

  import Ecto.Query, warn: false
  import ExUnit.CaptureIO

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.Ingredient
  alias MealPlannerApi.Repo

  @migration MealPlannerApi.Repo.Migrations.TagIngredientAllergens
  @migration_path Path.expand(
                    "../../../priv/repo/migrations/202610150000100_tag_ingredient_allergens.exs",
                    __DIR__
                  )
  @seeds_path Path.expand("../../../priv/repo/seeds.exs", __DIR__)

  setup_all do
    # `mix ecto.migrate` may have compiled the migration in this VM already.
    unless Code.ensure_loaded?(@migration), do: Code.require_file(@migration_path)
    # Tests read the module from the context: it is compiled at runtime, so a
    # literal remote call would warn that it is undefined.
    {:ok, migration: @migration}
  end

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  describe "the tag migration" do
    # Name of an Ingredient => the codes the migration gives it. nil: no rule
    # matches, so the Ingredient stays unreviewed.
    @expected_tags %{
      "Maní tostado" => ["peanut"],
      "Pasta de maní" => ["peanut"],
      "Mix de frutos secos" => ["peanut", "tree_nut"],
      "Nueces mariposa" => ["tree_nut"],
      "Almendras peladas" => ["tree_nut"],
      "Leche de almendras" => ["tree_nut"],
      "Langostinos congelados" => ["shellfish"],
      "Mejillones" => ["shellfish"],
      "Rabas" => ["shellfish"],
      "Harina de trigo 000" => ["gluten"],
      "Fideos tirabuzón" => ["gluten"],
      "Pan rallado" => ["gluten"],
      "Leche entera" => ["dairy"],
      "Queso cremoso" => ["dairy"],
      "Dulce de leche" => ["dairy"],
      "Manteca" => ["dairy"],
      "Huevos blancos" => ["egg"],
      "Mayonesa" => ["egg"],
      "Ravioles de verdura" => ["gluten", "egg"],
      "Tofu firme" => ["soy"],
      "Leche de soja" => ["soy"],
      "Salsa de soja" => ["gluten", "soy"],
      "Harina de maíz" => nil,
      "Fideos de arroz sin TACC" => nil,
      "Manteca de cacao" => nil,
      "Leche de coco" => nil,
      "Tapa de asado" => nil,
      "Panceta ahumada" => nil,
      "Tomate" => nil,
      "Arroz largo fino" => nil,
      "Frutos del mar" => ["shellfish"],
      "Gambas" => ["shellfish"],
      "Cereal de maíz" => ["gluten"],
      "Spaguetti" => ["gluten"],
      "Ñoqui de papa" => ["gluten", "egg"],
      "ÑOQUIS" => ["gluten", "egg"],
      "Merluza rebozada" => ["gluten", "egg"],
      "Shoyu" => ["gluten", "soy"],
      "Mozarella" => ["dairy"],
      "Bebida láctea" => ["dairy"],
      "Manchego" => ["dairy"],
      "Mantequilla de maní" => ["peanut"],
      "Pesto" => ["tree_nut", "dairy"],
      "Garrapiñada" => ["peanut"],
      "Alioli" => ["egg"],
      "Nuez moscada" => nil,
      "Esencia de vainilla" => nil,
      "Fideos de arroz" => nil,
      "Pasta de ajo" => nil,
      "Masitas" => ["gluten"],
      "Bizcochitos de grasa" => ["gluten"],
      "Tostaditas" => ["gluten"],
      "Criollitas" => ["gluten"],
      "Pepas" => ["gluten"],
      "Palmeritas" => ["gluten"],
      "Rosquitas" => ["gluten"],
      "Scones" => ["gluten", "dairy", "egg"],
      "Chocolinas" => ["gluten"],
      "Sacramentos" => ["gluten"],
      "Panko" => ["gluten"],
      "Burgol" => ["gluten"],
      "Requesón" => ["dairy"],
      "Quesitos" => ["dairy"],
      "Cremoso" => ["dairy"],
      "Port Salut" => ["dairy"],
      "Gruyère" => ["dairy"],
      "Crème fraîche" => ["dairy"],
      "Panqueques" => ["gluten", "dairy", "egg"],
      "Crepes" => ["gluten", "dairy", "egg"],
      "Masa para panqueques" => ["gluten", "dairy", "egg"],
      "Alfajores" => ["gluten", "dairy", "egg"],
      "Tarta de jamón y queso" => ["gluten", "dairy"],
      "Cremor tártaro" => nil,
      "Maní tostado" => ["peanut"],
      "Lechuga" => nil,
      "Pulpa de tomate" => nil
    }

    test "tags each untagged Ingredient with the codes its name names, and leaves the rest NULL",
         %{migration: migration} do
      for name <- Map.keys(@expected_tags), do: insert_ingredient(name, nil)

      Repo.query!(migration.tag_sql())

      assert allergens_by_name() == @expected_tags
    end

    test "previews the same tags without writing them", %{migration: migration} do
      for name <- Map.keys(@expected_tags), do: insert_ingredient(name, nil)

      %{rows: rows} = Repo.query!(migration.preview_sql())

      assert Map.new(rows, fn [name, allergens] -> {name, allergens} end) == @expected_tags
      assert Enum.all?(allergens_by_name(), fn {_name, allergens} -> is_nil(allergens) end)
    end

    test "leaves an Ingredient that already has tags as it is", %{migration: migration} do
      insert_ingredient("Queso reviewed", [])
      insert_ingredient("Huevo reviewed", ["egg", "dairy"])

      Repo.query!(migration.tag_sql())

      assert allergens_by_name() == %{
               "Queso reviewed" => [],
               "Huevo reviewed" => ["egg", "dairy"]
             }
    end
  end

  describe "Ingredient.changeset/2" do
    test "accepts the Hard restriction codes, an empty list and nil" do
      for allergens <- [["peanut", "soy"], [], nil] do
        changeset = Ingredient.changeset(%Ingredient{}, ingredient_attrs("Any", allergens))
        assert changeset.valid?
      end
    end

    test "rejects a code outside the Hard restriction catalog" do
      changeset = Ingredient.changeset(%Ingredient{}, ingredient_attrs("Fish", ["fish"]))

      refute changeset.valid?
      assert {_message, [validation: :subset, enum: _codes]} = changeset.errors[:allergens]
    end
  end

  describe "no Ingredient ships without tags" do
    test "the seeds leave no Ingredient with allergens NULL" do
      capture_io(fn -> Code.eval_file(@seeds_path) end)

      untagged =
        from(i in Ingredient, where: is_nil(i.allergens), select: i.name, order_by: i.name)
        |> Repo.all()

      assert untagged == [],
             "Ingredients without allergens (NULL means not reviewed): #{inspect(untagged)}"
    end
  end

  defp insert_ingredient(name, allergens) do
    {:ok, ingredient} = Catalog.create_ingredient(ingredient_attrs(name, allergens))
    ingredient
  end

  defp ingredient_attrs(name, allergens),
    do: %{name: name, category: :otros, allergens: allergens}

  defp allergens_by_name do
    from(i in Ingredient, select: {i.name, i.allergens})
    |> Repo.all()
    |> Map.new()
  end
end
