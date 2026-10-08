# Feature: Inventory read and manual edits (issue #42, S4)

Ticket: ChordanDev/myfood-monorepo#42, part of spec #5 (shopping list, inventory and leftovers).
Base: `main` at `f4b849d`. Branch: `claude/epic-brattain-b6d202`.

## Objective

The Inventory screen shows lots with milli quantities, units and freshness sections from the API. A User adds an item from outside the app, sets a quantity or disposes of a lot, and every change is on the ledger. The mobile inventory store becomes a cache of the last read.

## Problem

- The API inventory routes already sit in the `:mobile_casing` scope, but the read uses `ingredient_name`, `expired_at`, `inferred_expired_at`, `freshness_status`, and has no `is_leftover` or `notes`.
- The three writes return summaries, not the resulting item and its Inventory mutation event. `expiresAt` is ignored on add-extra (the service reads `expired_at`). Errors are a flat `422 {error: ...}`, not the envelope.
- The mobile store seeds from `MOCK_INVENTORY`, persists it, carries `confidence` and float quantities, and never calls the API.

## Scope and constraints

- In scope: `GET /api/inventory`, `add-extra`, `quantity`, `dispose`; two new columns; the mobile inventory API client, store, screen and edit flows; tests on both sides.
- Out of scope: offline queue, `actionId`, `inventoryVersion` (spec recommendation (a), mutations are online-only); voice adjustment; shopping, cart and checkout routes; Prepared leftovers; the shopping channel on mobile.
- No new routes. No hard delete of lots (see D1).
- Generated artifacts in English; user-facing mobile copy follows the existing Spanish UI.

## Design

### Decisions

- **D1 Dispose stays a soft delete.** The lot row is kept at quantity 0 with operation `delete`, because `inventory_mutation_events.inventory_item_id` is `on_delete: :delete_all` and a hard delete would erase the ledger the ticket requires. Zero-quantity lots are hidden from `GET /api/inventory` and from `totals`. Response: `{ disposed: true, mutation_event }`.
- **D2 Item shape.** `id, ingredient_id, name, category, quantity_milli, unit, source_kind, acquired_at, expires_at, freshness, is_leftover, notes`. `expires_at` is the explicit date when present, else the inferred one; `inferred_expired_at` leaves the payload.
- **D3 Lot identity.** A lot created with `notes` or `is_leftover: true` stays distinct; an add with neither merges into the anonymous lot as today.
- **D4 Errors.** Every inventory controller error goes through the `ApiError` envelope: `validation_error` (422) for invalid input, `inventory_item_not_found` (404) for an unknown or malformed item id. New codes are registered in the four contract places and above the planning-channel block in `@codes`.
- **D5 Milli scale.** Thousandths of the unit, per `docs/GLOSSARY.md`. Mobile stores integers and divides by 1000 only when formatting.
- **D6 Categories.** The mobile inventory feature maps API categories to its display categories; unknown values fall back to the generic one.
- **D7 Edit sheet.** For an existing lot the sheet sets the quantity or disposes. Name and notes are read-only there, since no endpoint edits them; notes, expiry and the leftover flag are given when adding.
- **D8 Cross-feature callers.** The `ingredients` catalogue in the store is untouched. `addItem` (shopping purchase) and `consumeIngredient` (cooking) remain as cache-only shims in milli until the checkout and cooking slices replace them; readers move to `quantityMilli`.
- **D10 Expiry format.** `expires_at` is always an ISO date (`YYYY-MM-DD`), explicit or inferred; T1 shipped a mixed datetime/date value and T2 unifies it.
- **D9 Add by name.** `add-extra` keeps accepting `ingredient_name` (existing behaviour) next to `ingredient_id`, so the mobile add flow works before an ingredient catalogue client exists.

## Tasks

- [x] **T1 API read shape and new columns.** Migration and schema for `is_leftover` (boolean, default false, not null) and `notes` (nullable text); item serialization per D2; zero-quantity lots hidden (D1). Route: delegated direct (migration, schema, service, tests).
- [x] **T2 API writes and envelope errors.** `add-extra` reads `expires_at`, `notes`, `is_leftover` (D3, D9); the three writes return `{ item, mutation_event }` or `{ disposed: true, mutation_event }`; errors per D4 including the mobile code contract files; integration guide updated. Route: delegated direct (controller, service, persistence, ApiError, mobile contract, tests, docs).
- [x] **T3 Mobile inventory client and cache store.** `features/inventory/api`, API types, milli formatting and input conversion, category mapping (D6); store without fixture seeding or `confidence`, integer milli, replaced by read and mutation responses; cross-feature callers adapted (D8). Route: delegated direct (many files across features).
- [x] **T4 Mobile screen and edit flows.** Inventory screen renders freshness sections from the API; add, set-quantity and dispose flows call the API and surface envelope errors (D7); screen and flow tests against a fake API with frozen fixtures. Route: delegated direct (screens, components, tests).

