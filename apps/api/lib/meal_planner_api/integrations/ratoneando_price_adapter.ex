defmodule MealPlannerApi.Integrations.RatoneandoPriceAdapter do
  @moduledoc """
  Maps a Ratoneando response, as `GoScraperClient` parses it, into the price
  contract the planning agent reads.

  Ratoneando (`apps/scraper`, kept unpatched) does not return every field the
  contract needs, so this module derives them:

    * `brand`: read from the product name with `KnownBrands`; `""` when the
      name holds no known brand.
    * `currency`: always `"ARS"`.
    * `package_quantity`: `price / unit_price`, rounded to three decimals, in
      `package_unit` (`"kg"`, `"l"` or `"unit"`). Both are `nil` when the unit
      price is missing or the unit is not one prices are stored in.
    * `observed_at`: the response `timestamp` as a UTC `DateTime`; `nil` when it
      is absent or unreadable.
    * `from_cache`: always `:unknown`. The scraper serves cached responses with
      their original `timestamp` but does not say whether one was cached.

  The contract is documented in `docs/PRICE_ADAPTER_CONTRACT.md`. The module is
  pure: it makes no HTTP call and reads no configuration.
  """

  alias MealPlannerApi.Integrations.GoScraperClient
  alias MealPlannerApi.Integrations.RatoneandoPriceAdapter.KnownBrands

  @currency "ARS"
  @package_units ~w(kg l unit)

  @typedoc "One product in the price contract."
  @type price :: %{
          product_id: String.t(),
          source: String.t(),
          name: String.t(),
          brand: String.t(),
          price: number(),
          currency: String.t(),
          package_quantity: float() | nil,
          package_unit: String.t() | nil,
          observed_at: DateTime.t() | nil,
          from_cache: :unknown,
          unavailable: boolean()
        }

  @doc """
  Maps every product of a parsed scraper response into the price contract,
  in the order the scraper returned them.
  """
  @spec to_prices(GoScraperClient.scrape_result()) :: [price()]
  def to_prices(%{products: products} = result) do
    observed_at = observed_at(Map.get(result, :timestamp))

    Enum.map(products, &to_price(&1, observed_at))
  end

  defp to_price(product, observed_at) do
    {package_quantity, package_unit} = package(product)

    %{
      product_id: Map.get(product, :id, ""),
      source: product.source,
      name: product.name,
      brand: KnownBrands.match(product.name),
      price: product.price,
      currency: @currency,
      package_quantity: package_quantity,
      package_unit: package_unit,
      observed_at: observed_at,
      from_cache: :unknown,
      unavailable: product.unavailable
    }
  end

  defp package(%{price: price, unit_price: unit_price, unit: unit})
       when is_number(price) and price > 0 and is_number(unit_price) and unit_price > 0 and
              unit in @package_units do
    {Float.round(price / unit_price, 3), unit}
  end

  defp package(_product), do: {nil, nil}

  defp observed_at(timestamp) when is_binary(timestamp) do
    case DateTime.from_iso8601(timestamp) do
      {:ok, observed_at, _offset} -> observed_at
      {:error, _reason} -> nil
    end
  end

  defp observed_at(_timestamp), do: nil
end
