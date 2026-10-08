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
- [x] **T3 — `GET /api/shopping-list` contract** (route: delegated, writer trigger: service + controller + several test files + docs)
  - New payload, `untilDate`/`groupBy` parsing and validation, Account's today for pruning and range.
  - Tests bound to the old shape updated; `frontend_integration_guide.md` §7.1 and glossary updated.
  - Checks: controller + service + contract tests, full `mix test`, `mix format --check-formatted`, `mix compile --warnings-as-errors`.
- [x] **T4 — Mobile shopping API module** (route: delegated, additive)
  - `getShoppingList` over `apiClient` (query params, `{ data }` unwrapped), response types, fixtures
    of both groupings and a date-limited read.
  - Checks: API module tests against `fetch`; `npm run typecheck`, `npm run lint`.
- [x] **T5 — Store as a cache and read-only Shopping screen** (route: delegated, same writer run as T4)
  - The store holds the last read plus `untilDate` and grouping (D11-D15); the local derivation, the
    mock offers and the local mutations leave the screen; the recipe screen stops adding to the list.
  - Checks: store test proving a read replaces the cache; screen tested against fixtures with both
    groupings and a date filter; `npm test`, `npm run typecheck`, `npm run lint`.

T4 and T5 were re-cut from the first plan (store / screen): a store with a new shape cannot land
without the screen that reads it, while the API module can land alone.

## Acceptance criteria (issue #39)

- [x] `GET /api/shopping-list` responds `{ planned[], manual[], cart, totals }` in camelCase with each line carrying status, source, allocations and supermarket.
- [x] `untilDate=YYYY-MM-DD` limits planned lines to Scheduled meals on or before that date; `groupBy=ingredient|meal` aggregates or splits lines (rebuilder pure tests).
- [x] The mobile store no longer derives the list from the mock plan; a store test proves it is a cache replaced by reads.
- [x] Shopping screen tested against fixtures with both groupings and a date filter.

## Delivery

