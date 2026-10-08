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
- `Services.PriceService` needs no guard: the only code that reads `protein_g_per_meal` from the row is `build_slot_list/1`, which has no caller in `apps/api/lib` and always answers `{:error, :no_slots}` (its catalog query preloads an association `Recipe` does not define). A one-line guard was written, could not be tested and was dropped.
- A NUL character in a Soft preference is refused with `validation_error`: Postgres cannot store it and the write would otherwise raise.
- A save takes a row lock on the User first, so two concurrent saves of one User cannot leave the union of both Hard restriction sets. The SQL sandbox cannot run two transactions side by side, so the lock has no test.
- `user_hard_restrictions.code` has a check constraint for the seven codes. The table is created by this same branch, so no deployed database can hold an off-catalog row when the constraint is added.
- The migration that makes `diet_type` and `macro_goal` nullable is fix-forward in practice: its rollback fails once a profile holds a null, which the first mobile Diet save on a new row produces.

## Tasks

- [x] **T1** Storage and `GET /api/me/preferences`. Route: delegated direct (migrations, schemas, read function, controller, router, tests, glossary: 2+ non-trivial files).
  - Commit `bfa4485`. RED: 8/8 failing with 404 before the route existed. GREEN: 8 passed; full suite 1214 passed, 20 skipped, 0 failures on a database created from scratch (`meal_planner_api_test_issue18`), which also proves the migration order.
  - Review: assessed `medium`, due (`slice_budget_reached`), consent granted, lens `review-reliability`, approved and acknowledged (lineage `review-20772b0f592e75b4`). Reviewed boundary is now `bfa4485`.
  - Advisory findings, both taken into T2: an off-catalog Hard restriction row is dropped silently on read and nothing prevents it in the database (add a check constraint on `code`); the expired-Trial test has no negative control (assert that a capability-gated route refuses the same token).
- [x] **T2** `PUT /api/me/preferences` with its error codes, mobile allowlist and side-effect guards. Route: delegated direct (migration, replace function, `ApiError`, controller, tests, mobile allowlist).
  - Commits `db74183` (error codes, field-naming `validation_error`, mobile allowlist), `6abe118` (migration, validation, transactional replace, legacy serializer) and `57648e3` (route and its HTTP tests).
  - RED: 36 of 70 failing before the implementation (PUT answered 404, `validation_error/2` and `replace/2` undefined, no check constraint, NOT NULL on `diet_type`); legacy serializer rendered `"nil"`; mobile contract test failed on `invalid_diet` and `invalid_hard_restriction` before the allowlist; the NUL case raised `Postgrex.Error 22021`.
  - GREEN on the final tree: API `mix compile --warnings-as-errors` and `mix format --check-formatted` clean, `mix test` 1248 passed, 20 skipped, 0 failures on a database migrated from scratch; the new migration proved reversible by a single-version down and up. Mobile `npx tsc --noEmit` clean, `npm run lint` 0 errors, `npx jest --ci` 1471 passed (92 suites); the contract test and the unchanged payload builder test re-run green after the last edit. The three commits were not built one by one in isolation.
  - Not covered: the `server_fault` branch of the controller has no HTTP test (the rollback is covered at service level); the row lock (above).
  - Review: assessed `high` (`hot_path`, `apps/mobile/src/features/auth/types/auth.ts`), consent granted, four lenses, approved and acknowledged (lineage `review-b2938bcb1a3c04a2`). Reviewed boundary is now `57648e3`. No blocking finding.
  - Size: about 1,000 authored lines against a forecast of 400, of which about 630 are tests (one HTTP test per validation rule and per storage rule). Kept whole rather than trimmed.

## Acceptance criteria

- [x] `GET /api/me/preferences` returns the three keys, with `null` / `[]` / `[]` for a User with no rows (never 404). (T1)
- [x] A stored `celiac` reads back as `diet: null` (T1) and is left untouched until the User saves a Diet (T2).
- [x] `PUT /api/me/preferences` replaces the Diet, the Hard restriction set and the Soft preferences, collapsing duplicates. (T2)
- [x] Unknown Diet → `invalid_diet`; unknown restriction → `invalid_hard_restriction`; Soft preference over 80 characters or more than 20 entries → `validation_error`. (T2)
- [x] Mobile reads and saves through the real route; existing preferences payload builder test green and unchanged. (T2)

