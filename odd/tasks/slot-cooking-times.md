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

- [ ] T1 Storage: migration, schema, read and replace functions, with tests. Route: delegated writer (2+ non-trivial files).
- [ ] T2 API routes: error codes, controller, router, controller and casing-contract tests, plus the mobile error-code allowlist that the contract scan requires. Route: delegated writer.
- [ ] T3 Mobile: fall back to default slots on `slot_cooking_times_not_found`, with tests. Route: delegated writer.
- [ ] T4 Docs: both frontend integration guides, the README "Pending" list, the glossary code locations. Route: delegated writer.

## Acceptance criteria (from the ticket)

- [ ] New per-User table keyed by (user, slot) with minutes 0–240 and Hunger level `light | normal | strong`.
- [ ] `GET /api/me/slot-cooking-times` returns `{ breakfast, lunch, dinner }` each `{ cookingTimeMinutes, hungerLevel }`, or 404 `slot_cooking_times_not_found` when no rows exist.
- [ ] `PUT` requires all three slots and replaces them; `snack` is neither required nor accepted.
- [ ] Minutes outside 0–240 → `validation_error`; unknown Hunger level → `invalid_hunger_level`.
- [ ] Mobile reads the route, falls back to its defaults on the 404 code, and saves through it.

## Checks

- API (from `apps/api`): `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix test`.
- Mobile (from `apps/mobile`): `npm run lint`, `npx tsc --noEmit`, `npx jest --ci`.
- Test-first: RED observed before GREEN for the storage functions, the controller and the mobile fallback.

## Delivery

Strategy: `ask-on-risk`. Forecast: about 550 authored changed lines (API about 400 with tests, mobile about 100, docs about 50), above the 400-line delivery budget, so the PR slicing is decided with the user before any pull request is opened. Natural slice boundary: T1 (storage) | T2–T4 (routes, mobile, docs).

## Progress

Not started.

## Notes and follow-ups

- `GET /api/me/preferences` (#18) is not served yet and the settings screen loads it together with the slot times, so the screen only works end to end once #18 lands.
- Mobile still knows the older `slot_cooking_times_invalid` code; removing it belongs to the sweep (#22).

## Delivery record

None yet.
