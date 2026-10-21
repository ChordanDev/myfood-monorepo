defmodule MealPlannerApi.Integrations.GoScraperClientTest do
  use ExUnit.Case, async: true

  alias MealPlannerApi.Integrations.GoScraperClient

  describe "fetch/1" do
    test "has correct arity" do
      assert is_function(&GoScraperClient.fetch/1, 1)
    end

    test "accepts a string ingredient name" do
      result = GoScraperClient.fetch("pollo")
      assert is_tuple(result)
    end
  end

  describe "parse_response/1" do
    # The shape `apps/scraper` answers: `unit` is an uppercase code or `null`,
    # and there is no `unavailable` field.
    defp scraper_body(products) do
      %{
        "products" => products,
        "failedScrapers" => ["carrefour"],
        "timestamp" => "2026-10-21T14:51:40Z"
      }
    end

    defp scraper_product(unit) do
      %{
        "id" => "1",
        "source" => "jumbo",
        "name" => "Leche entera 1 L",
        "price" => 1500.0,
        "unit" => unit,
        "unitPrice" => 1500.0
      }
    end

    test "maps the scraper unit codes to the units prices are stored in" do
      body = scraper_body(Enum.map(["KG", "LT", "UN"], &scraper_product/1))

      assert {:ok, %{products: products}} = GoScraperClient.parse_response(body)
      assert Enum.map(products, & &1.unit) == ["kg", "l", "unit"]
    end

    # When the scraper cannot read a unit from the product name it passes the
    # store's own unit through as the store wrote it, such as "un" or "kg".
    test "maps a store unit passed through in lowercase the same way" do
      body = scraper_body(Enum.map(["kg", "lt", "un", "Kg"], &scraper_product/1))

      assert {:ok, %{products: products}} = GoScraperClient.parse_response(body)
      assert Enum.map(products, & &1.unit) == ["kg", "l", "unit", "kg"]
    end

    test "leaves a unit it cannot store empty, so no unit conversion matches it" do
      body = scraper_body([scraper_product("MT"), scraper_product(nil)])

      assert {:ok, %{products: products}} = GoScraperClient.parse_response(body)
      assert Enum.map(products, & &1.unit) == ["", ""]
    end

    test "keeps the other fields and the failed scrapers" do
      assert {:ok, result} = GoScraperClient.parse_response(scraper_body([scraper_product("LT")]))

      assert result.failed_scrapers == ["carrefour"]

      assert [
               %{
                 source: "jumbo",
                 name: "Leche entera 1 L",
                 price: 1500.0,
                 unit_price: 1500.0,
                 unavailable: false
               }
             ] = result.products
    end

    test "keeps the response timestamp and each product id" do
      assert {:ok, result} = GoScraperClient.parse_response(scraper_body([scraper_product("KG")]))

      assert result.timestamp == "2026-10-21T14:51:40Z"
      assert [%{id: "1"}] = result.products
    end

    test "leaves the timestamp nil and the product id empty when they are absent" do
      body =
        [scraper_product("KG") |> Map.delete("id")]
        |> scraper_body()
        |> Map.delete("timestamp")

      assert {:ok, %{timestamp: nil, products: [%{id: ""}]}} =
               GoScraperClient.parse_response(body)
    end

    test "still reads an unavailable flag when one is sent" do
      product = Map.put(scraper_product("KG"), "unavailable", true)

      assert {:ok, %{products: [%{unavailable: true}]}} =
               GoScraperClient.parse_response(scraper_body([product]))
    end

    test "rejects a body that is not a JSON object" do
      assert GoScraperClient.parse_response("Forbidden.") == {:error, :parse_error}
    end
  end

  describe "Mock.fetch/1" do
    alias MealPlannerApi.Integrations.GoScraperClient.Mock

    test "answers with a timestamp and product ids, like the real client" do
      assert {:ok, %{timestamp: timestamp, products: [_ | _] = products}} = Mock.fetch("arroz")

      assert {:ok, _observed_at, _offset} = DateTime.from_iso8601(timestamp)
      assert Enum.all?(products, &(is_binary(&1.id) and &1.id != ""))
    end
  end

  describe "unit_price_to_cents/1" do
    test "converts float price to cents (integer)" do
      assert GoScraperClient.unit_price_to_cents(15.99) == 1599
    end

    test "rounds to nearest cent" do
      assert GoScraperClient.unit_price_to_cents(15.995) == 1600
    end

    test "handles zero" do
      assert GoScraperClient.unit_price_to_cents(0.0) == 0
    end
  end

  describe "base_url/0" do
    test "returns a string URL" do
      url = GoScraperClient.base_url()
      assert is_binary(url)
      assert url =~ "http"
    end
  end
end
