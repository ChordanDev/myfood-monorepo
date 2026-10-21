defmodule MealPlannerApi.Integrations.RatoneandoPriceAdapterTest do
  use ExUnit.Case, async: true

  alias MealPlannerApi.Integrations.GoScraperClient
  alias MealPlannerApi.Integrations.RatoneandoPriceAdapter
  alias MealPlannerApi.Integrations.RatoneandoPriceAdapter.KnownBrands

  # The scraper encodes Go's `time.Now()`: nanoseconds and a local offset.
  @timestamp "2026-10-21T14:51:40.123456789-03:00"

  defp scrape_result(products, timestamp \\ @timestamp) do
    %{products: products, failed_scrapers: ["carrefour"], timestamp: timestamp}
  end

  defp product(overrides \\ %{}) do
    Map.merge(
      %{
        id: "123",
        source: "jumbo",
        name: "Fideos Spaghetti Lucchetti 500 g",
        price: 1250.0,
        unit_price: 2500.0,
        unit: "kg",
        unavailable: false
      },
      overrides
    )
  end

  describe "to_prices/1" do
    test "maps a product into the price contract" do
      assert RatoneandoPriceAdapter.to_prices(scrape_result([product()])) == [
               %{
                 product_id: "123",
                 source: "jumbo",
                 name: "Fideos Spaghetti Lucchetti 500 g",
                 brand: "Lucchetti",
                 price: 1250.0,
                 currency: "ARS",
                 package_quantity: 0.5,
                 package_unit: "kg",
                 observed_at: ~U[2026-10-21 17:51:40.123456Z],
                 from_cache: :unknown,
                 unavailable: false
               }
             ]
    end

    test "maps every product, each in ARS and with an unknown cache state" do
      products = [
        product(),
        product(%{id: "2", name: "Arroz largo fino 1 kg", unit_price: 1250.0}),
        product(%{id: "3", source: "dia", name: "Leche entera 1 L", unit: "l"})
      ]

      prices = RatoneandoPriceAdapter.to_prices(scrape_result(products))

      assert Enum.map(prices, & &1.product_id) == ["123", "2", "3"]
      assert Enum.all?(prices, &(&1.currency == "ARS"))
      assert Enum.all?(prices, &(&1.from_cache == :unknown))
      assert Enum.all?(prices, &(&1.observed_at == ~U[2026-10-21 17:51:40.123456Z]))
    end

    test "leaves the brand empty when the name matches no known brand" do
      [price] =
        RatoneandoPriceAdapter.to_prices(
          scrape_result([product(%{name: "Arroz largo fino 1 kg"})])
        )

      assert price.brand == ""
    end

    test "matches a brand regardless of case and accents" do
      [price] =
        RatoneandoPriceAdapter.to_prices(
          scrape_result([product(%{name: "LECHE ENTERA LA SERENISIMA 1 L", unit: "l"})])
        )

      assert price.brand == "La Serenísima"
    end

    test "matches a brand only as whole words, never inside another word" do
      [price] =
        RatoneandoPriceAdapter.to_prices(
          scrape_result([product(%{name: "Galletitas Incaicas 200 g"})])
        )

      assert price.brand == ""
    end

    # "Noel" was a brand, but "Papá Noel" is in many Christmas product names.
    test "does not read a brand from the words Papá Noel" do
      prices =
        RatoneandoPriceAdapter.to_prices(
          scrape_result([
            product(%{name: "Figura Papá Noel de chocolate Arcor 30 g"}),
            product(%{name: "Pan Dulce Papá Noel 400 g"})
          ])
        )

      assert Enum.map(prices, & &1.brand) == ["Arcor", ""]
    end

    test "takes the brand that appears first when the name has several" do
      [price] =
        RatoneandoPriceAdapter.to_prices(
          scrape_result([product(%{name: "Yogur Ilolay con cereales Arcor 190 g"})])
        )

      assert price.brand == "Ilolay"
    end

    test "rounds the package quantity to three decimals" do
      [price] =
        RatoneandoPriceAdapter.to_prices(
          scrape_result([product(%{price: 999.9, unit_price: 3333.0})])
        )

      assert price.package_quantity == 0.3
    end

    # Go encodes a whole float64 such as 1500.0 as `1500`, so prices can arrive as integers.
    test "derives the package quantity from prices sent as whole numbers" do
      [price] =
        RatoneandoPriceAdapter.to_prices(
          scrape_result([product(%{price: 1500, unit_price: 1000})])
        )

      assert price.package_quantity == 1.5
    end

    test "leaves the package quantity and unit nil when the unit price is missing" do
      [price] = RatoneandoPriceAdapter.to_prices(scrape_result([product(%{unit_price: 0.0})]))

      assert {price.package_quantity, price.package_unit} == {nil, nil}
    end

    test "leaves the package quantity and unit nil when the unit is not one prices are stored in" do
      [price] = RatoneandoPriceAdapter.to_prices(scrape_result([product(%{unit: ""})]))

      assert {price.package_quantity, price.package_unit} == {nil, nil}
    end

    test "leaves observed_at nil when the timestamp is absent or unreadable" do
      for timestamp <- [nil, "yesterday"] do
        [price] = RatoneandoPriceAdapter.to_prices(scrape_result([product()], timestamp))

        assert price.observed_at == nil
      end
    end

    test "keeps an unavailable flag as the client read it" do
      [price] = RatoneandoPriceAdapter.to_prices(scrape_result([product(%{unavailable: true})]))

      assert price.unavailable == true
    end

    test "adapts what GoScraperClient parses from a real scraper body" do
      body = %{
        "products" => [
          %{
            "id" => "7790070318117",
            "source" => "carrefour",
            "name" => "Aceite de girasol Natura 1,5 L",
            "price" => 3000.0,
            "unit" => "LT",
            "unitPrice" => 2000.0
          }
        ],
        "failedScrapers" => [],
        "timestamp" => @timestamp
      }

      {:ok, result} = GoScraperClient.parse_response(body)

      assert [
               %{
                 product_id: "7790070318117",
                 brand: "Natura",
                 package_quantity: 1.5,
                 package_unit: "l",
                 observed_at: ~U[2026-10-21 17:51:40.123456Z]
               }
             ] = RatoneandoPriceAdapter.to_prices(result)
    end
  end

  describe "KnownBrands" do
    test "every known brand is documented in the price adapter contract" do
      doc = File.read!(Path.expand("../../../docs/PRICE_ADAPTER_CONTRACT.md", __DIR__))

      for brand <- KnownBrands.all() do
        assert doc =~ "| #{brand} |", "#{brand} is missing from PRICE_ADAPTER_CONTRACT.md"
      end
    end
  end
end
