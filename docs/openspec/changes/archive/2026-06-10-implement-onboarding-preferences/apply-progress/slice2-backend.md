# Apply Progress — implement-onboarding-preferences

**Work unit:** Backend API (PR 1 of chained PRs)
**Branch:** `feature/slice2-onboarding-backend` (off `develop`)
**Mode:** Strict TDD
**Status:** GREEN — all 8 backend tasks (1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5) complete; fresh-review security blocker fixed; Judgment Day Round 1 and Round 2 backend warnings fixed
**Next step:** Orchestrator reviews diff, then pushes the current backend PR branch if accepted.

## Safety net baseline

Before original backend slice: `mix test` → 47 tests, 0 failures.
Before blocker fix: targeted safety net (`accounts/user_test.exs`, `accounts/onboarding_test.exs`, `preferences_controller_test.exs`, `slot_cooking_times_controller_test.exs`, `onboarding_controller_test.exs`) → 65 tests, 0 failures.
Blocker RED: same targeted files after malicious `userId`/`user_id` tests → 73 tests, 6 failures (schema casts `user_id`, context/controller payloads could assign another User's preferences/slots).
Blocker GREEN/REFACTOR: same targeted files → 73 tests, 0 failures.
After blocker fix: `mix test` → 121 tests, 0 failures (+8 blocker regression tests; +74 total vs original baseline).
`mix precommit` (compile --warnings-as-errors, format, test) → clean; 121 tests, 0 failures.
Before Judgment Day fix: targeted safety net (`accounts/onboarding_test.exs`, `onboarding_controller_test.exs`) → 30 tests, 0 failures.
Judgment Day RED: added pre-existing preferences/slot rows before completion tests at context and controller layers → targeted run had 32 tests, 2 failures (`onboarding_invalid` from `user_preferences_user_id_index`).
Judgment Day GREEN/REFACTOR: targeted setup tests (`accounts/onboarding_test.exs`, `onboarding_controller_test.exs`, `preferences_controller_test.exs`, `slot_cooking_times_controller_test.exs`) → 50 tests, 0 failures.
After Judgment Day fix: `mix test` → 123 tests, 0 failures; `mix precommit` → clean; 123 tests, 0 failures.
Before Judgment Day Round 2 fixes: targeted safety net (`accounts/user_test.exs`, `accounts/onboarding_test.exs`, `onboarding_controller_test.exs`, `preferences_controller_test.exs`) → 69 tests, 0 failures.
Judgment Day Round 2 RED: added whitespace-only `display_name`, invalid retry after completion, protected generic `User.changeset/2`, and concurrent first-save preferences tests → targeted run had 73 tests, 4 failures.
Judgment Day Round 2 GREEN/REFACTOR: targeted run → 73 tests, 0 failures; full `mix test` → 131 tests, 0 failures; `mix precommit` → clean, 131 tests, 0 failures.

## Fresh Review Blocker Fix — 2026-06-09

- Replaced unsafe `String.to_atom/1` request-key normalization in `Accounts` with explicit whitelisted key maps for profile, preferences, and slot values. Unknown client keys, including `userId` and `user_id`, are ignored rather than atomized.
- Removed `:user_id` from client-facing `UserPreferences.changeset/2` and `UserSlotCookingTime.changeset/2` casts. The authenticated `%User{}` remains the only source of ownership in the Accounts context.
- Added regression coverage for malicious ownership keys through direct changesets, direct context functions, `PUT /api/me/preferences`, `POST /api/onboarding/complete`, and slot cooking-time payloads.

## Judgment Day Fix — 2026-06-09

- Fixed `Accounts.complete_onboarding/3` so completion locks and checks the User inside the transaction, making retries/double submits resolve deterministically as `onboarding_already_complete` / 409 after completion.
- Changed onboarding completion persistence for preferences and slot cooking times from blind inserts to database upserts on the existing unique constraints (`user_id`, and `user_id` + `meal_slot`). Users can now save preferences/slot cooking times via PUT before completing onboarding, then complete successfully with the final onboarding payload.
- Preserved authenticated ownership derivation: preference and slot rows are still created/upserted from the current User, not request payload ownership fields.

## Judgment Day Round 2 Fix — 2026-06-10

- Hardened `Accounts.update_user_preferences/2` from read-then-insert/update to a single database upsert on the `user_id` unique constraint, so concurrent first saves converge on one authenticated User-owned row instead of returning a unique-constraint-backed `preferences_invalid`.
- Added deterministic retry coverage proving `complete_onboarding/3` returns `onboarding_already_complete` / 409 after completion even when the retry payload is invalid, so the completion guard wins over validation/conflict paths.
- Trimmed `display_name` in `User.onboarding_profile_changeset/2`; whitespace-only names now fail validation and controller requests return `onboarding_invalid`.
- Removed `onboarding_completed_at` from the generic `User.changeset/2` cast path. Completion remains programmatic through `User.completion_changeset/2`.

## TDD Cycle Evidence

| Task | Test file(s) | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-------------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/my_food_back/accounts/user_test.exs` (new) | DataCase | ✅ 47/47 baseline | ✅ 18 tests written referencing `User.onboarding_profile_changeset/2`, `UserPreferences.changeset/2`, `UserSlotCookingTime.changeset/2`, plus schema persistence + unique constraints | ✅ 18/18 pass | ✅ 3+ cases per behavior (valid + each validation branch + DB-level enforcement) | ✅ Extracted `MyFoodBack.Accounts.Catalog` for diet/restriction codes; renamed changeset helpers |
| 1.2 | `test/my_food_back/accounts/onboarding_test.exs` (new) | DataCase | ✅ 47/47 baseline | ✅ 14 tests written referencing `Accounts.complete_onboarding/3`, `get_user_preferences/1`, `update_user_preferences/2`, `get_slot_cooking_times/1`, `update_slot_cooking_times/2`, atomic rollback, one-way guard, idempotency, cross-user scoping, never-clears-completion | ✅ 14/14 pass | ✅ Multi cases per scenario (atomic rollback tested for missing-slot, bad-profile, bad-diet) | ✅ Extracted `build_profile_changeset/2`, `build_preferences_changeset/2`, `build_slot_changesets/2`, `insert_slots_multi/1`, `prefs_attrs/1` helpers |
| 1.3 | `test/my_food_back_web/controllers/{onboarding,preferences,slot_cooking_times,me}_controller_test.exs` (new+modified) | ConnCase | ✅ 47/47 baseline | ✅ 24 controller tests written referencing `POST /api/onboarding/complete`, `GET/PUT /api/me/preferences`, `GET/PUT /api/me/slot-cooking-times`, plus locked-account reachability, `/api/me` shape unchanged, stable error codes (`onboarding_invalid`, `onboarding_already_complete`, `preferences_invalid`, `slot_cooking_times_invalid`) | ✅ 24/24 pass | ✅ Cases cover locked account can complete, cross-user isolation, second-submission guard, each error code | ✅ Added `MyFoodBackWeb.ErrorRendering.safe_error/1` to strip `:changeset` from JSON error envelopes |
| 2.1 | n/a (migration) | n/a | n/a | n/a | ✅ Migration `20260609221405_add_onboarding_preferences.exs` adds `users.household_size`, `users.cooking_skill`, `user_preferences` table with unique `user_id` index, `user_slot_cooking_times` table with unique `(user_id, meal_slot)` index, real `up/0` + `down/0` (verified via `ecto.rollback` then re-migrate) | ➖ n/a | ➖ Single |
| 2.2 | covered by 1.1 | Unit (DataCase) | covered by 1.1 | covered by 1.1 | ✅ `User.onboarding_profile_changeset/2`, `User.completion_changeset/2`, `UserPreferences.changeset/2` (catalog-validated), `UserSlotCookingTime.changeset/2` (slot/hunger enum, non-negative minutes) | covered by 1.1 | ➖ Catalog extracted to `MyFoodBack.Accounts.Catalog` module |
| 2.3 | covered by 1.2 | Unit (DataCase) | covered by 1.2 | covered by 1.2 | ✅ `Accounts.complete_onboarding/3` uses `Ecto.Multi` to persist profile + preferences + 3 slot rows before stamping `onboarding_completed_at`; `Accounts.get_user_preferences/1`, `Accounts.update_user_preferences/2`, `Accounts.get_slot_cooking_times/1`, `Accounts.update_slot_cooking_times/2` (upsert with `on_conflict: {:replace, ...}` on `conflict_target: [:user_id, :meal_slot]`) | covered by 1.2 | ➖ Multi logic split into named builders |
| 2.4 | covered by 1.3 | ConnCase | covered by 1.3 | covered by 1.3 | ✅ Added `/api/onboarding/complete`, `/api/me/preferences` (GET/PUT), `/api/me/slot-cooking-times` (GET/PUT) to the existing `:authenticated_api` pipeline, deliberately **outside** `RequireUnlockedAccount`. Created `OnboardingController`, `PreferencesController`, `SlotCookingTimesController` + JSON views. Existing `/api/me` shape unchanged. | covered by 1.3 | ➖ JSON views separated for clarity |
| 2.5 | full suite | n/a | n/a | n/a | ✅ `mix test` → 113/113; `mix precommit` → clean (compile --warnings-as-errors, format, test) | n/a | ➖ Already iterated through multiple refactors during GREEN |
| Fresh-review blocker | `test/my_food_back/accounts/user_test.exs`, `test/my_food_back/accounts/onboarding_test.exs`, `test/my_food_back_web/controllers/{preferences,onboarding,slot_cooking_times}_controller_test.exs` | DataCase + ConnCase | ✅ 65/65 targeted baseline | ✅ 8 malicious `userId`/`user_id` regression tests written first; 6 failures proved exploitable ownership assignment paths | ✅ 73/73 targeted pass after whitelisted normalization + no `user_id` casts | ✅ Covered direct changesets, direct context functions, `PUT /api/me/preferences`, onboarding nested preferences, and slot payloads | ✅ Replaced generic atomizing helper with small whitelist helpers; full `mix test` and `mix precommit` stayed green (121/121) |
| Judgment Day idempotent completion fix | `test/my_food_back/accounts/onboarding_test.exs`, `test/my_food_back_web/controllers/onboarding_controller_test.exs` | DataCase + ConnCase | ✅ 30/30 targeted baseline | ✅ 2 regression tests written first for PUT preferences + PUT slot cooking times before `POST /api/onboarding/complete`; RED run failed 2/32 with unique-constraint-backed `onboarding_invalid` | ✅ Targeted setup tests 50/50, full `mix test` 123/123, `mix precommit` 123/123 | ✅ Context + controller layers cover pre-existing resource rows; existing immediate retry tests cover stable 409 after success | ✅ Reworked `complete_onboarding/3` as a transactional lock/check plus upsert flow; removed obsolete blind-insert helpers |
| Judgment Day Round 2 warnings | `test/my_food_back/accounts/user_test.exs`, `test/my_food_back/accounts/onboarding_test.exs`, `test/my_food_back_web/controllers/onboarding_controller_test.exs` | DataCase + ConnCase | ✅ 69/69 targeted baseline | ✅ 6 regression tests written first; RED run failed 4/73 for whitespace-only display name, generic completion cast exposure, and concurrent preferences first-save race | ✅ Targeted tests 73/73, full `mix test` 131/131, `mix precommit` 131/131 | ✅ Context + controller coverage for whitespace-only names and invalid retry-after-completion; concurrent first-save coverage for preferences upsert | ✅ Replaced preferences read-then-write with DB upsert; trimmed display names in the profile changeset; protected generic User changeset |

## Files Changed (this work unit)

### Created

- `my_food_back/priv/repo/migrations/20260609221405_add_onboarding_preferences.exs` — migration with `up/0` + `down/0`
- `my_food_back/lib/my_food_back/accounts/catalog.ex` — server-side diet/hard-restriction catalog module
- `my_food_back/lib/my_food_back/accounts/user_preferences.ex` — schema + changeset
- `my_food_back/lib/my_food_back/accounts/user_slot_cooking_time.ex` — schema + changeset
- `my_food_back/lib/my_food_back_web/controllers/onboarding_controller.ex` — thin JSON controller
- `my_food_back/lib/my_food_back_web/controllers/onboarding_json.ex` — view
- `my_food_back/lib/my_food_back_web/controllers/preferences_controller.ex` — thin JSON controller
- `my_food_back/lib/my_food_back_web/controllers/preferences_json.ex` — view
- `my_food_back/lib/my_food_back_web/controllers/slot_cooking_times_controller.ex` — thin JSON controller
- `my_food_back/lib/my_food_back_web/controllers/slot_cooking_times_json.ex` — view
- `my_food_back/lib/my_food_back_web/controllers/error_rendering.ex` — shared helper that strips `:changeset` from error envelopes
- `my_food_back/test/my_food_back/accounts/user_test.exs` — schema + migration contract tests
- `my_food_back/test/my_food_back/accounts/onboarding_test.exs` — context tests
- `my_food_back/test/my_food_back_web/controllers/onboarding_controller_test.exs` — controller tests
- `my_food_back/test/my_food_back_web/controllers/preferences_controller_test.exs` — controller tests
- `my_food_back/test/my_food_back_web/controllers/slot_cooking_times_controller_test.exs` — controller tests

### Modified

- `my_food_back/lib/my_food_back/accounts.ex` — added `complete_onboarding/3`, `get_user_preferences/1`, `update_user_preferences/2`, `get_slot_cooking_times/1`, `update_slot_cooking_times/2`; private helpers for changeset building and Ecto.Multi wiring
- `my_food_back/lib/my_food_back/accounts.ex` — Judgment Day fix: `complete_onboarding/3` now locks/checks the User inside the transaction and upserts preferences/slot rows instead of blind inserting duplicates
- `my_food_back/lib/my_food_back/accounts.ex` — Judgment Day Round 2 fix: `update_user_preferences/2` now uses a single database upsert on `user_id` instead of read-then-insert/update
- `my_food_back/lib/my_food_back/accounts/user.ex` — added `onboarding_profile_changeset/2`, `completion_changeset/2`, `has_one :preferences`, `has_many :slot_cooking_times`
- `my_food_back/lib/my_food_back/accounts/user.ex` — Judgment Day Round 2 fix: trims profile `display_name` and removes `onboarding_completed_at` from the generic changeset cast path
- `my_food_back/lib/my_food_back/accounts/user_preferences.ex` — blocker fix removed `:user_id` from casts so client attrs cannot reassign ownership
- `my_food_back/lib/my_food_back/accounts/user_slot_cooking_time.ex` — blocker fix removed `:user_id` from casts so nested slot payloads cannot reassign ownership
- `my_food_back/lib/my_food_back_web/router.ex` — added 5 setup routes inside `:authenticated_api`, outside `RequireUnlockedAccount`
- `my_food_back/test/my_food_back_web/controllers/me_controller_test.exs` — added regression test for locked account reaching `/api/me`
- `my_food_back/test/my_food_back/accounts/user_test.exs` — blocker regression tests prove changesets ignore client `user_id`
- `my_food_back/test/my_food_back/accounts/user_test.exs` — Judgment Day Round 2 regressions for trimmed/blank `display_name` and protected generic completion casting
- `my_food_back/test/my_food_back/accounts/onboarding_test.exs` — blocker regression tests prove context functions ignore malicious `userId`/`user_id`
- `my_food_back/test/my_food_back/accounts/onboarding_test.exs` — Judgment Day Round 2 regressions for invalid retry-after-completion, whitespace-only display name, and concurrent preferences first-save safety
- `my_food_back/test/my_food_back_web/controllers/preferences_controller_test.exs` — blocker regression for `PUT /api/me/preferences`
- `my_food_back/test/my_food_back_web/controllers/onboarding_controller_test.exs` — blocker regression for nested onboarding preferences and slot data
- `my_food_back/test/my_food_back/accounts/onboarding_test.exs` — Judgment Day regression for completion after pre-existing preferences and slot rows
- `my_food_back/test/my_food_back_web/controllers/onboarding_controller_test.exs` — Judgment Day regression for PUT preferences + PUT slot cooking times before onboarding completion
- `my_food_back/test/my_food_back_web/controllers/onboarding_controller_test.exs` — Judgment Day Round 2 regressions for whitespace-only display name and invalid retry-after-completion returning 409
- `my_food_back/test/my_food_back_web/controllers/slot_cooking_times_controller_test.exs` — blocker regression for nested slot cooking-time ownership keys

## Deviations from Design

- **Catalog module seeds MVP-friendly defaults** (`omnivore`, `vegetarian`, `vegan`, `pescatarian`; `peanut`, `tree_nut`, `shellfish`, `gluten`, `dairy`, `egg`, `soy`). The design says the exact seed list is product TBD, but a hardcoded module with no entries would make the `preferences_invalid` path untestable. Using minimal MVP-friendly defaults lets the tests exercise the rejection path while keeping product ownership explicit. The module loads the configured set, so swapping to a DB-backed or env-driven list later is a one-place change.
- **Catalog validation lives in the changeset via a custom validator**, not via Ecto.Enum, because the catalog is a server-side module and codes are configurable. The Ecto.Enum approach would bake the list into the schema and require a migration to change.
- **`User.completion_changeset/2`** is a small dedicated changeset for `onboarding_completed_at` so the multi-step `complete_onboarding` flow can stamp the timestamp atomically. This avoids overloading `User.onboarding_profile_changeset/2` with a field it should never set.
- **`Accounts.complete_onboarding/3` re-fetches the user with `Repo.get!/1` at the start** to defend against the one-way guard being bypassed by stale struct snapshots in callers' variables. This is cheap (one indexed lookup) and explicit about the safety contract.
- **Slot update uses `Ecto.Multi.insert` with `on_conflict: {:replace, ...}, conflict_target: [:user_id, :meal_slot]`** rather than a custom upsert. This is the idiomatic Ecto way and respects the unique index added in the migration.
- **Ownership is context-owned, not payload-owned.** Fresh review found `String.to_atom/1` + `:user_id` casts could let payloads assign another User's preferences/slots. The fix keeps request-key normalization whitelisted and sets ownership only from the authenticated User in the Accounts context.
- **Completion now upserts editable resources.** Judgment Day confirmed the client can validly save preferences and slot cooking times before completion. `complete_onboarding/3` now upserts those rows during the same transaction instead of treating existing rows as an invalid duplicate state.
- **Completion check moved inside the transaction.** `complete_onboarding/3` locks the User row before checking `onboarding_completed_at`, so retries and double submits converge on the stable `onboarding_already_complete` contract rather than racing into resource unique constraints.
- **Preferences update now uses database upsert.** `Accounts.update_user_preferences/2` no longer reads before writing; the unique `user_id` constraint is the synchronization point for concurrent first saves.
- **Generic User changeset no longer casts completion.** The suspect Judgment Day info finding was fixed because it was low-risk: user-controlled generic attrs cannot set `onboarding_completed_at`; only the internal completion changeset stamps it.

## Issues Found / Design Gaps Reported

- The proposal flags `Open Question 1` (catalog codes) and `Open Question 2` (soft preferences shape). Catalog module ships with minimal defaults and the schema already accepts free-form strings for `soft_preferences`, so the product team can iterate without backend changes.
- The locked-account completion test relies on a small helper to forcibly expire the trial by reaching into the account via `Repo.update_all`. This is acceptable for the controller test layer; a real-world lock test could use `Application.put_env` to set a fake clock, but that exceeds the work-unit scope.

## Verification Plan for Chained PR

- [ ] `cd my_food_back && mix precommit` runs clean on a fresh checkout of this branch
- [x] Fresh-review blocker regression: malicious `userId`/`user_id` cannot write preferences or slot cooking times for another User through context functions or setup endpoints.
- [x] Judgment Day regression: `PUT /api/me/preferences` + `PUT /api/me/slot-cooking-times` before `POST /api/onboarding/complete` succeeds and preserves one preferences row plus three slot rows.
- [x] Judgment Day Round 2 regression: concurrent first preferences saves converge on one User-owned row without unique constraint errors.
- [x] Judgment Day Round 2 regression: whitespace-only `display_name` is rejected as `onboarding_invalid` and never stamps completion.
- [x] Judgment Day Round 2 regression: retries after completion return `onboarding_already_complete` / 409 even with an otherwise invalid retry payload.
- [ ] `mix ecto.rollback --to 20260609221405` and `mix ecto.migrate` both succeed (verifies `down/0` is real)
- [ ] `curl -i POST /api/onboarding/complete` returns 401 anonymous, 200 on success, 409 on second call, 422 on invalid payload
- [ ] `curl -i GET /api/me` shape is unchanged from Slice 1 (verified by `me_controller_test.exs`)
- [ ] Locked-account tests pass for all three setup endpoints (verified by `force_account_lock/1` helper in each controller test)
- [ ] `mix precommit` continues to pass on `develop` after the PR merges (no schema drift)

## Out of Scope (deferred to PR 2 / 3)

- Frontend onboarding route, Profile tab, gate-order update
- E2E/manual smoke tests
- Glossary doc update for Onboarding Profile / User Preferences semantic split
- Final product-approved catalog list
