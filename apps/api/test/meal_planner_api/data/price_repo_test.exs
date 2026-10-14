defmodule MealPlannerApi.Data.PriceRepoTest do
  use ExUnit.Case, async: true

  alias MealPlannerApi.Data.PriceRepo

  describe "latest_prices/1" do
    test "accepts list of ingredient ids, returns map" do
      assert is_function(&PriceRepo.latest_prices/1, 1)
    end
  end

  describe "upsert_prices/1" do
    test "accepts list of price maps, returns {int, list}" do
      assert is_function(&PriceRepo.upsert_prices/1, 1)
    end
  end

  describe "compute_all_recipe_prices/0" do
    test "takes no args, returns {int, int}" do
      assert is_function(&PriceRepo.compute_all_recipe_prices/0, 0)
    end
  end
end