Strategy: `ask-on-risk`; chain strategy `stacked-to-main`, chosen by the User on 2026-10-08 (as
issue #11 was delivered). Each pull request targets the branch of the previous one.

The work was first committed linearly on `claude/issue-39-b92a2a` (`7be15e5`..`3a55ea3`, the commit
ids quoted in the Progress table and the notes below) and then re-cut on `main` at `d3a9eb5`:

| # | Branch | Commits | Slice | Changed lines |
|---|--------|---------|-------|---------------|
| 1 | `feat/account-today` | `e7a3079` | T1 | 395 |
| 2 | `feat/shopping-rebuilder-groupings` | `57afe4b` | T2 | 466 |
| 3 | `feat/shopping-list-contract` | `14bd0ed`, `99b9e0d` | T3 | 1468 |
| 4 | `feat/mobile-shopping-api` | `7653fc8` | T4 | 524 |
| 5 | `feat/mobile-shopping-cache` | `25533e0`, `024bfe1`, `4ac4514` and this document | T5 | about 7500, two thirds deleted tests |

Slices 3 and 5 exceed the 400-line budget and cannot be cut further without separating a contract
from the tests it rewrites (`size:exception`).

What the re-cut changed:
- The migration is `20261008183907_add_timezone_to_accounts.exs`. Its first two versions (`20261008130000`,
  then `20261008140000`) were each taken on `main` by another migration while this stack was open.
- `main` at `29a0f3e` was merged into the stack afterwards (one merge per branch, bottom up), which also
  brought the fix of the duplicated version `20261008130000` that kept the API job of #99 and #100 red.
- `main` already ships the `validation_error` code (Onboarding profile, #17). The stack adds no error
  code: the shopping read replies `main`'s (message "The request is not valid."), and the original
  `aa5a2df` was dropped. `main` also has `ApiError.validation_error/2`, which names the failing field;
  using it for `untilDate` / `groupBy` is a possible follow-up.
- The recipe screen change (D11) was re-applied on the recipe-detail stack: everything it added is
  kept, and `RecipeScreen.test.tsx` goes from 55 tests on `main` to 46.

Checks on the stack with `main` at `29a0f3e` merged in: API at slice 3 `mix test` 1410 passed, 20
skipped, on a freshly migrated database; no duplicated migration version; mobile at slice 5 `npm test`
97 suites, 1423 passed; typecheck clean; lint 0 errors.

## Open questions

None. Settled by the User on 2026-10-08: the mobile slice is **read-only** (D11).

## Mobile decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D11 | Read-only screen: Cart ticks, remove/restore, manual add and confirm purchase are unmounted until S2 (#40), S3 (#41) and S5 (#43); their components stay in the repository. The recipe screen's "add to the Shopping list" is disabled. | User's choice: the store is a pure cache plus filters, no throwaway local overlay. |
| D12 | The store keeps the last read in memory and persists only the preferences (`chosenUntilDate`, `groupBy`). | No offline queue in this spec; a persisted list would outlive a sign-out. |
| D13 | Grouping is an explicit preference: the switcher offers per Ingredient and per meal (`groupBy`). Cards stay grouped by Ingredient category in both. | Issue: "optionally per meal"; spec #5: grouping is a client preference. |
| D14 | The mock supermarket offers, prices and the "by supermarket" grouping leave the screen. `supermarketId` stays in the cache. | They only ever matched mock Ingredient ids; the API serves no supermarket names or prices on this read. |
| D15 | The date pill offers `plannedDates` from the read; the app never sends or compares a device-local date. A stored date the server rejects (`validation_error`) is cleared and the list is read again. | X2 (#12). |

## Progress

| Task | Route | Commit | Checks | Review |
|------|-------|--------|--------|--------|
| T1 | delegated | `7be15e5` | RED observed (missing module, uncast field) then 21 passed; full suite 1246 passed, 20 skipped; format and `compile --warnings-as-errors` clean | medium, granted, approved (`review-591e8b34c07feca3`, with T2) |
| T2 | delegated | `04431d5` | RED 8/31 then 31 passed; parent spot check 52 passed | medium, granted, approved; 3 advisory findings folded into T3 |
| T3 | delegated | `e299f62` | RED observed (service 4/12, rebuilder 31/36, `validation_error` 32/37) then green; full suite 1267 passed, 20 skipped; format and `compile --warnings-as-errors` clean; mobile contract test 8 passed, typecheck clean; parent spot check 67 passed | high, granted, 4 lenses, approved (`review-6cdbb3482ec51f43`); advisory only |
| T4 | delegated | `7b64a8e` | RED (module missing) then 22 passed; parent spot check 103 passed with the auth service suites | reviewed with T5 |
| T5 | delegated | `671f836` + fix below | RED store 35 failed / screen 33 failed, then green; owner binding RED store 11 / screen 7, then green; `npm test` 89 suites, 1351 passed, 0 failed (parent re-run); typecheck clean; lint 0 errors (4 warnings in untouched files) | native review unavailable (see below); independent read-only review: no blockers |

Reviewed boundary: `e299f62`. Engram mirror: saved through the CLI as observation #3796 (the MCP save was rejected, several active sessions for this project).

Accepted review follow-ups (advisory, lineage `review-591e8b34c07feca3`), done with T3:
- `group_lines/2` with `:ingredient`: removed rows must not inflate a line that still reads `needed`.
- A test for a slot outside the schema enum sorting last.
- Document that rows without an Ingredient (manual, S2) are not a supported input yet.

Test database for this worktree: `MYFOOD_TEST_DATABASE=meal_planner_api_test_issue39`.

T3 notes: `validation_error` was added to `ApiError` and to the mobile error allowlist (spec #5 names
the code). The envelope has no member naming the failing param. Deleted test: "includes archived
when include_archived=true" (the read no longer lists archived items).

Advisory findings of the T3 review (lineage `review-6cdbb3482ec51f43`):
- Stale comments (prune "always runs", test clock comment, SQL order vs service order): fixed, in the next commit.
- `Cart.active_for/3` uses `Repo.one`: safe, the unique index `one_active_member_cart` allows one draft Cart per member.
- Derivation is no longer capped at 7 days without `untilDate` (D2) and runs one lookup per shortage line; the
  check-then-insert has no unique index behind it (pre-existing). Not fixed here; flagged as a follow-up.
- Untested: the lease boundary of `Cart.active_for/3`, and the no-archive / no-expiry side of a rejected read.

Mobile notes (T4, T5):
- `aa5a2df` moved the `validation_error` row above the planning channel block: the mobile `authService` test
  counts the rows of that block and T3 had broken it (missed because only the contract test was run then).
- The cached list is bound to the signed-in user (`useAuth().user.id`, not persisted): a read for another
  user drops it first and the hook never renders a list cached for someone else. No store was reset on
  sign-out before this slice.
- A stored `chosenUntilDate` that is no longer among `plannedDates` is cleared and the list read once more.
- The home calendar gained an additive optional `markedDates` prop for the date pill.
- Kept only for the unmounted components (D11): the price formatters and `BestOffer`, `ManualShoppingListItem`,
  the cart button and restore labels, the pressable branches of the row and the group card. On the recipe
  screen the add button, the chat offer and the `listed` status are dormant behind optional inputs.
- Deleted with the local derivation: `shoppingListItems`, `today`, `useShoppingListItems`, `ingredientListState`,
  the offers mock, and their tests; `useShoppingList.test.tsx` (the hook is covered through the screen test).
- Not verified: the screens were not run on a device or simulator.

Follow-up outside this issue: duplicate Shopping items under concurrent reads (no unique index; task chip raised).

Review of the mobile slice (`e299f62..671f836`, 63 files, 8067 changed lines, medium): consent granted, but
`review start` refused with `lens_context_budget_exceeded` (the evidence does not fit the native budget;
no authority was created). The slice cannot be cut smaller without splitting T5 artificially, so the
native reviewed boundary stays at `e299f62`. An independent read-only reviewer read the mobile sources
instead: no blockers. Its findings:
- Fixed (RED 1 failed, then `npm test` 1352 passed): a read overtaken while it waited for the stored
  preferences still sent its request, for example after a sign-out.
- Open, low impact: `getShoppingList` validates only the top-level members, so a malformed line would
  throw while rendering instead of showing the load error.
- Open, display only: the shared home calendar still highlights the device's today in the date pill popover.
- Test gaps: guard ordering on the two auto-retry paths; hydration failure; the pill is asserted
  through a mocked `FloatingCalendar`.

Next step: review and merge of the stacked pull requests, in order.