## Acceptance criteria (from the ticket)

1. `GET /api/inventory` returns sections, `byCategory`, `extras` and `totals` in camelCase; each item carries `freshness`, `isLeftover` and `notes`. (T1)
2. `add-extra` accepts `expiresAt`, `notes`, `isLeftover`; `quantity` sets; `dispose` deletes; each returns the resulting item (or `{ disposed: true }`) and its `mutationEvent`; negative sets give `validation_error`. (T2)
3. The mobile store no longer seeds from fixtures, `confidence` is gone, quantities are integers formatted on display. (T3)
4. Inventory screen and edit flows tested against fixtures. (T4)

## Checks

- API, from `apps/api`: `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix test`. Baseline on a fresh database at `f4b849d`: 1206 passed, 20 skipped.
- Mobile, from `apps/mobile`: `npm run lint`, `npm run typecheck`, `npm test`. Baseline 92 suites, 1471 passed, 4 lint warnings.
- Test-first: RED observed before GREEN for each behaviour change on both sides.

## Delivery

Forecast: about 1100 to 1400 authored changed lines, above the 400-line budget. Each task is one work-unit commit and one candidate slice (T1, T2, T3, T4). Chain strategy and pull requests are decided by the user at delivery.

## Progress

| Task | Commit | Checks | Review |
| ---- | ------ | ------ | ------ |
| T1   | `650b214` | RED 7 failing of 43, GREEN 102 passed; format, compile clean; `mix test` 1211 passed, 20 skipped; parent spot check 27 passed | medium, under budget; covered by review `review-17aa8dd30a7a45bb` (approved, acknowledged) |
| T2   | `40b26fb` | RED 28 failing of 76 (API), 2 of 8 (mobile contract); GREEN 76 and 8; format, compile clean; `mix test` 1226 passed, 20 skipped; mobile typecheck clean, lint 0 errors 4 warnings; parent spot check 16 passed | high (auth hot path); consent granted; four lenses approved, acknowledged, authority burned |
| T3   | `9e84cc1` | RED 23 failing of 28 (new modules), GREEN 89; type migration had no RED-first (boundary conversions removed: 56 failing, restored: passing); two shopping tests outside the writer surface patched by the parent and squashed in; commit not verified in isolation | medium, slice budget reached; consent granted; START refused with `lens_context_budget_exceeded`, no review ran |
| T4   | `84356fb` | RED then GREEN per unit (inventory folder 13 suites, 206 tests); final tree: lint 0 errors 4 warnings, typecheck clean, `npm test` 97 suites, 1594 passed; no simulator run | same candidate as T3: not reviewed |

Next step: user decisions below, then delivery. Reviewed boundary: `40b26fb` (T3 and T4 are unreviewed).

## Notes and follow-ups

- Checkout and cooking slices must replace the `addItem` and `consumeIngredient` shims (D8).
- No endpoint edits `notes` or the name of an existing lot (D7).
- Needs a decision: the mobile slice (`40b26fb..84356fb`, 4713 lines) exceeds the native reviewer context budget; review it as smaller candidates or deliver under ordinary policy.
- Needs a decision: `inventory-storage` now persists real Account data and nothing clears it on sign-out, so a second Account on the same device sees the previous lots until its first read.
- Add flow sends `ingredientName` (D9): the mobile scope has no ingredient catalogue route, and an unknown name surfaces only the generic `validation_error` message.
- The catalogue is still `MOCK_INGREDIENTS` (ids `i1`...), so shopping and recipe never match stock against API lots, and the `addItem`/`consumeIngredient` shim writes are lost on the next read (D8); only the Inventory screen calls `refresh()`.
- Dispose moved from the row trash button into the edit sheet (D7); `updateItem`, `removeItem` and `InventoryItemPatch` are gone.
- Stale after this change: the screen subtitle "Cantidades aproximadas...", `apps/mobile/docs/design/screens/Inventario.dc.html`, `apps/mobile/odd/tasks/inventory-screen.md`.
- T2 moved every `InventoryController` error to the envelope, including voice preview/apply and `/api/planning/rescue`; an unrecognised reason is now 500 `unknown_error`.
- The mutation event is serialized with `trigger_type` (schema field name), so the wire key is `triggerType`.
- Advisory review findings on T1+T2 (non-blocking, later work): `notes` has no length bound (`inventory_item.ex:16`); a nil `mutation_event` would be dereferenced in the write result (`inventory_service.ex:87-98`); the controller catch-all drops the failure reason and its reason allowlist can drift from the service (`inventory_controller.ex:94-115`); zero lots are filtered in memory (`inventory_service.ex:45-48`); a date-boundary flake risk in `inventory_controller_test.exs:293-326`; `acquired_at`/price are not validated on add-extra (`inventory_service.ex:541-542`).
