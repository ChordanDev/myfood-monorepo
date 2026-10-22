defmodule MealPlannerApi.Data.IngredientAllergensTest do
  @moduledoc """
  The `allergens` of an Ingredient (issue #114): the tags the data migration
  writes from Ingredient names, the codes the changeset accepts, and the
  guard that no Ingredient ships without tags. The Diet marks (issue #441) are
  Ingredient codes too.
  """
  use ExUnit.Case, async: false

  import Ecto.Query, warn: false
  import ExUnit.CaptureIO

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.UserHardRestriction
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.{AllergenRules, Ingredient}
  alias MealPlannerApi.Repo

  @migration MealPlannerApi.Repo.Migrations.TagIngredientAllergens
  @migration_path Path.expand(
                    "../../../priv/repo/migrations/20261015130010_tag_ingredient_allergens.exs",
                    __DIR__
                  )
  @diet_marks_migration MealPlannerApi.Repo.Migrations.AddDietMarkCodesToIngredientAllergens
  @diet_marks_migration_path Path.expand(
                               "../../../priv/repo/migrations/20261022000000_add_diet_mark_codes_to_ingredient_allergens.exs",
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
      "Masitas" => ["gluten", "dairy", "egg"],
      "Bizcochitos de grasa" => ["gluten"],
      "Tostaditas" => ["gluten"],
      "Criollitas" => ["gluten"],
      "Pepas" => ["gluten", "dairy", "egg"],
      "Palmeritas" => ["gluten", "dairy", "egg"],
      "Rosquitas" => ["gluten", "dairy", "egg"],
      "Scones" => ["gluten", "dairy", "egg"],
      "Chocolinas" => ["gluten", "dairy", "egg"],
      "Sacramentos" => ["gluten", "dairy", "egg"],
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

    test "Catalog.AllergenRules gives every name the codes the migration gives it",
         %{migration: migration} do
      for name <- Map.keys(@expected_tags), do: insert_ingredient(name, nil)

      %{rows: rows} = Repo.query!(migration.preview_sql())

      for [name, migration_codes] <- rows do
        assert AllergenRules.codes_for_name(name) == (migration_codes || []),
               "#{inspect(name)}: the migration gives #{inspect(migration_codes)}"
      end

      assert length(rows) == map_size(@expected_tags)
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

    test "rejects a code outside the Ingredient codes" do
      changeset = Ingredient.changeset(%Ingredient{}, ingredient_attrs("Sesame", ["sesame"]))

      refute changeset.valid?
      assert {_message, [validation: :subset, enum: _codes]} = changeset.errors[:allergens]
    end
  end

  describe "allergens_proposed" do
    test "the changeset accepts the Hard restriction codes, an empty list and nil" do
      for proposed <- [["gluten", "egg"], [], nil] do
        attrs = Map.put(ingredient_attrs("Any", nil), :allergens_proposed, proposed)
        assert Ingredient.changeset(%Ingredient{}, attrs).valid?
      end
    end

    test "the changeset rejects a code outside the Ingredient codes" do
      attrs = Map.put(ingredient_attrs("Sesame", nil), :allergens_proposed, ["sesame"])
      changeset = Ingredient.changeset(%Ingredient{}, attrs)

      refute changeset.valid?

      assert {_message, [validation: :subset, enum: _codes]} =
               changeset.errors[:allergens_proposed]
    end

    test "an upsert that leaves allergens_proposed out keeps an unreviewed Ingredient's proposal" do
      {:ok, _} =
        Catalog.create_ingredient(%{
          name: "Ravioles",
          category: :otros,
          allergens: nil,
          allergens_proposed: ["gluten", "egg"]
        })

      {:ok, _} = Catalog.upsert_ingredient_by_name(%{name: "Ravioles", category: :granos})

      assert Repo.one!(
               from(i in Ingredient,
                 where: i.name == "Ravioles",
                 select: {i.category, i.allergens, i.allergens_proposed}
               )
             ) == {:granos, nil, ["gluten", "egg"]}
    end

    test "the database rejects a code outside the Ingredient codes" do
      ingredient = insert_ingredient("Raw write", nil)

      assert {:error,
              %Postgrex.Error{postgres: %{constraint: "ingredients_allergens_proposed_check"}}} =
               Repo.query(
                 "UPDATE ingredients SET allergens_proposed = ARRAY['sesame']::varchar[] WHERE id = $1",
                 [Ecto.UUID.dump!(ingredient.id)]
               )
    end
  end

  describe "the Diet marks migration" do
    setup do
      unless Code.ensure_loaded?(@diet_marks_migration),
        do: Code.require_file(@diet_marks_migration_path)

      {:ok, diet_marks_migration: @diet_marks_migration}
    end

    test "the database accepts the Diet marks in allergens and allergens_proposed" do
      ingredient = insert_ingredient("Raw write", nil)

      assert {:ok, _result} =
               Repo.query(
                 "UPDATE ingredients SET allergens = ARRAY['meat', 'fish', 'animal_product']::varchar[], " <>
                   "allergens_proposed = ARRAY['meat', 'fish', 'animal_product']::varchar[] WHERE id = $1",
                 [Ecto.UUID.dump!(ingredient.id)]
               )
    end

    test "the database rejects a code outside the Ingredient codes in allergens" do
      ingredient = insert_ingredient("Raw write", nil)

      assert {:error, %Postgrex.Error{postgres: %{constraint: "ingredients_allergens_check"}}} =
               Repo.query(
                 "UPDATE ingredients SET allergens = ARRAY['sesame']::varchar[] WHERE id = $1",
                 [Ecto.UUID.dump!(ingredient.id)]
               )
    end

    test "a Diet mark is not a Hard restriction a User can declare" do
      changeset = UserHardRestriction.changeset(%UserHardRestriction{}, %{code: "meat"})

      refute changeset.valid?
      assert {_message, [validation: :inclusion, enum: _codes]} = changeset.errors[:code]
    end

    test "moves every reviewed Ingredient back to unreviewed, keeping its codes as the proposal",
         %{diet_marks_migration: migration} do
      reviewed_none = insert_ingredient("Pechuga de pollo", [])
      reviewed_codes = insert_ingredient("Milanesa de carne", ["gluten", "egg"])

      {:ok, unreviewed} =
        Catalog.create_ingredient(%{
          name: "Rogel",
          category: :otros,
          allergens: nil,
          allergens_proposed: ["gluten", "dairy"]
        })

      Repo.query!(migration.reset_sql())

      assert review_state(reviewed_none) == {nil, []}
      assert review_state(reviewed_codes) == {nil, ["gluten", "egg"]}
      assert review_state(unreviewed) == {nil, ["gluten", "dairy"]}
    end

    test "a later proposal refresh keeps the reviewed codes the reset moved to the proposal",
         %{diet_marks_migration: migration} do
      reviewed = insert_ingredient("Ravioles de carne", ["gluten", "egg"])

      Repo.query!(migration.reset_sql())

      {:ok, _} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Ravioles de carne",
          category: :otros,
          allergens_proposed: ["meat", "egg"]
        })

      assert review_state(reviewed) == {nil, ["gluten", "egg", "meat"]}
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

  defp review_state(ingredient) do
    Repo.one!(
      from(i in Ingredient,
        where: i.id == ^ingredient.id,
        select: {i.allergens, i.allergens_proposed}
      )
    )
  end

  defp allergens_by_name do
    from(i in Ingredient, select: {i.name, i.allergens})
    |> Repo.all()
    |> Map.new()
  end
end
