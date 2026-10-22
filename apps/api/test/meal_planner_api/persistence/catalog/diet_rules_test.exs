defmodule MealPlannerApi.Persistence.Catalog.DietRulesTest do
  @moduledoc """
  The codes each Diet forbids on an Ingredient (issue #441).
  """
  use ExUnit.Case, async: true

  alias MealPlannerApi.Persistence.Accounts.UserHardRestriction
  alias MealPlannerApi.Persistence.Catalog.{DietRules, Ingredient}

  describe "forbidden_codes/1" do
    test "vegetarian forbids meat and fish" do
      assert DietRules.forbidden_codes(:vegetarian) == ["meat", "fish"]
    end

    test "vegan forbids meat, fish, animal product, dairy and egg" do
      assert DietRules.forbidden_codes(:vegan) ==
               ["meat", "fish", "animal_product", "dairy", "egg"]
    end

    test "pescatarian forbids meat" do
      assert DietRules.forbidden_codes(:pescatarian) == ["meat"]
    end

    test "celiac forbids gluten" do
      assert DietRules.forbidden_codes(:celiac) == ["gluten"]
    end

    test "omnivore and no Diet forbid nothing" do
      assert DietRules.forbidden_codes(:omnivore) == []
      assert DietRules.forbidden_codes(nil) == []
    end

    test "every forbidden code is a code an Ingredient can carry" do
      for diet <- [:vegetarian, :vegan, :pescatarian, :celiac] do
        assert DietRules.forbidden_codes(diet) -- Ingredient.codes() == []
      end
    end
  end

  describe "excludes?/2" do
    test "vegetarian excludes an Ingredient with meat or fish, and keeps the rest" do
      assert DietRules.excludes?(:vegetarian, ["meat"])
      assert DietRules.excludes?(:vegetarian, ["fish", "shellfish"])
      refute DietRules.excludes?(:vegetarian, ["dairy", "egg"])
      refute DietRules.excludes?(:vegetarian, [])
    end

    test "vegan excludes every animal product, and keeps the rest" do
      for code <- ["meat", "fish", "animal_product", "dairy", "egg"] do
        assert DietRules.excludes?(:vegan, [code]), "vegan keeps #{code}"
      end

      refute DietRules.excludes?(:vegan, ["gluten", "soy"])
      refute DietRules.excludes?(:vegan, [])
    end

    test "pescatarian excludes meat and keeps fish" do
      assert DietRules.excludes?(:pescatarian, ["meat"])
      refute DietRules.excludes?(:pescatarian, ["fish"])
      refute DietRules.excludes?(:pescatarian, [])
    end

    test "celiac excludes gluten and keeps meat" do
      assert DietRules.excludes?(:celiac, ["gluten"])
      refute DietRules.excludes?(:celiac, ["meat"])
      refute DietRules.excludes?(:celiac, [])
    end

    test "an unreviewed Ingredient (allergens NULL) is excluded for every Diet" do
      for diet <- [:vegetarian, :vegan, :pescatarian, :celiac] do
        assert DietRules.excludes?(diet, nil), "#{diet} keeps an unreviewed Ingredient"
      end
    end

    test "omnivore and no Diet exclude nothing, not even an unreviewed Ingredient" do
      refute DietRules.excludes?(:omnivore, nil)
      refute DietRules.excludes?(nil, nil)
      refute DietRules.excludes?(:omnivore, ["meat"])
    end
  end

  describe "the Diet marks" do
    test "are Ingredient codes but not Hard restriction choices" do
      assert DietRules.mark_codes() == ["meat", "fish", "animal_product"]
      assert Ingredient.codes() == UserHardRestriction.codes() ++ DietRules.mark_codes()

      for code <- DietRules.mark_codes() do
        refute code in UserHardRestriction.codes()
      end
    end
  end
end
