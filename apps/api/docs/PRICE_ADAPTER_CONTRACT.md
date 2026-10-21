# Price adapter contract

`MealPlannerApi.Integrations.RatoneandoPriceAdapter` turns a Ratoneando response into the prices
the planning agent reads. Ratoneando (`apps/scraper`) stays unpatched (#410), so the adapter
derives every field the scraper does not return (#428, owner decision 9 in #421).

Reference: myfood `meal_planner_api/docs/price-scraper-contract.md`, the contract the planning
agent was written against. This adapter covers it without changing the scraper.

## Quick path

```elixir
{:ok, result} = GoScraperClient.fetch("fideos")
prices = RatoneandoPriceAdapter.to_prices(result)
```

The adapter is pure: no HTTP call, no configuration. It maps every product, in the order the
scraper returned them. `failed_scrapers` stays on `result` for the caller.

## Output

One map per product:

```elixir
%{
  product_id: "7790070318117",
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
```

| Field | Source | When it cannot be derived |
| --- | --- | --- |
| `product_id` | Product `id` | `""` |
| `source` | Product `source` (the supermarket) | `""` |
| `name` | Product `name` as sold | `""` |
| `brand` | Parsed from `name` with the known brands below | `""`, never a guess |
| `price` | Product `price`, one package, major units | `0.0` |
| `currency` | Always `"ARS"` | Never |
| `package_quantity` | `price / unitPrice`, rounded to three decimals | `nil` |
| `package_unit` | Product `unit`, as `GoScraperClient` stores it: `"kg"`, `"l"` or `"unit"` | `nil` |
| `observed_at` | Response `timestamp`, as a UTC `DateTime` | `nil` |
| `from_cache` | Always `:unknown` | Never |
| `unavailable` | Product `unavailable`, as `GoScraperClient` reads it | `false` |

## Derivation rules

- **Package quantity.** `unitPrice` is the price per kg, l or unit, so `price / unitPrice` is the
  package size in that unit: a 500 g pack at 2500 per kg gives `0.5` `"kg"`. When `price` or
  `unitPrice` is missing or zero, or the unit is not `kg`, `l` or `unit` (such as `MT` or a
  store's own `gr`), both `package_quantity` and `package_unit` are `nil`.
- **Observed at.** The scraper sets `timestamp` to Go's `time.Now()` when it builds the response
  (nanoseconds and a local offset, such as `2026-10-21T14:51:40.123456789-03:00`). The adapter
  reads it at microsecond precision in UTC. A cached response keeps the `timestamp` of the
  response that was cached, so it is not the request time.
- **From cache.** The scraper caches responses in Redis but does not say whether one was served
  from cache. The adapter answers `:unknown`, never `true` or `false`.
- **Currency.** Every supermarket the scraper covers sells in Argentina, so prices are ARS.
- **Brand.** See the next section.

## Known brands

The scraper returns no brand. The adapter looks for one of these brands in the product name,
ignoring case, accents and punctuation, and only as whole words ("Inca" is not found in
"Incaicas"). When the name holds several, the one that appears first wins; at the same position,
the longest. A name with none of them gets an empty brand.

The list lives in `MealPlannerApi.Integrations.RatoneandoPriceAdapter.KnownBrands`. A test fails
when a brand there is missing from this table, so add a brand in both places. Leave out brands
that are also common words or phrases in product names (such as "Disco", "Dia", "Vea", "Ser", or
"Noel", found in "Papá Noel"): they would match names that do not carry the brand.

| Brand |
| --- |
| Amanda |
| Arcor |
| Baggio |
| Bagley |
| Blancaflor |
| Cabrales |
| Cada Día |
| Cagnoli |
| Calchaquí |
| Cañuelas |
| Carrefour |
| Casancrem |
| Cepita |
| Chango |
| Cica |
| Coca-Cola |
| Cocinero |
| Cuisine & Co |
| Danone |
| Dánica |
| Dolca |
| Don Vicente |
| Dos Hermanos |
| Eco de los Andes |
| Fanacoa |
| Favorita |
| Finlandia |
| Gallo |
| Granja del Sol |
| Hellmann's |
| Ilolay |
| Inca |
| Knorr |
| La Campagnola |
| La Paulina |
| La Serenísima |
| La Virginia |
| Ledesma |
| Levité |
| Lira |
| Lucchetti |
| Maggi |
| Marolio |
| Matarazzo |
| McCain |
| Milkaut |
| Molto |
| Morixe |
| Natura |
| Nescafé |
| Paladini |
| Paty |
| Pepsi |
| Playadito |
| Pureza |
| Quilmes |
| Rosamonte |
| Sancor |
| Savora |
| Swift |
| Taragüí |
| Terrabusi |
| Tonadita |
| Tregar |
| Verónica |
| Villa del Sur |
| Villavicencio |
| Yogurísimo |

## GoScraperClient fields the adapter needs

`GoScraperClient.parse_response/1` keeps two fields for the adapter, without changing the keys it
already returned to `mix price_sync.run`:

| Key | From | When absent |
| --- | --- | --- |
| `timestamp` (on the result) | Response `timestamp`, as the raw string | `nil` |
| `id` (on each product) | Product `id` | `""` |

`GoScraperClient.Mock` returns both too: the current time and an id per supermarket and
ingredient.

## Upstream

Proposing `brand`, `currency`, `packageQuantity`, `observedAt` and `cached` to
matiasbontempo/ratoneando-go is optional and not done here. If upstream ships them, the adapter
can read them instead of deriving them.