## Checks

Test-first: each behaviour change starts from a failing test observed before the implementation (ExUnit for the API, jest for the mobile allowlist contract).

- API, from `apps/api`: `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix test`.
- Local runs: when the default `postgres` role does not exist, set `MYFOOD_TEST_DB_USERNAME` and `MYFOOD_TEST_DB_PASSWORD` to a local role; a dedicated `MYFOOD_TEST_DATABASE` keeps sibling worktrees from sharing one test database.
- Mobile, from `apps/mobile` (T2): `npx tsc --noEmit`, `npm run lint`, `npx jest --ci`.

## Delivery

Strategy `ask-on-risk`; chain strategy chosen by the user on 2026-10-08: stacked pull requests to `main`. Forecast was about 700 authored changed lines; actual is about 1,500 over 22 files, two thirds of it tests.

| Order | Pull request | Branch | Base | Commits | Changed lines |
|---|---|---|---|---|---|
| 1 | #81 | `feat/user-preferences-read` | `main` | `6378907`, `bfa4485`, `a1d50e9` | 480 |
| 2 | #83 | `feat/preference-error-codes` | `feat/user-preferences-read` | `db74183` | 106 |
| 3 | #85 | `feat/user-preferences-replace` | `feat/preference-error-codes` | `6abe118` | 400 |
| 4 | #86 | `feat/user-preferences-save` | `feat/user-preferences-replace` | `57648e3` and the document commits after it | about 560 |

Each slice was built and tested on its own head (`a1d50e9`, `db74183`, `6abe118`, and the branch head). Slices 1 and 4 are over the 400-line budget and carry a `size:exception` recommendation: slice 4 is one route with 482 lines of HTTP tests, one per validation and storage rule. After a parent merges, the next pull request is retargeted to `main`.

## Progress

- 2026-10-08: branch fast-forwarded to `f4b849d`; exploration done; feature document created. Next: T1.
- 2026-10-08: T1 done and reviewed (`bfa4485`). Next: T2.
- 2026-10-08: T2 done and reviewed (`57648e3`). Next: the user decides push, pull requests and chain strategy.
- 2026-10-08: whole-branch review approved and acknowledged (lineage `review-e9d000093f9c58fa`, no blocking finding). Stacked pull requests #81, #83, #85 and #86 opened. Next: merge in order, retargeting each child to `main`.

## Known limits

- Settings loads preferences and Slot cooking times together (`useSettingsState.ts`, `Promise.all`), so the screen only works end to end once #19 ships its route.
- Sibling tickets #17 and #19 add `validation_error` and their own routes on parallel branches, touching the same lines of `api_error.ex`, `router.ex` and the mobile allowlist. Whichever merges later rebases and keeps one `validation_error` renderer.

## Follow-ups (advisory review findings, not done here)

- Hard restrictions are stored but the planner does not read them yet, while the glossary says they exclude recipe candidates outright; the wiring waits for the decision in #21.
- `UserPreferencesService.replace/2` accepts a `nil` from `AccountRepo.lock_user/1`, so a User deleted between authentication and the save ends as a 500 instead of a deliberate answer.
- The Hard restriction catalog lives in `UserHardRestriction.codes/0` and in the SQL check constraint; a new code needs a migration too.
- `UserPreferencesService.diet_codes/0` has no caller.
- The legacy dietary profile write does not take the User row lock.
- Log the failed step and reason before `server_fault` in `PreferencesController.update/2`.
- `Data.AccountRepo` and neighbours declare the user id as `pos_integer()` in older specs and `Ecto.UUID.t()` in the new ones; the ids are UUIDs.
- Test naming in `preferences_controller_test.exs`: `over_count` / `over_length` hold accepted responses, and `rejected_message/3` is an assertion named like a getter.
- `@wire_fields` in `PreferencesController` restates the camelCase spelling by hand and must cover every validated field.
- The 80-character limit counts graphemes, so the stored byte size of an entry is bounded only by the request body limit.
