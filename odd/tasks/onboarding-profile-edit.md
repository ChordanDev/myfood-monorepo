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
- `validation_error` message names the first offending field in its wire spelling (spec #2). `ApiError` messages are static per code, so the code gets a row in `@codes` with a generic message plus a dedicated renderer that takes the field name, in the style of `server_fault/1`. That renderer is invisible to the mobile contract scan. Since T4 the controller also emits the code through the piped shape for a rejection that names no field, so the scan sees it too. `invalid_cooking_skill` uses the piped `conn |> ApiError.error(:invalid_cooking_skill)` shape and is scan-visible.
- Mobile caps the name at 60 and the API at 64 (ticket). The API is the looser bound on purpose; the mobile test stays at 60.

### Mobile (T2, T3)

- `validation_error` and `invalid_cooking_skill` join the `AuthErrorCode` union, `KNOWN_AUTH_ERROR_CODES` and `AUTH_ERROR_MESSAGES`.
- Comments that say the backend does not send the profile fields yet are corrected. No behaviour change in the app.

## Tasks

- [x] **T1** Store Household size and Cooking skill on the User and serve them from `CurrentMe`. Route: delegated direct (migration, schema, serializer, tests: 2+ non-trivial files). Commit `3e54966`.
- [x] **T2** `PUT /api/me/profile` with its error codes, mobile allowlist and docs. Route: delegated direct (controller, router, `ApiError`, tests, mobile allowlist, docs). Commit `dc483d9`.
- [x] **T3** Correct stale mobile comments and prove the round trip against the real route. Route: inline for the comment edit (mechanical, four files), delegated for the verification run. Commit `b849f14`. The round trip is proven through the app modules over real HTTP; a device or simulator run is still pending (see Progress).

- [x] **T4** Reject display names the `users` table cannot store and make the rejection path of the controller total. Route: delegated direct (changeset, controller, tests, docs). Commit `4ed9e29`. Asked by the user after the advisory reviews of #78 and #79.

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
- Chain strategy chosen by the user (2026-10-08): `stacked-to-main`, two pull requests. The branch history is linear, so each slice is a prefix of it:
  - Slice 1, branch `feat/onboarding-profile-storage` at `f8e088c`, base `main`: `80dd4a7` (this document), `3e54966` (storage and serializer), `f8e088c` (T1 record). 255 authored lines without this document.
  - Slice 2, branch `claude/issue-17-d258e7`, base `feat/onboarding-profile-storage`: `dc483d9` (route, error codes, mobile allowlist, docs), `b849f14` (mobile comments) and the later records of this document. 701 authored lines without this document, 466 of them tests; `size:exception` recommended, the route is one behaviour with its tests and docs.
  - After slice 1 merges, slice 2 is retargeted to `main` so its diff shows only its own commits.
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
- 2026-10-08: native review of `f4b849d..b34e966` (high risk on the `features/auth` path signal, 22 files, 1067 lines, consent granted by the user). Four lenses ran; the outcome is approved and acknowledged (lineage `review-8a5d41881ea860de`). The reviewed boundary is now `b34e966`. Five non-blocking findings, none opened a correction:
  - Risk, warning: the 64 limit on the name counts graphemes, so a name of 64 graphemes built from combining marks or joined emoji can exceed the 255 characters of `users.name` and fail at the database with a 500.
  - Reliability, warning, and resilience, suggestion: a `displayName` with an escaped NUL character passes the changeset and fails at Postgres with a 500 instead of the 422 envelope; no test covers it.
  - Readability, suggestion: the `user_not_found` to `account_not_found` mapping in `ProfileController` has no comment at the call site.
  - Readability, suggestion: the bounds 64 and 1 to 20 are inline literals, and the reason the API allows 64 against the mobile cap of 60 lives only in this document.
- 2026-10-08: delivered as stacked pull requests #78 (`feat/onboarding-profile-storage` to `main`) and #79 (`claude/issue-17-d258e7` to `feat/onboarding-profile-storage`); CI passed on both (API, Mobile, changed paths). Advisory reviews by Jorge of #78 at `f8e088c` and #79 at `08fbf0a`: approved, no confirmed findings. Jorge did not run the tests; the CI and the local runs cover that.
- 2026-10-08: T4 in `4ed9e29` (8 files, 140 insertions, 11 deletions), accepted by the user from those reviews and from the native review findings.
  - Rule on `name` after trimming, every case an error on `name`: required, at most 64 graphemes, at most 255 codepoints (how Postgres counts `varchar(255)`), no NUL character.
  - RED observed first, 5 failures: the router answered a raised `Postgrex.Error` 22001 for 64 joined emoji and 22021 for a NUL character, and the three changeset cases were valid. After: the two files plus `api_error_test.exs` 67 passed; full `mix test` 1257 passed, 20 skipped, re-run twice by the parent (seeds 320649 and 899616). `mix compile --warnings-as-errors` and `mix format --check-formatted` clean; `mix credo --strict` on the touched files reports only the two findings already in `user_test.exs`. Mobile contract and `authService` tests 82 passed, `npm run lint` 0 errors, `npx tsc --noEmit` clean.
  - One earlier full run by the writer reported 1 failure of 1257 that was not identified (its output was cut). Six later full runs passed; treated as a flake, not confirmed.
  - `ProfileController` answers `validation_error` with the static message when the changeset is invalid on none of the three fields, instead of raising. No public path reaches that branch today (`profile_changeset/2` declares no constraint), so it is covered by reading only.
  - Not taken from the reviews: `stale_error_field` on the update (no path deletes a User; the same read-then-update exists in two other functions), the 15-digit migration versions and the migrate-before-boot order (both pre-existing), and the redundant second assertion of the `user_json/1` test.
- Limits of the round trip proof: the token was minted with `FactoryHelpers` because the dev server keeps the email code in an in-memory mailbox with no route to read it; the wire was Node's fetch (`EXPO_PUBLIC_USE_RN_FETCH=1`), not the device's `expo/fetch`; the Settings screen was not rendered against the real route. A simulator run covers those three.

## Notes and follow-ups

- The mobile app keeps a stored snapshot to backfill null profile fields (`withPreservedProfileFields`). Once the API returns real values the backfill only matters for a User who never saved a profile.
- Mobile behaviour changes by way of the allowlist only: a 422 from this route used to collapse to `unknown_error`; Settings now shows the two new messages. The app shows its own text per code, so the field named in the API message is not shown to the User.
- `mix lint` fails on the base: `credo --strict` reports about 283 findings repo-wide and the alias stops before sobelow. Not part of this ticket.
- A `displayName` with a NUL character or over the 255 codepoints of `users.name` used to pass validation and fail at Postgres with a 500; T4 rejects both. `User.changeset/2` (the sign-up path) still has no length or NUL rule on `name`; not traced here.
- The mobile codes `onboarding_invalid`, `preferences_invalid` and `slot_cooking_times_invalid` do not match the spec #2 names; left for the O6 sweep (#22).
- The jest-expo environment replaces the global `fetch` with a stubbed `expo/fetch` that does no network I/O; `EXPO_PUBLIC_USE_RN_FETCH=1` keeps Node's fetch for a real HTTP run.
