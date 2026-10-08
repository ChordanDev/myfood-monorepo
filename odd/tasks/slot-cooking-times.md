# Feature: Read and replace Slot cooking times (O3)

Ticket: ChordanDev/myfood-monorepo#19. Parent spec: #2 (Onboarding and preferences).
Branch: `claude/issue-19-2861a0` (branch point `f4b849d`).

## Objective

A User sets, per breakfast, lunch and dinner, the minutes they will cook and their Hunger level, and the app prefills them next time.

## Problem

The mobile app already calls `GET`/`PUT /api/me/slot-cooking-times` with camelCase payloads. The API serves neither route and has no storage for Slot cooking times or Hunger levels, so the settings screen can never load or save them.

## Scope and constraints

- In scope: storage, the two routes, their error codes, the mobile 404 fallback, docs.
- Out of scope: `POST /api/onboarding/complete` (#20), `GET`/`PUT /api/me/preferences` (#18), `PUT /api/me/profile` (#17), planner consumption (P7, #29). The data is stored but inert for the planner in this slice.
- The mobile contract wins: routes, field names and catalogs are the ones the app ships.
- Routes sit on the scope that serves `GET /api/me`: `[:api, :mobile_casing, :auth]` (authenticated, capability-exempt, camelCase).
- Everything is User-owned, never Account-owned.

## Design

### Storage

Table `user_slot_cooking_times`: `id` binary_id, `user_id` (references users, delete_all, not null), `slot` string with check `IN ('breakfast','lunch','dinner')`, `cooking_time_minutes` integer with check `BETWEEN 0 AND 240`, `hunger_level` string with check `IN ('light','normal','strong')`, `utc_datetime_usec` timestamps, unique index on `(user_id, slot)`.

Schema `MealPlannerApi.Persistence.Accounts.UserSlotCookingTime` with `Ecto.Enum` for `slot` and `hunger_level`. Read and replace functions follow the existing persistence → data → service layering used by the dietary profile. Replace writes the three rows in one transaction and must be callable from inside an outer transaction (#20 will reuse it).

### Routes

- `GET /api/me/slot-cooking-times` → 200 `{ breakfast, lunch, dinner }`, each `{ cookingTimeMinutes, hungerLevel }`. A User without the full set of three rows gets 404 `slot_cooking_times_not_found`.
- `PUT /api/me/slot-cooking-times` → requires exactly the three slots, replaces them, returns 200 with the stored set in the same shape.

### Validation and error codes

New `ApiError` codes: `slot_cooking_times_not_found` (404), `validation_error` (422), `invalid_hunger_level` (422).

- Missing slot, slot that is not an object, any key other than the three slots (including `snack`), `cookingTimeMinutes` missing, not an integer or outside 0 to 240, `hungerLevel` missing or not a string → `validation_error` with a message naming the first offending field in camelCase (for example `breakfast.cookingTimeMinutes`).
- `hungerLevel` string outside the catalog → `invalid_hunger_level`.
- The field-naming message needs a message override on the envelope renderer; the mobile contract scan must keep seeing the code.

### Mobile

- `slot_cooking_times_not_found`, `validation_error` and `invalid_hunger_level` join the `AuthErrorCode` union, the allowlist and the messages table.
- The settings load falls back to the default slots only on the `slot_cooking_times_not_found` code; every other failure keeps the existing error state. The transport layer stays unchanged.

## Tasks

- [x] T1 Storage: migration, schema, read and replace functions, with tests. Route: delegated writer (2+ non-trivial files). Commit `8c02376`.
- [x] T2 API routes: error codes, controller, router, controller and casing-contract tests, plus the mobile error-code allowlist that the contract scan requires. Route: delegated writer. Commit `cd58f3a`.
- [x] T2b Review follow-ups: a body that is not a JSON object answers `validation_error` with its own message; the 0 to 240 range has one source in `UserSlotCookingTime`. Route: delegated writer. Commit `8115edc`.
- [x] T3 Mobile: fall back to default slots on `slot_cooking_times_not_found`, with tests. Route: delegated writer. Commit `ccd3aa3`.
- [x] T4 Docs: both frontend integration guides, the README "Pending" list, the glossary code locations. Route: delegated writer. Commit `c2bb019`.

## Acceptance criteria (from the ticket)

- [x] New per-User table keyed by (user, slot) with minutes 0–240 and Hunger level `light | normal | strong`.
- [x] `GET /api/me/slot-cooking-times` returns `{ breakfast, lunch, dinner }` each `{ cookingTimeMinutes, hungerLevel }`, or 404 `slot_cooking_times_not_found` when no rows exist.
- [x] `PUT` requires all three slots and replaces them; `snack` is neither required nor accepted.
- [x] Minutes outside 0–240 → `validation_error`; unknown Hunger level → `invalid_hunger_level`.
- [x] Mobile reads the route, falls back to its defaults on the 404 code, and saves through it.

## Checks

- API (from `apps/api`): `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix test`. Locally the test commands need `MYFOOD_TEST_DB_USERNAME=<local role>` and an empty `MYFOOD_TEST_DB_PASSWORD`; this feature ran them against `MYFOOD_TEST_DATABASE=meal_planner_api_test_issue19` to stay clear of other worktrees.
- Mobile (from `apps/mobile`): `npm run lint`, `npx tsc --noEmit`, `npx jest --ci`.
- Test-first: RED observed before GREEN for the storage functions, the controller and the mobile fallback.

## Delivery

Strategy: `ask-on-risk`. Forecast: about 550 authored changed lines. Actual: about 1,270 changed lines across five commits (tests are roughly two thirds), above the 400-line delivery budget, so the PR slicing is decided with the user before any pull request is opened. Natural slice boundaries: `8c02376` (storage) | `cd58f3a` + `8115edc` (routes and error codes) | `ccd3aa3` + `c2bb019` (mobile fallback and docs).

## Progress

All tasks done and committed.

Observed checks:

- API at `8115edc`: `mix compile --warnings-as-errors` exit 0, `mix format --check-formatted` exit 0, `mix test` 1250 passed, 20 skipped, 0 failures (baseline at `f4b849d`: 1206 passed, 20 skipped).
- Mobile at `ccd3aa3`: `npm run lint` exit 0 (4 warnings that predate this work), `npx tsc --noEmit` exit 0, `npx jest --ci` 93 suites, 1480 passed.
- Parent spot checks: the two new API test files (37 passed at `cd58f3a`); the settings integration, default-set and error-code contract suites (56 passed at `c2bb019`).
- Not run locally: credo, sobelow and dialyzer (CI does not run them either). Local toolchain is Elixir 1.20.3; CI pins 1.17.3.

Review (receipt-driven development on):

- `f4b849d..cd58f3a` (T1, T2): assessed high (`hot_path`, `apps/mobile/src/features/auth/types/auth.ts`); consent granted; four-lens review approved and acknowledged, lineage `review-9243dd03c7a152ff`. Six non-blocking findings.
- `cd58f3a..c2bb019` (T2b, T3, T4): assessed medium, `under_budget` (232 changed lines); no review due on its own.
- `f4b849d..dce2046` (whole branch): assessed high; consent granted; four-lens review approved and acknowledged, lineage `review-20f7295fccd610be`. Six non-blocking suggestions, listed under follow-ups.

## Notes and follow-ups

- `GET /api/me/preferences` (#18) is not served yet and the settings screen loads it together with the slot times, so the screen only works end to end once #18 lands.
- Mobile still knows the older `slot_cooking_times_invalid` code; removing it belongs to the sweep (#22).
- A `PUT` with malformed JSON never reaches the controller: `Plug.Parsers` raises and Phoenix answers 400 outside the envelope. Not specific to these routes; left as is.
- Review findings accepted in T2b: the untested non-object body and the duplicated 0 to 240 range. Left as is: the three new codes sit above the planning channel comment in `api_error.ex` because a mobile test counts the rows below it.
- Open follow-ups from the second review, not done here:
  - The `PUT` changeset branch answers 500 through `server_fault`, drops the changeset without logging it and has no test. It is reachable: a User deleted between authentication and the write fails the `user_id` foreign key.
  - No test asserts that a refused replace rolls back an outer transaction that is already open; #20 depends on that case.
  - `replace_user_slot_cooking_times/2` only works with atom-keyed slot maps and its `@doc` does not say so.
  - `validation_error` and `ApiError.error/3` are general purpose but sit under a Slot cooking times heading in `api_error.ex` and its test.
- `apps/api/docs/FRONTEND_INTEGRATION.md` still carries a legacy endpoints table and slots section that list `snack` and omit `/api/me`; not touched here.

## Delivery record

Chain strategy chosen by the user: stacked pull requests, each one based on its parent branch, as in #11. No tracker pull request.

| Slice | Branch | Base | Commits | Changed lines |
|-------|--------|------|---------|---------------|
| 1 Storage | `feat/slot-cooking-times-storage` | `main` | `8c02376` | 542 |
| 2 Routes and error codes | `feat/slot-cooking-times-routes` | slice 1 | `cd58f3a`, `8115edc` | 528 |
| 3 Mobile fallback and docs | `feat/slot-cooking-times-mobile` | slice 2 | `ccd3aa3`, `c2bb019` and the task record commits | about 250 |

Slices 1 and 2 are over the 400-line budget; about two thirds of each is tests, so `size:exception` is recommended instead of a further split.
