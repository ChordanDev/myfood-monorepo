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

- [ ] **T1 API dead functions** (route: delegated writer; 4+ files)
  - Delete `UserPreferenceRepo.get!/1`, `upsert/2`, `delete/1`.
  - Delete `UserPreference.changeset/2` (only caller is `upsert/2`).
  - Delete `PriceService.build_slot_list/1` (zero callers; only reader of the
    row outside the service) and its now-unused alias.
  - Delete `UserPreferencesService.diet_codes/0` unless T3 uses it.
  - Checks: `mix compile --warnings-as-errors`, `mix format --check-formatted`,
    `mix credo --strict`, `mix dialyzer`, `mix test`.
  - Test-first exception: pure deletion of unreferenced code, no RED available;
    the existing suite is the proof.
- [ ] **T2 Mobile pretend paths and dead types** (route: delegated writer)
  - Delete `app/onboarding-preview.tsx`, the `previewMode` prop and branches in
    `OnboardingScreen.tsx`, and the preview tests.
  - Delete the unused legacy `UserPreferences` / `UserProfile` types in
    `src/types/domain.ts` if nothing imports them.
  - Fix the stale header in `features/preferences/constants/catalog.ts` and the
    stale `/api/me` comment in `AuthContext.tsx` if verified stale.
  - Checks: `npm run lint`, `npx tsc --noEmit`, `npx jest --ci`.
- [ ] **T3 Frozen API fixtures** (route: delegated writer)
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

(none yet)

## Next step

T1.
