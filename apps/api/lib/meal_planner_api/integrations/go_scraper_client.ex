defmodule MealPlannerApi.Integrations.GoScraperClient do
  @moduledoc """
  HTTP client for the Go scraper API (Ratoneando).

  Fetches normalized product prices for a given ingredient query.
  Used only by the nightly `mix price_sync.run` task.

  ## Go API response shape

      %{
        "products" => [
          %{
            "id"         => "7790070318117",
            "source"     => "jumbo",
            "name"       => "Pollo entero 1kg",
            "price"      => 1500.0,
            "unitPrice"  => 15.0,   # price per base unit (kg/l/unit)
            "unit"       => "KG"
          },
          ...
        ],
        "failedScrapers" => ["carrefour"],
        "timestamp"      => "2026-10-21T14:51:40.123456789-03:00"
      }

  The scraper lives in `apps/scraper`. Its contract with this client
  (recorded in `apps/scraper/README.md`, "Contract with the API"):

    * The real response has no `unavailable` field: the scraper drops
      unavailable products itself, so the `false` default here is correct.
    * `unit` is usually an uppercase code (`"KG"`, `"LT"`, `"UN"`, `"MT"`).
      When the scraper reads no unit from the product name, it is the store's
      own unit as the store wrote it (often `"un"`), or absent.
      `parse_response/1` maps it to the unit prices are stored in.
    * With `ENV=release` the scraper answers `403` unless the `Referer`
      contains its `WEB_URL`. This client sends no `Referer`, so the scraper
      runs with `ENV=debug` for it.
    * A query with uppercase letters gets `403`; `fetch/1` downcases it.
    * `timestamp` is when the scraper built the response, kept as the raw
      string it sent. `RatoneandoPriceAdapter` reads it as the time the prices
      were observed (see `docs/PRICE_ADAPTER_CONTRACT.md`).

  ## Price normalization strategy

  We use `unitPrice` (not raw `price`) because it is already normalized
  per kg/l/unit — package size does not affect it. This means a 500g pack
  and a 1kg pack of the same product get the same unitPrice.

  To store in DB (cents, base unit), we do:

      price_per_unit_cents = round(unitPrice × 100)

  The `unit` field from the API (mapped by `parse_response/1`) tells us what
  the unitPrice is expressed in. It must match one of our `UnitConversion.from_unit` entries for that ingredient,
  otherwise we skip that product.
  """

  @base_url Application.compile_env(:meal_planner_api, :go_scraper_url, "http://localhost:3000")
  @timeout 15_000

  @typedoc "A single product result from the Go scraper API."
  @type scraped_product :: %{
          id: String.t(),
          source: String.t(),
          name: String.t(),
          price: float(),
          unit_price: float(),
          unit: String.t(),
          unavailable: boolean()
        }

  @typedoc "Full parsed API response."
  @type scrape_result :: %{
          products: [scraped_product()],
          failed_scrapers: [String.t()],
          timestamp: String.t() | nil
        }

  # -------------------------------------------------------------------------
  # Public API
  # -------------------------------------------------------------------------

  @doc """
  Fetches product prices for a single ingredient from the Go scraper API.

  Returns `{:ok, result}` or `{:error, :unreachable | :timeout | :parse_error}`.

  Calls `GET #{@base_url}/?q=<ingredient_name>` (query must be lowercase).
  """
  @spec fetch(String.t()) ::
          {:ok, scrape_result()} | {:error, :unreachable | :timeout | :parse_error}
  def fetch(ingredient_name) when is_binary(ingredient_name) do
    query = String.downcase(ingredient_name)
    url = "#{@base_url}/?q=#{URI.encode_www_form(query)}"

    case Req.get(url, receive_timeout: @timeout, retry: false) do
      {:ok, %{status: 200, body: body}} ->
        parse_response(body)

      {:ok, %{status: status}} when status >= 400 ->
        {:error, :unreachable}

      {:error, %Req.TransportError{reason: :timeout}} ->
        {:error, :timeout}

      {:error, _} ->
        {:error, :unreachable}
    end
  end

  @doc """
  Converts a `unitPrice` (float, price per base unit) to cents for storage.

      iex> GoScraperClient.unit_price_to_cents(15.99)
      1599
  """
  @spec unit_price_to_cents(float()) :: non_neg_integer()
  def unit_price_to_cents(unit_price) when is_float(unit_price) do
    round(unit_price * 100)
  end

  @doc "The configured Go scraper base URL."
  @spec base_url() :: String.t()
  def base_url, do: @base_url

  @doc """
  Parses a Go scraper response body.

  The scraper's `unit` codes become the units prices are stored in
  (`"KG"` -> `"kg"`, `"LT"` -> `"l"`, `"UN"` -> `"unit"`), in any case. Any
  other code, such as `"MT"` or a store's own `"gr"`, or a missing unit
  becomes `""`, so no `UnitConversion` matches it and `mix price_sync.run`
  skips that product.

  The response `timestamp` is kept as sent, or `nil` when absent, and each
  product's `id` is kept, or `""` when absent.
  """
  @spec parse_response(term()) :: {:ok, scrape_result()} | {:error, :parse_error}
  def parse_response(body) when is_map(body) do
    products =
      Enum.map(body["products"] || [], fn p ->
        %{
          id: p["id"] || "",
          source: p["source"] || "",
          name: p["name"] || "",
          price: p["price"] || 0.0,
          unit_price: p["unitPrice"] || 0.0,
          unit: stored_unit(p["unit"]),
          unavailable: p["unavailable"] || false
        }
      end)

    failed_scrapers = body["failedScrapers"] || []

    {:ok, %{products: products, failed_scrapers: failed_scrapers, timestamp: body["timestamp"]}}
  rescue
    _ -> {:error, :parse_error}
  end

  def parse_response(_), do: {:error, :parse_error}

  # -------------------------------------------------------------------------
  # Private
  # -------------------------------------------------------------------------

  # `apps/scraper/unit/mapper.go` codes, in upper case. When the scraper reads
  # no unit from the product name it passes the store's own unit through as
  # the store wrote it (`unit/extractor.go`), so "un" or "kg" arrive too.
  @stored_units %{"KG" => "kg", "LT" => "l", "UN" => "unit"}

  defp stored_unit(unit) when is_binary(unit),
    do: Map.get(@stored_units, String.upcase(unit), "")

  defp stored_unit(_unit), do: ""
end
