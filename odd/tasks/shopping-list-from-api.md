# Shopping list from the API (issue #39, S1)

Locator: `odd/tasks/shopping-list-from-api.md` · Engram mirror: `odd/shopping-list-from-api/tasks`
Branch: `claude/issue-39-b92a2a` · Parent spec: #5 · Blocked by: #11 (merged, PRs #63-#66)

## Objective

The Shopping list screen shows exactly what the plan needs minus Inventory, grouped by
Ingredient category, optionally only until a chosen date and optionally per meal. The mobile
shopping store becomes a cache of the last read plus the User's filter choices.

## Problem

`GET /api/shopping-list` returns a snake_case-era shape (`items[]` with nested `lines[]`,
flat counters), takes `from_date`/`to_date` and computes "today" as `Date.utc_today()`.
The mobile app never calls it: it derives the list locally from the mock plan and the mock
Inventory.

## Scope

- API: Account timezone foundation (column, tz database, one "today for this Account" function).
- API: pure rebuilder functions for the date limit and the two groupings.
- API: `GET /api/shopping-list` contract `{ planned[], manual[], cart, totals }`.
- Mobile: shopping API module, store as a cache, Shopping screen reading it.

Out of scope: manual items and removed/restored (S2, #40), Cart lease (S3, #41), checkout
(S5, #43), writing the Account timezone (O4, #20), supermarket assignment (route unchanged).

## Constraints

- camelCase comes from the `:mobile_casing` router scope; services keep emitting snake_case.
- "Today" is the Account's today (X2, #12): the current date in the Account's stored IANA
  timezone, UTC while none is stored, computed server-side. The app sends no local date.
- No new dependency other than the tz database the issue asks for.

## Decisions taken while planning (not in the issue text)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | The payload stays inside the `{ data: ... }` wrapper every product route uses. | Existing convention; the issue describes the payload. |
| D2 | Without `untilDate` the list covers every upcoming uncooked Scheduled meal from the Account's today. `from_date`/`to_date` are no longer read. | Spec story 3 (filter picks 5 days of a 10 day plan); X2 forbids a client date. |
| D3 | `untilDate` malformed or before the Account's today is a `validation_error` (422, envelope). | Issue: validation of `untilDate` is relative to the Account's today. |
| D4 | Line `id`: the Shopping item id for `groupBy=meal`; `"<ingredientId>:<unit>"` for `groupBy=ingredient`. Each allocation also carries `itemId`. | Aggregated lines need a stable id; S3 mark-cart needs the item ids. Additive to the spec. |
| D5 | Aggregated status: the shared status when every allocation agrees, otherwise `needed`. `supermarketId`: the shared value, otherwise `null`. | Deterministic and never claims a line is in the Cart when part of it is not. |
| D6 | `pending` reads as `needed`, `in_cart` as `in_cart`; other persisted statuses are not listed. `source` is `planned_meal`; `manual` is `[]`. | Issue: `manual[]` is empty until S2; `removed` has no server status until S2. |
| D7 | `totals`: `{ needed, inCart, removed, estimatedCents }` counting the planned lines of the response. | The issue leaves `totals` unspecified; mirrors the counters the screen shows. |
| D8 | The response also carries `plannedDates[]`: the dates with upcoming uncooked Scheduled meals from the Account's today, ignoring `untilDate`. | The date pill needs selectable days without a device-local "today". Additive to the spec. |
| D9 | `cart` is the caller's active Cart `{ sessionId, leaseExpiresAt }` or `null`. | Spec #5 shopping list read. |
| D10 | tz database: the `tz` package (`Tz.TimeZoneDatabase`). | No runtime download or writable data dir, unlike `tzdata`. |

## Tasks

- [x] **T1 — Account timezone foundation** (route: delegated, writer trigger: migration + schema + config + module + tests)
  - `accounts.timezone` nullable column; schema field validated as a known IANA zone when present.
  - tz database dependency configured as the Elixir time zone database.
  - One function answering "today for this Account" (UTC while none is stored), with an injectable instant.
  - Checks: focused unit tests (zone ahead of / behind UTC around midnight, nil, unknown zone), `mix format --check-formatted`, `mix compile --warnings-as-errors`.
- [x] **T2 — Rebuilder: date limit and groupings** (route: delegated, same writer run as T1, disjoint files)
  - Pure `limit_to_date/2` and `group_lines/2` (`:ingredient` aggregates with allocations, `:meal` splits).
  - Checks: `shopping_rebuilder_test.exs` pure tests, RED observed before GREEN.
- [ ] **T3 — `GET /api/shopping-list` contract** (route: delegated, writer trigger: service + controller + several test files + docs)
  - New payload, `untilDate`/`groupBy` parsing and validation, Account's today for pruning and range.
  - Tests bound to the old shape updated; `frontend_integration_guide.md` §7.1 and glossary updated.
  - Checks: controller + service + contract tests, full `mix test`, `mix format --check-formatted`, `mix compile --warnings-as-errors`.
- [ ] **T4 — Mobile store as a cache** (route: delegated)
  - Shopping API module; the store holds the last read plus `untilDate` and grouping; no derivation from the mock plan.
  - Checks: store test proving a read replaces the cache; `npm run typecheck`, `npm run lint`.
- [ ] **T5 — Shopping screen on the API list** (route: delegated)
  - Screen tested against fixtures with both groupings and a date filter.
  - Checks: `npm test`, `npm run typecheck`, `npm run lint`.

## Acceptance criteria (issue #39)

- [ ] `GET /api/shopping-list` responds `{ planned[], manual[], cart, totals }` in camelCase with each line carrying status, source, allocations and supermarket.
- [ ] `untilDate=YYYY-MM-DD` limits planned lines to Scheduled meals on or before that date; `groupBy=ingredient|meal` aggregates or splits lines (rebuilder pure tests).
- [ ] The mobile store no longer derives the list from the mock plan; a store test proves it is a cache replaced by reads.
- [ ] Shopping screen tested against fixtures with both groupings and a date filter.

## Delivery

Strategy: `ask-on-risk`. Forecast: well over 400 authored lines (API ~700, mobile ~1500 with
test rewrites). Work-unit commits stay linear on this branch so either chain strategy can be
cut from them; the chain strategy is asked when the PRs are prepared. Push and PRs are the
User's decision.

## Open questions

- Mobile (T4/T5): what backs Cart ticks, remove/restore, manual add and confirm purchase
  between S1 and S2/S3/S5. To be settled before T4.

## Progress

| Task | Route | Commit | Checks | Review |
|------|-------|--------|--------|--------|
| T1 | delegated | `7be15e5` | RED observed (missing module, uncast field) then 21 passed; full suite 1246 passed, 20 skipped; format and `compile --warnings-as-errors` clean | medium, granted, approved (`review-591e8b34c07feca3`, with T2) |
| T2 | delegated | `04431d5` | RED 8/31 then 31 passed; parent spot check 52 passed | medium, granted, approved; 3 advisory findings folded into T3 |
| T3 | delegated | — | — | — |
| T4 | delegated | — | — | — |
| T5 | delegated | — | — | — |

Reviewed boundary: `04431d5`. Engram mirror: pending (save rejected, several active sessions for this project).

Accepted review follow-ups (advisory, lineage `review-591e8b34c07feca3`), done with T3:
- `group_lines/2` with `:ingredient`: removed rows must not inflate a line that still reads `needed`.
- A test for a slot outside the schema enum sorting last.
- Document that rows without an Ingredient (manual, S2) are not a supported input yet.

Test database for this worktree: `MYFOOD_TEST_DATABASE=meal_planner_api_test_issue39`.

Next step: T3 writer run.
