# Feature: read and replace User preferences (O2)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/18 (label `ready-for-agent`, part of spec #2, blockers #7 and #11 closed).
Branch: `claude/issue-18-10bbc8` (fast-forwarded to `main` at `f4b849d`).

## Objective

A User reads and saves Diet, Hard restrictions and Soft preferences as one form: `GET /api/me/preferences` prefills the screen and `PUT /api/me/preferences` replaces all three.

## Problem

The mobile app already calls `GET`/`PUT /api/me/preferences` (`apps/mobile/src/features/preferences/api/preferencesApi.ts`) with `{ diet, hardRestrictions, softPreferences }`, but the routes do not exist. The API has no Hard restriction storage and no Soft preference storage, and the dietary profile cannot hold "no Diet" (`diet_type` is NOT NULL).

## Scope and constraints

- Mobile contract wins (spec #2): route, field names and catalogs are the ones the app ships. The existing preferences payload builder test stays unchanged and green.
- Routes sit on the capability-exempt scope that serves `GET /api/me` (`[:api, :mobile_casing, :auth]`), so an Account whose Trial expired can still read and write.
- Everything is User-owned, never Account-owned.
- `macro_goal`, `protein_g_per_meal` and `default_exclusions` are neither read nor written. Excluded ingredients and the `/api/account/*` routes are not touched, beyond keeping the legacy dietary profile serializer safe for a null value.
- `celiac` and `gluten` are not translated into each other (open decision in spec #2, tracked with #21).
- Errors go through `MealPlannerApiWeb.ApiError` only. New codes join the mobile allowlist in the commit that introduces them, because the mobile contract test scans `apps/api/lib`.
- Out of scope: `POST /api/onboarding/complete` (#20), profile (#17), Slot cooking times (#19), wiring Hard restrictions into the planner, the unused mobile code `preferences_invalid` (O6 sweep #22).
- RDD is on (global). Review candidate is each work-unit commit, assessed with `--base-ref <last reviewed boundary> --committed-only`. First boundary: `f4b849d`.

## Design

### Storage

- New table `user_hard_restrictions` (`id`, `user_id` → `users` on delete cascade, `code` string, timestamps), unique on `(user_id, code)`. Codes: `peanut | tree_nut | shellfish | gluten | dairy | egg | soy`.
- `user_preferences` gains `soft_preferences {:array, :string}`, not null, default `[]`.
- `user_dietary_profiles.diet_type` and `macro_goal` become nullable. A mobile write never sets `macro_goal`; a row created by a mobile write has a null `macro_goal`. The legacy changeset keeps requiring both.
- Migration ordering: `202603312000002_create_user_preferences.exs` carries a 15-digit version and Ecto orders versions as integers, so on a fresh database it runs after every 14-digit migration. The migration that alters `user_preferences` therefore takes a 15-digit version above `202606070000000`; the other migrations use the normal 14-digit timestamp.

### Read

- `GET /api/me/preferences` → 200 `{ diet, hardRestrictions, softPreferences }`.
- No rows → `{ diet: null, hardRestrictions: [], softPreferences: [] }`, never 404.
- Stored `celiac` reads as `diet: null`. `hardRestrictions` is returned in catalog order, `softPreferences` in stored order.

### Replace

- `PUT /api/me/preferences` takes the same shape with all three keys required and returns the stored result (same serializer as the read). One transaction.
- Diet: a catalog code replaces `diet_type` (creating the row when missing). `null` clears `diet_type`, except on a row holding `celiac`, which is left untouched: the app cannot show `celiac`, sends `diet: null` back on every unrelated edit, and "leaves the stored value alone until the User saves a diet" would otherwise be broken by a Soft preference edit. `null` with no row creates no row.
- Hard restrictions: the stored set becomes exactly the request set; duplicates collapse.
- Soft preferences: entries are trimmed, blank entries are dropped and exact duplicates collapse (first occurrence wins), matching the app's own sanitizer. The limits apply to the normalized list: an entry over 80 characters or more than 20 entries is rejected.
- Validation order is `diet`, `hardRestrictions`, `softPreferences`; the first offending field decides the answer:
  - `diet` missing or neither a string nor null: 422 `validation_error`. A string outside the four mobile codes (`celiac` included): 422 `invalid_diet`.
  - `hardRestrictions` missing, not a list or holding a non-string: 422 `validation_error`. A string outside the catalog: 422 `invalid_hard_restriction`.
  - `softPreferences` missing, not a list, holding a non-string, an entry over 80 characters or more than 20 entries: 422 `validation_error`.
- A rejected request writes nothing.

### Errors

- `invalid_diet` and `invalid_hard_restriction` use the piped `conn |> ApiError.error(:code)` shape and are scan-visible.
- `validation_error` names the first offending field in its wire spelling (`softPreferences`). `ApiError` messages are static per code, so the code gets a row in `@codes` with a generic message plus a dedicated renderer that takes the field name, in the style of `server_fault/1`. This is the same design the sibling tickets #17 and #19 planned; the three branches touch the same lines and the later merges rebase onto the first.
- Mobile: the three codes join the `AuthErrorCode` union, `KNOWN_AUTH_ERROR_CODES` and `AUTH_ERROR_MESSAGES`. No behaviour change in the app.

### Side effects kept safe

- `Services.AccountService` renders a null `diet_type` / `macro_goal` as `null`, not `"nil"`.
- `Services.PriceService` keeps the 25 g protein default when the preferences row exists with a null `protein_g_per_meal` (a mobile save creates that row).

## Tasks

- [x] **T1** Storage and `GET /api/me/preferences`. Route: delegated direct (migrations, schemas, read function, controller, router, tests, glossary: 2+ non-trivial files).
  - Commit `bfa4485`. RED: 8/8 failing with 404 before the route existed. GREEN: 8 passed; full suite 1214 passed, 20 skipped, 0 failures on a database created from scratch (`meal_planner_api_test_issue18`), which also proves the migration order.
  - Review: assessed `medium`, due (`slice_budget_reached`), consent granted, lens `review-reliability`, approved and acknowledged (lineage `review-20772b0f592e75b4`). Reviewed boundary is now `bfa4485`.
  - Advisory findings, both taken into T2: an off-catalog Hard restriction row is dropped silently on read and nothing prevents it in the database (add a check constraint on `code`); the expired-Trial test has no negative control (assert that a capability-gated route refuses the same token).
- [ ] **T2** `PUT /api/me/preferences` with its error codes, mobile allowlist and side-effect guards. Route: delegated direct (migration, replace function, `ApiError`, controller, tests, mobile allowlist).

## Acceptance criteria

- [x] `GET /api/me/preferences` returns the three keys, with `null` / `[]` / `[]` for a User with no rows (never 404). (T1)
- [ ] A stored `celiac` reads back as `diet: null` (T1) and is left untouched until the User saves a Diet (T2).
- [ ] `PUT /api/me/preferences` replaces the Diet, the Hard restriction set and the Soft preferences, collapsing duplicates. (T2)
- [ ] Unknown Diet → `invalid_diet`; unknown restriction → `invalid_hard_restriction`; Soft preference over 80 characters or more than 20 entries → `validation_error`. (T2)
- [ ] Mobile reads and saves through the real route; existing preferences payload builder test green and unchanged. (T2)

## Checks

Test-first: each behaviour change starts from a failing test observed before the implementation (ExUnit for the API, jest for the mobile allowlist contract).

- API, from `apps/api`: `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix test`.
- Local runs need `MYFOOD_TEST_DB_USERNAME=luccagiordana MYFOOD_TEST_DB_PASSWORD=""`, and use `MYFOOD_TEST_DATABASE=meal_planner_api_test_issue18` because sibling worktrees share the default test database.
- Mobile, from `apps/mobile` (T2): `npx tsc --noEmit`, `npm run lint`, `npx jest --ci`.

## Delivery

Strategy `ask-on-risk`. Forecast: about 700 authored changed lines (T1 about 300, T2 about 400), above the 400-line budget, so the work is cut as two slices, one per task. Chain strategy (stacked to main or feature-branch chain): pending the user's answer; it does not change the commits.

## Progress

- 2026-10-08: branch fast-forwarded to `f4b849d`; exploration done; feature document created. Next: T1.
- 2026-10-08: T1 done and reviewed (`bfa4485`). Next: T2.

## Known limits

- Settings loads preferences and Slot cooking times together (`useSettingsState.ts`, `Promise.all`), so the screen only works end to end once #19 ships its route.
