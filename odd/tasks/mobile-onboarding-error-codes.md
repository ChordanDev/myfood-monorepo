# Mobile error codes for Onboarding and Preferences match the API (issue #170)

## Objective

The mobile error catalog holds, for the Onboarding, Preferences and Slot
cooking times routes, only codes the API emits, and the tests of those flows
run on error envelopes frozen from the API.

## Problem and why

The catalog handles four codes that no code in `apps/api/lib` emits:
`onboarding_invalid`, `onboarding_already_complete`, `preferences_invalid`,
`slot_cooking_times_invalid`. The app has messages for envelopes that never
arrive, and its tests exercise a contract the API does not have.

## What the API answers (the reference; verified 2026-10-11)

Routes: `POST /api/onboarding/complete`, `GET` and `PUT /api/me/preferences`,
`GET` and `PUT /api/me/slot-cooking-times`. The envelope is
`{"error": {"code", "message"}}`, with no `details`.

| Code | Status | Emitted by |
|---|---|---|
| `validation_error` | 422 | onboarding, preferences `PUT`, slot cooking times `PUT` |
| `invalid_cooking_skill` | 422 | onboarding |
| `invalid_diet` | 422 | onboarding, preferences `PUT` |
| `invalid_hard_restriction` | 422 | onboarding, preferences `PUT` |
| `invalid_hunger_level` | 422 | onboarding, slot cooking times `PUT` |
| `slot_cooking_times_not_found` | 404 | slot cooking times `GET` |

`validation_error` has two messages: "The request is not valid." and "The
field <name> is not valid.". From the pipeline the routes also answer
`unauthenticated`, `access_token_expired`, `account_not_found` (401) and
`unknown_error` (500). All of these are already in the mobile catalog with a
message.

## What the User sees (verified 2026-10-11)

`getAuthErrorMessage` shows the catalog message of the code and ignores the
API `message` for a known code. Onboarding shows it in an alert, Settings in
the sheet. `slot_cooking_times_not_found` is turned into defaults when
Settings loads.

## Scope

- Mobile: `AuthErrorCode`, the code list and messages in `api/errors.ts`, the
  tests that use the four codes, new error fixtures.
- API: tests only, to pin the fixtures.

## Constraints

- The API is the reference: nothing under `apps/api/lib` changes.
- `rate_limit_record_failed` also has no emitter, but it belongs to the auth
  flow and is outside this issue.
- Earlier documents in `odd/tasks/` that mention the four codes are records
  and stay as written.

## Tasks

- [x] **T1 Frozen error envelopes** (route: delegated writer; fixtures plus
  three API test files)
  - One JSON envelope per real validation code, pinned by exact equality from
    the API controller tests, following `slotCookingTimesNotFound.json`.
  - Add the missing API test for `invalid_hard_restriction` on the onboarding
    route.
- [x] **T2 Catalog and tests** (same writer)
  - Remove the four codes from the union, the code list and the messages.
  - Move `onboardingService.test.ts`, `settingsScreen.integration.test.tsx`
    and `profileLoadState.test.ts` onto real codes and the frozen envelopes.
  - A test per validation code that the User-facing message is the catalog
    message of that code, built from the frozen envelope.

## Acceptance criteria

- No error code in the mobile catalog for these flows lacks an emitter in
  `apps/api/lib`.
- Each validation failure on these routes shows a specific message, covered by
  a test that uses a frozen envelope.
- App suite and API suite green.

## Checks

- `apps/mobile`: `npx jest --ci`, `npx tsc --noEmit`, `npm run lint`.
- `apps/api`: `mix test`, `mix format --check-formatted`, `mix credo --strict`.

## Progress

T1 and T2 done (2026-10-11), as two work-unit commits.

Frozen envelopes, all 422, under `apps/mobile/src/features/`:

| Fixture | Code | Pinned from |
|---|---|---|
| `preferences/fixtures/validationErrorDinnerCookingTimeMinutes.json` | `validation_error` | slot cooking times `PUT`, onboarding |
| `onboarding/fixtures/invalidCookingSkill.json` | `invalid_cooking_skill` | onboarding |
| `preferences/fixtures/invalidDiet.json` | `invalid_diet` | preferences `PUT`, onboarding |
| `preferences/fixtures/invalidHardRestriction.json` | `invalid_hard_restriction` | preferences `PUT`, onboarding |
| `preferences/fixtures/invalidHungerLevel.json` | `invalid_hunger_level` | slot cooking times `PUT`, onboarding |

`slotCookingTimesNotFound.json` (404) was already frozen and is reused. The
message "The request is not valid." (a `validation_error` without a field) has
no fixture: one envelope is frozen per code.

- The onboarding route answers byte-identical envelopes to the two `PUT`
  routes, so one fixture is pinned from both.
- RED observed: the pins failed while the fixture files did not exist; the
  guard for the four removed codes failed before the catalog change; the
  Onboarding alert test failed against the `'boom'` mock. The catalog-level
  message tests and the `invalid_hard_restriction` onboarding test passed on
  first run: they pin existing behavior.
- The 409 `onboarding_already_complete` test case was dropped: a second
  completion succeeds on the API.
- Observed: `npx jest --ci` 147 suites and 2244 tests passed; `npx tsc
  --noEmit` clean; `npm run lint` 0 errors (4 warnings in untouched files);
  `mix test` 1782 passed, 22 skipped; `mix format --check-formatted` and `mix
  credo --strict` clean.

Left for a decision, behavior unchanged: for `validation_error` the User reads
the catalog text "Los datos ingresados no son válidos." and not which field
was refused.

Not in this change: `PUT /api/me/profile` also answers
`invalid_cooking_skill`; its fixture is pinned only from the onboarding route.

Next step: review of the pull request.
