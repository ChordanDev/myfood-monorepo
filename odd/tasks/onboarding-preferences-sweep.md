# Onboarding & preferences sweep (issue #22, O6)

## Objective

Nothing in the onboarding and preferences flow runs on local fallbacks, and
the `user_preferences` scaffolding has no unused functions left.

## Problem and why

Issue #22 closes the onboarding and preferences spec (#2). After O1 to O5 the
flow talks to the real API, but leftovers remain: repository and schema
functions nobody calls, a production route that pretends to run onboarding
without saving, and tests that build API payloads inline instead of reading
frozen fixtures pinned by the API.

## Scope

- API: `UserPreferenceRepo`, `UserPreference` schema, and dead code whose only
  purpose is reading `user_preferences`.
- Mobile: `features/onboarding`, `features/preferences`, the settings code
  that reads preferences, and their tests.

## Constraints

- Columns are not dropped; only unreferenced functions go.
- Legacy `/api/account/dietary-profile` and `/api/account/excluded-ingredients`
  routes stay as they are (spec out of scope).
- The `slot_cooking_times_not_found` to defaults fallback in
  `useSettingsState.ts` stays: spec #2 defines it ("so the app can fall back to
  its defaults").
- The optimistic completion latch in `AuthContext.tsx` stays: it is set only
  after the completion POST succeeds.

## Decisions

- `/onboarding-preview` and `previewMode` are deleted (user decision,
  2026-10-10). To see onboarding, sign in with a user that has not completed it.

## Tasks

- [x] **T1 API dead functions** (route: delegated writer; 4+ files)
  - Delete `UserPreferenceRepo.get!/1`, `upsert/2`, `delete/1`.
  - Delete `UserPreference.changeset/2` (only caller is `upsert/2`).
  - Delete `PriceService.build_slot_list/1` (zero callers; only reader of the
    row outside the service) and its now-unused alias.
  - Delete `UserPreferencesService.diet_codes/0` unless T3 uses it.
  - Checks: `mix compile --warnings-as-errors`, `mix format --check-formatted`,
    `mix credo --strict`, `mix dialyzer`, `mix test`.
  - Test-first exception: pure deletion of unreferenced code, no RED available;
    the existing suite is the proof.
- [x] **T2 Mobile pretend paths and dead types** (route: delegated writer)
  - Delete `app/onboarding-preview.tsx`, the `previewMode` prop and branches in
    `OnboardingScreen.tsx`, and the preview tests.
  - Delete the unused legacy `UserPreferences` / `UserProfile` types in
    `src/types/domain.ts` if nothing imports them.
  - Fix the stale header in `features/preferences/constants/catalog.ts` and the
    stale `/api/me` comment in `AuthContext.tsx` if verified stale.
  - Checks: `npm run lint`, `npx tsc --noEmit`, `npx jest --ci`.
- [x] **T3 Frozen API fixtures** (route: delegated writer)
  - Add JSON fixtures with typed accessors for the preferences, onboarding
    completion, slot cooking times and `/me` payloads used by these features,
    following `features/favorites/fixtures`.
  - Pin each fixture from the matching API controller test by key set.
  - Replace inline API payloads in the onboarding, preferences and settings
    tests with the fixtures.
  - Add the new fixture directories to the CI path filter that triggers the
    API job.
  - Checks: both suites above.

## Acceptance criteria

- Mobile onboarding and preferences features have no mock data, fake services
  or "pretend complete" paths; tests use frozen API fixtures.
- Every function in the User preference repository and schema is reached by a
  route or a planner read, or is deleted.
- Legacy account routes untouched, noted on the ticket.
- Full API suite and app suite green.

## Progress and evidence

- T1: commit `d95dcef`. `mix compile --warnings-as-errors`, `mix format
  --check-formatted`, `mix credo --strict` clean; `mix test` 1700 passed, 20
  skipped. `mix dialyzer` was run on OTP 29 only and reported 9
  `call_without_opaque` warnings in untouched code, which `ci.yml` documents as
  false positives above the pinned OTP 27.3; CI is the proof for this check.
  The writer also removed the private helpers only `build_slot_list/1` used.
- T2: commit `d61847e`. `npm run lint` 0 errors, `npx tsc --noEmit` clean,
  `npx jest --ci` 142 suites, 2083 tests passed. The three preview tests were
  rewritten against the real redirect, submit and sign-out paths.
- T3: committed with this document. RED observed for all seven pins (missing
  file, then a deliberately wrong fixture each). `mix test` 1707 passed, 20
  skipped; `npx jest --ci` 144 suites, 2090 tests passed. Nine expected
  literals in the settings tests changed value because the fixture holds what
  the API really serves (hard restrictions come back in catalog order).
- Delivery: about 1,200 authored changed lines across three commits, most of
  it fixtures and test rewrites; one commit per task.

## Found, not done (outside this sweep)

- `withPreservedProfileFields` (`features/auth/utils/currentMe.ts`) still
  fills `householdSize` / `cookingSkill` from the local snapshot when `/me`
  sends null. The API stores both on completion now, so this fallback and its
  comment are stale. Removing it changes session behaviour.
- The mobile error catalog handles `onboarding_invalid`,
  `onboarding_already_complete`, `preferences_invalid` and
  `slot_cooking_times_invalid`; the API emits none of them (it answers
  `validation_error`, `invalid_diet`, `invalid_hard_restriction`,
  `invalid_hunger_level`).
- `PriceService` has no caller left in `apps/api/lib`; only its own test.
- `favorites` and `recipe` fixture directories are pinned by API tests but are
  not in the CI path filter.

## Next step

Open the pull request; decide on the follow-ups above.
