# Feature: edit the Onboarding profile from Settings (O1)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/17 (label `ready-for-agent`, part of spec #2, blockers #7 and #11 closed).
Branch: `claude/issue-17-d258e7` (from `main` at `f4b849d`).

## Objective

A User changes display name, Household size and Cooking skill in Settings; `PUT /api/me/profile` stores them on the User and `GET /api/me` returns the stored values from then on.

## Problem

The mobile app already calls `PUT /api/me/profile` (`apps/mobile/src/features/preferences/api/preferencesApi.ts`) with `{ displayName, householdSize, cookingSkill }`, but the route does not exist. The User has no `household_size` or `cooking_skill` column, and `CurrentMe` hardcodes both as `nil`, so a saved profile reads back as "not set" on the next refresh.

## Scope and constraints

- Mobile contract wins (spec #2): route, field names and catalog are the ones the app ships. The existing mobile profile payload builder test stays unchanged and green.
- `displayName` is stored in the existing `users.name` column. Two new nullable columns: `household_size` (integer) and `cooking_skill` (string, `beginner | intermediate | advanced`).
- `onboarding_completed_at` is never read into a write here: the profile write must not touch it.
- The route sits on the capability-exempt scope that serves `GET /api/me` (`[:api, :mobile_casing, :auth]`), so an Account whose Access state is `expired` can still write.
- Errors go through `MealPlannerApiWeb.ApiError` only. New codes are added to the mobile allowlist in the same commit that introduces them, because the mobile contract test scans `apps/api/lib`.
- Out of scope: `POST /api/onboarding/complete` (#20), preferences (#18), slot cooking times (#19), the mobile codes `onboarding_invalid`, `preferences_invalid` and `slot_cooking_times_invalid` (naming drift against spec #2, belongs to the O6 sweep #22).
- RDD is on (global). Review candidate is each work-unit commit, assessed with `--base-ref <last reviewed boundary> --committed-only`. First boundary: `f4b849d`.

## Design

### Storage and serializer (T1)

- Migration adds `household_size :integer` and `cooking_skill :string`, both nullable, to `users`.
- `User.profile_changeset/2` casts `name`, `household_size`, `cooking_skill`, all three required. `name` is trimmed, 1 to 64 characters. `household_size` is 1 to 20. `cooking_skill` is one of `User.cooking_skills/0`. It never casts `onboarding_completed_at`.
- `CurrentMe` reads `user.household_size` and `user.cooking_skill` instead of `nil`.

### Route and errors (T2)

- `PUT /api/me/profile` in the scope of `GET /me`. Params arrive in snake_case (`display_name`, `household_size`, `cooking_skill`) after `Plugs.MobileCasing`.
- The authenticated resource is a decorated struct (Guardian overwrites `account_id` and adds `subscription_tier`), so the User is reloaded by id before the update.
- Response 200: `{ user: { id, email, displayName, householdSize, cookingSkill } }`, built by the same serializer `CurrentMe` uses for its `user` object.
- Validation order is `displayName`, `householdSize`, `cookingSkill`; the first offending field decides the answer:
  - `displayName` missing, not a string, blank after trim or over 64 characters: 422 `validation_error`.
  - `householdSize` missing, not a JSON integer (a numeric string and a float are rejected) or outside 1 to 20: 422 `validation_error`.
  - `cookingSkill` missing or not a string: 422 `validation_error`. A string outside the catalog: 422 `invalid_cooking_skill`.
- `validation_error` message names the first offending field in its wire spelling (spec #2). `ApiError` messages are static per code, so the code gets a row in `@codes` with a generic message plus a dedicated renderer that takes the field name, in the style of `server_fault/1`. That renderer is invisible to the mobile contract scan, so the mobile allowlist lists `validation_error` by hand, as it already does for the planning channel codes. `invalid_cooking_skill` uses the piped `conn |> ApiError.error(:invalid_cooking_skill)` shape and is scan-visible.
- Mobile caps the name at 60 and the API at 64 (ticket). The API is the looser bound on purpose; the mobile test stays at 60.

### Mobile (T2, T3)

- `validation_error` and `invalid_cooking_skill` join the `AuthErrorCode` union, `KNOWN_AUTH_ERROR_CODES` and `AUTH_ERROR_MESSAGES`.
- Comments that say the backend does not send the profile fields yet are corrected. No behaviour change in the app.

## Tasks

- [x] **T1** Store Household size and Cooking skill on the User and serve them from `CurrentMe`. Route: delegated direct (migration, schema, serializer, tests: 2+ non-trivial files). Commit `3e54966`.
- [x] **T2** `PUT /api/me/profile` with its error codes, mobile allowlist and docs. Route: delegated direct (controller, router, `ApiError`, tests, mobile allowlist, docs). Commit `dc483d9`.
- [x] **T3** Correct stale mobile comments and prove the round trip against the real route. Route: inline for the comment edit (mechanical, four files), delegated for the verification run. Commit `b849f14`. The round trip is proven through the app modules over real HTTP; a device or simulator run is still pending (see Progress).

## Acceptance criteria (from the ticket)

- [x] `PUT /api/me/profile` with the three fields returns `{ user: { id, email, displayName, householdSize, cookingSkill } }` and persists them on the User.
- [x] `GET /api/me` returns `displayName`, `householdSize` and `cookingSkill` instead of nulls after a profile write.
- [x] Blank or over-64-character name, household size outside 1 to 20: 422 `validation_error`; unknown skill: `invalid_cooking_skill`.
- [x] The route works for a User whose Account Access state is `expired`.
- [ ] The Settings screen round-trips the edit against the real route and the existing profile payload builder test stays green. Partly observed: the payload builder test is untouched and green, and the chain the screen saves through round-trips against a real server. The screen itself has not been run on a device or simulator against the real route.

## Checks

API, from `apps/api`, with `MIX_ENV=test MYFOOD_TEST_DB_USERNAME=luccagiordana MYFOOD_TEST_DB_PASSWORD="" MYFOOD_TEST_DATABASE=meal_planner_api_test_issue17` (a database of its own, other worktrees share the default one):

- `mix ecto.create --quiet && mix ecto.migrate --quiet`
- `mix compile --warnings-as-errors`
- `mix format --check-formatted`
- `mix test`
- `mix lint`

Mobile, from `apps/mobile`:

- `npm run lint`
- `npx tsc --noEmit`
- `npx jest --ci`

Test-first: each behaviour change starts from a failing test observed before the implementation (ExUnit for the API, jest for the mobile allowlist contract).

## Delivery

- Forecast: about 430 authored changed lines (T1 about 110, T2 about 300, T3 about 20), most of them tests. That is at the delivery budget, so the two API commits are kept as separable slices (T1 storage and serializer, T2 route).
- Strategy `ask-on-risk`: the chain strategy is asked once, before any pull request is prepared. Push, pull request and merge stay with the user.
- Actual size at `b849f14`, feature document excluded: 21 files, 923 insertions, 33 deletions. The forecast was low by about half, almost all of it in tests (about 640 lines) and docs (about 85). Work units, in order: `3e54966` storage and serializer (255 lines), `dc483d9` route, error codes, mobile allowlist and docs (678 lines), `b849f14` mobile comments (23 lines). The route commit is over the budget on its own; it is one behaviour with its tests and docs and was not split further.

## Progress

- 2026-10-08: branch fast-forwarded from `9b057b8` to `main` at `f4b849d`. Feature document created. No source written yet.
- 2026-10-08: T1 done in `3e54966` (5 files, 239 insertions, 16 deletions; about 170 of them tests). RED observed first: 17 failures (`User.profile_changeset/2` and `User.cooking_skills/0` undefined, `KeyError :household_size`). After: focused files 44 passed (re-run by the parent), full `mix test` 1223 passed, 20 skipped; `mix compile --warnings-as-errors` and `mix format --check-formatted` clean. `mix lint` exits 30: `credo --strict` reports 283 findings repo-wide, none in the lines this commit wrote (not confirmed on a base checkout); `mix sobelow --config` alone exits 0. Review assessment for `f4b849d..3e54966`: medium, `under_budget`, stays pending in the slice.
- T1 decisions: the serializer is `CurrentMe.user_json/1`; `cooking_skill` is a plain string with `validate_inclusion`, so an unknown skill is an `:inclusion` error and a missing one a `:required` error; the name is trimmed before validation and counted in graphemes.
- Carried to T2: `profile_changeset/2` follows Ecto casting, so it accepts `"4"` for the household size and treats an omitted name as unchanged. The route must check presence and JSON types before the changeset.
- 2026-10-08: T2 done in `dc483d9` (13 files, 671 insertions, 7 deletions; about 420 of them tests and 85 docs). RED observed first: API 27 failures of 60 (router 404, `ProfileController.update/2`, `Accounts.update_user_profile/2` and `ApiError.validation_error/2` undefined, `codes()` mismatch); mobile contract test 2 failures on `invalid_cooking_skill`, then 3 with the `validation_error` pin. After: full `mix test` 1249 passed, 20 skipped; `mix compile --warnings-as-errors` and `mix format --check-formatted` clean; `mix credo --strict` on the 8 touched files found no issues; `mix sobelow --config` exits 0. Mobile: `npm run lint` 0 errors (4 warnings in untouched files), `npx tsc --noEmit` clean, `npx jest --ci` 92 suites and 1472 tests passed. Parent re-run: profile controller and accounts tests 22 passed, mobile contract and payload builder tests 14 passed.
- T2 decisions:
  - A separate `ProfileController`, after the `DietaryProfileController` precedent; the write lives in `Persistence.Accounts.update_user_profile/2`, which reloads the User by id.
  - The controller turns a value of the wrong JSON type into `nil` and always passes the three keys, so one changeset pass reports missing, mistyped and out-of-range fields and the controller picks the first in wire order. Bounds stay in `User.profile_changeset/2` only.
  - A Cooking skill that is a string outside the catalog, the empty string included, answers `invalid_cooking_skill`; anything else answers `validation_error`.
  - A reloaded User that no longer exists answers `account_not_found`, like `GET /api/me`.
  - `id`, `email` and `onboardingCompletedAt` in the body are ignored (tested).
  - The two new rows sit before the `# Planning channel (issue #11)` comment in `@codes`: the mobile `authService.test.ts` counts every row after that comment.
- 2026-10-08: T3. Comment corrections in `b849f14` (four mobile files, comments only; `npm run lint` and `npx tsc --noEmit` clean). Round trip run against `b849f14`: the API served from `mix phx.server` (dev, port 4117) on a throwaway database, a fresh User with a minted access token, and a temporary jest file calling the app's own `buildProfilePayload`, `updateProfile` and `getMe` through its client, transport and error mapping, with only `expo-secure-store` mocked. Observed, 7 of 7 passed: a first edit (`Lucca Roundtrip`, 4, `intermediate`) came back from the `PUT` and from `GET /api/me`; a second edit (`Segunda Edición`, 1, `advanced`) did too and was the stored row; `cookingSkill: "expert"` reached the app as `invalid_cooking_skill` and `householdSize: 0` as `validation_error`, both 422, neither `unknown_error`, and neither stored anything. The Account of that User read `trial_expired` on `GET /api/me` and the edit still succeeded. Temporary file, server and database removed; tree clean afterwards.
- Limits of that proof: the token was minted with `FactoryHelpers` because the dev server keeps the email code in an in-memory mailbox with no route to read it; the wire was Node's fetch (`EXPO_PUBLIC_USE_RN_FETCH=1`), not the device's `expo/fetch`; the Settings screen was not rendered against the real route. A simulator run covers those three.

## Notes and follow-ups

- The mobile app keeps a stored snapshot to backfill null profile fields (`withPreservedProfileFields`). Once the API returns real values the backfill only matters for a User who never saved a profile.
- Mobile behaviour changes by way of the allowlist only: a 422 from this route used to collapse to `unknown_error`; Settings now shows the two new messages. The app shows its own text per code, so the field named in the API message is not shown to the User.
- `mix lint` fails on the base: `credo --strict` reports about 283 findings repo-wide and the alias stops before sobelow. Not part of this ticket.
- A `displayName` with a NUL byte passes validation and would fail at Postgres with a 500. Every string column of the API shares this; not handled here.
- The mobile codes `onboarding_invalid`, `preferences_invalid` and `slot_cooking_times_invalid` do not match the spec #2 names; left for the O6 sweep (#22).
- The jest-expo environment replaces the global `fetch` with a stubbed `expo/fetch` that does no network I/O; `EXPO_PUBLIC_USE_RN_FETCH=1` keeps Node's fetch for a real HTTP run.
