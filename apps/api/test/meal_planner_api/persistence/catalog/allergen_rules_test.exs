defmodule MealPlannerApi.Persistence.Catalog.AllergenRulesTest do
  use ExUnit.Case, async: true

  alias MealPlannerApi.Persistence.Accounts.UserHardRestriction
  alias MealPlannerApi.Persistence.Catalog.AllergenRules

  describe "codes_for_name/1" do
    test "returns the codes the name names, in catalog order" do
      assert AllergenRules.codes_for_name("Salsa de soja") == ["gluten", "soy"]
      assert AllergenRules.codes_for_name("Masitas") == ["gluten", "dairy", "egg"]
    end

    test "folds case and accents before matching" do
      assert AllergenRules.codes_for_name("ÑOQUIS") == ["gluten", "egg"]
      assert AllergenRules.codes_for_name("Maní tostado") == ["peanut"]
    end

    test "removes the phrases a rule strips before that rule matches" do
      assert AllergenRules.codes_for_name("Harina de maíz") == []
      assert AllergenRules.codes_for_name("Leche de almendras") == ["tree_nut"]
    end

    test "returns [] for a name no rule recognises" do
      assert AllergenRules.codes_for_name("Rogel") == []
      assert AllergenRules.codes_for_name("") == []
    end

    test "only returns Hard restriction codes" do
      codes = AllergenRules.codes_for_name("Mix de frutos secos con salsa de soja y huevo")

      assert codes != []
      assert codes -- UserHardRestriction.codes() == []
    end
  end
end
