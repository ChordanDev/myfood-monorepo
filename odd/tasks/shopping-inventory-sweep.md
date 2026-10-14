# Shopping & inventory sweep (issues #48 and #233)

## Objective

The mobile shopping and inventory features run on API caches only, and the API
shopping, rebuilder, inventory and price code has no public function that
nothing reaches. Then (#233) the plan store loses its always-empty `recipes`
key.

## Problem and why

Issue #48 (S10) closes spec #5. After S2 to S8 the features talk to the API,
but leftovers remain: the mobile Inventory catalog is still seeded from
`MOCK_INGREDIENTS`, with an uncalled getter and a "Temporary" local consume,
and the API keeps service and repo functions that only tests (or nobody) call.
Issue #233 is the last leftover of the recipes sweep (#224).

## Scope

- API: `services/shopping_service.ex`, `services/shopping_rebuilder.ex`,
  `services/inventory_service.ex`, `data/price_repo.ex`, plus
  `ShoppingRepo.list_supermarkets/0` (its only caller is a dead service
  function), and their tests.
- Mobile: `features/inventory/store/useInventoryStore.ts`, `mocks/domainMocks.ts`,
  the shopping tests that seed the inventory and plan stores,
  `store/useMealPlanStore.ts`, `apps/mobile/CLAUDE.md`.

## Constraints

- `/planning/rescue` and `ShoppingChannel` stay (issue: out of scope, no web
  client) and are listed as kept with evidence in the PR.
- Functions reached internally from a routed path stay public when tests
  exercise them directly: `InventoryService.freshness_status/2` (via
  `inventory_view` → `GET /inventory`) and `PriceRepo.latest_prices/1` (via
  `compute_all_recipe_prices` → `mix price_sync`).
- Paths owned by other lanes of 2026-10-14 are not touched.
- One PR per issue; #233 is stacked on #48.

## Decisions

- `consumeIngredient` is deleted. #145 (late confirmation) consumes Inventory
  on the API (oldest lot first, `cooking` mutation events); the app sends the
  answer and refreshes its Inventory cache, so it does not need a local
  consume.

## Tasks

- [x] **T1 API dead functions (#48)** (route: delegated writer; 6+ files)
  - Delete `ShoppingService.build_shopping_list_from_schedule`,
    `start_checkout_session`, `list_supermarkets`, `create_checkout_from_range`
    and the helpers and alias they orphan; `ShoppingRepo.list_supermarkets/0`.
  - Delete `InventoryService.get_inventory_item/2`.
  - Delete `PriceRepo.latest_prices_map`, `best_price_per_ingredient`,
    `get_recipe_price`, `get_recipe_prices` and their `is_function` tests.
  - Checks: `mix compile --warnings-as-errors`, `mix format --check-formatted`,
    `mix credo --strict`, `mix dialyzer`, `mix test`.
  - Test-first exception: deletion of unreferenced code; the suite is the proof.
- [x] **T2 Mobile inventory catalog (#48)** (route: same delegated writer)
  - Remove `ingredients`, `getIngredient`, `consumeIngredient` and the
    `MOCK_INGREDIENTS` seeding from `useInventoryStore`; bump the persist
    version and drop the stored catalog in `migrate`; delete `MOCK_INGREDIENTS`.
  - The two shopping tests stop seeding `ingredients`.
  - Checks: `npm run typecheck`, `npm run lint`, `npx jest --ci`.
  - Test-first: RED on the migrate test that drops a stored catalog.
- [ ] **T3 Plan store recipes key (#233)** (route: inline; mechanical)
  - Remove `recipes` from `MealPlanState` and initial state; shopping tests
    seed `{ entries: [] }`; drop the `initial.recipes` assertion; rewrite
    `apps/mobile/CLAUDE.md:18`.
  - Checks: `npm run typecheck`, `npm run lint`, `npx jest --ci`.

## Progress

- Explored with a read-only explorer (sonnet): dead functions confirmed, with
  the two refinements above.

- T1 done in `37ff227` (delegated writer, sonnet). `mix compile
  --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict`
  clean; `mix test` 1877 passed, 0 failed. `mix dialyzer` locally reports 9
  `call_without_opaque` MapSet errors in code this change does not touch, on
  Elixir 1.20 / OTP 29; CI pins Elixir 1.17.3 / OTP 27.3 and is green on main,
  so CI is the dialyzer check of record.
- T2 done in `fa6642e` (same writer). RED: 5 failing store tests before the
  change; GREEN: 28 passed. After `npm ci`: `npm run typecheck` clean,
  `npm run lint` 0 errors (4 warnings in untouched files), `npx jest --ci`
  153 suites, 2389 tests passed.
- Doc references left as history: `apps/api/openspec/artifacts/v2-planning-design.md`
  and `v2-planning-tasks.md` mention `best_price_per_ingredient` and
  `get_recipe_price` (planning artifacts, not current docs).

- Native review of `37ff227..` on base `45d74ab` (medium, 14 files, 438
  lines): consent granted, one reliability lens, no findings, approved and
  acknowledged (lineage `review-347d19c2bdc35aee`).

## Next step

PR for #48, then T3 (#233) stacked on it.
