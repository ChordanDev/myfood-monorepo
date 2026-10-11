# Cooking API hardening (issues #125, #126, #147, #148)

Tickets: https://github.com/ChordanDev/myfood-monorepo/issues/125, /126, /147, /148 (all `ready-for-agent`).
Base: `main` at `bacab02`. Unattended session of 2026-10-11.

## Objective
Close four follow-ups of the Cooking session work (#35, #36) on the API: web tests that do not depend on the wall clock, a Cooking session status without `paused`, a finish that cannot deadlock with a checkout, and a start that leaves no active session on a cooked meal.

## Problem
- #125: the cooking and calendar controller tests schedule meals on `Date.utc_today()`, while the server judges today with `AccountClock` at the real now. A run that crosses the day boundary between the fixture and the request fails.
- #126: nothing sets a Cooking session to `paused`; the value and its branches are dead. Triage decision (issue comment, 2026-10-11): remove it. Pausing a step stays.
- #147: `persist_finish` takes the Inventory locks before the Shopping row locks, the reverse of checkout, so a finish and a checkout of the same meal's `:in_cart` item can deadlock.
- #148: `start_session` creates an active session for a meal that was cooked outside a session, which `finish` then refuses without closing it.

## Scope
- API only: `CookingService`, `CookingSession`, one migration, the cooking and calendar web tests, the cooking service tests, the glossary.
- Out of scope: the mobile cooking feature (other sessions own it), #140, #159, #190, `cart.ex` and `persistence/inventory.ex` lock order, unique indexes on active sessions, `persist_finish` rollback semantics.

## Constraints
- Pre-launch: no backfill or compatibility path.
- One PR per issue, stacked in order: #125 from `main`, then #126, #147, #148 each on the previous branch (all touch `CookingService` or its tests).
- Do not touch the auth code of PRs #193, #197, #201.

## Decisions (assistant, from exploration)
- D1 (#125) Test-only, as the issue is labelled. The controller has no clock seam, so the tests pin the Account to a fixed-offset zone where the current instant is local midday and take the meal date from `AccountClock.today/1`. The Account's day boundary is then at least 11 hours away from the run at any wall-clock instant.
- D2 (#126) New migration replaces the `cooking_sessions` status check constraint; the original migration is not edited. With two statuses left, the "unexpected status" branches in `persist_finish`, `chat_available/2` and `lock_active_session!/2` are unreachable and are removed. `active_session/1` keeps its catch-all, which answers a completed session.
- D3 (#147) Order in `persist_finish`: Cooking session, Scheduled meal, Shopping rows, then the Inventory key. This matches checkout (`Cart`: Shopping rows, then Inventory) and what #190 lists.
- D4 (#148) #148 predates decision D8 of #36 (accepted 2026-10-10): start on a cooked meal returns the finished session that cooked it, so the app can show the closed conversation. Both hold together: a cooked meal returns that finished session when there is one, and `cooking_already_finished` with no new session when there is none (meal cooked from the calendar). Start never returns or creates an active session for a cooked meal.

## Acceptance criteria
- #125: `cooking_controller_test.exs` and `calendar_controller_test.exs` take every date the server compares with today from the Account's clock, on an Account pinned away from its day boundary. (`cooking_channel_test.exs` was removed by PR #191.)
- #126: `CookingSession` status is `active | completed` in the schema, the database constraint and the glossary; no branch handles a third status.
- #147: a two-connection test where a checkout holds the `:in_cart` item and a finish of the same meal runs: both complete without `deadlock_detected`. Existing cooking atomicity tests stay green.
- #148: `start` on a meal with `is_cooked: true` and no finished session returns `cooking_already_finished` and no `CookingSession` row exists. The mobile criterion is left to the mobile sessions.

## Checks
`apps/api`, `MIX_ENV=test`: `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict`, `mix test`; the concurrency runner `mix run --no-start test/support/issue38_concurrency_runner.exs` for #147 and #148; `mix dialyzer` compared with the base (9 known local warnings).

## Forecast
About 550 authored changed lines over four PRs, each under 400.

## Tasks
- [x] T1 #125 web tests on the Account's clock. Route: delegated writer (three test files).
- [x] T2 #126 remove `paused` from the Cooking session status. Route: delegated writer (schema, migration, service, tests, glossary).
- [ ] T3 #147 Shopping rows before the Inventory key in finish. Route: delegated writer (service plus a two-connection test).
- [ ] T4 #148 start refuses a cooked meal that has no finished session. Route: delegated writer (service, service and web tests, glossary).

## Progress / evidence

### T1 (#125), 2026-10-11, committed as `aa28e00`, PR #221
- New `apps/api/test/support/account_clock_fixtures.ex`: `MealPlannerApi.AccountClockFixtures.pin_account_to_midday!/2` stores on the Account the fixed-offset zone (`Etc/GMT`, `Etc/GMT-N`, `Etc/GMT+N`) that is `12 - UTC hour` hours ahead of UTC, through `Account.timezone_changeset/2`, and returns `AccountClock.today/2` at the instant. The instant is then in the Account's 12:00 hour, the returned date equals the UTC date, and it stays the Account's today for eleven hours on each side. `Tz.TimeZoneDatabase` and the changeset validation accept all 24 zone names (`Etc/GMT-12` to `Etc/GMT+11`).
- New `apps/api/test/meal_planner_api/account_clock_fixtures_test.exs`: 6 tests over the first and the last second of every UTC hour of a fixed day (returned date, stored zone gives hour 12, same today at 11 hours before and after, struct or id, instant given in another zone, default instant).
- `cooking_controller_test.exs`: every meal date and every "not today" date comes from the pinned Account's today (the tenancy test pins `membership_a`'s Account; the two `describe` setups pin and pass `today` in the context). No `Date.utc_today()` and no direct `AccountClock.today/1` left.
- `calendar_controller_test.exs`: all seven `Date.utc_today()` sites converted (tenancy setup pins Account A, the three `canCreate` tests, the `GET` capability test, `isSkipped`, the move setup). No `Date.utc_today()` left. Only `isSkipped` and the move `describe` have outcomes that depend on the server's today; the other five sites send explicit dates and were converted for uniformity. The `now = DateTime.utc_now()` uses that build trial windows are unchanged.
- Route: delegated writer. Nothing under `apps/api/lib` changed.
- RED: `mix test test/meal_planner_api/account_clock_fixtures_test.exs` before the helper existed: `error: module MealPlannerApi.AccountClockFixtures is not loaded and could not be found`. GREEN after it: 6 passed.
- Checks (`apps/api`, `MIX_ENV=test`):
  - `mix test` on the three files: 55 passed (49 before, plus the 6 new).
  - `mix compile --warnings-as-errors`: exit 0, no warnings.
  - `mix format --check-formatted`: exit 0.
  - `mix credo --strict`: 344 files, no issues.
  - `mix test`: 1825 passed, 22 skipped, exit 0.
- Not checked: a run at a real day boundary. The tests cannot move the server's clock, so the guarantee rests on the helper's unit test.

### T2 (#126), 2026-10-11, uncommitted (the parent commits)
- `CookingSession`: `status` is `Ecto.Enum` over `[:active, :completed]`. The file had no doc or typespec listing the statuses.
- New migration `20261011150531_drop_paused_from_cooking_session_status.exs`: explicit `up` and `down` that drop and recreate `cooking_sessions_status_check` (`status IN ('active', 'completed')`; `down` restores the three values). No row is rewritten; a `paused` row would make `up` fail. The original migration is unchanged.
- `CookingService`: `persist_finish/3` rolls back with `:cooking_already_finished` on a completed session and otherwise proceeds; the catch-all clause of `chat_available/2` and the `_` branch of `lock_active_session!/2` are gone. `active_session/1`, `@type step_status`, the `track_step` guard, `cooking_step_event.ex` and the controller's step mapping are unchanged. `:cooking_session_not_active` is still answered by `active_session/1` (a step on a completed session).
- `docs/GLOSSARY.md`, Cooking session: "`active` or `completed`".
- New `apps/api/test/meal_planner_api/persistence/planning/cooking_session_test.exs`, 6 tests: the enum values, the default, `completed` accepted and `paused` (atom and string) refused by the changeset; the table accepts `active` and `completed` and refuses `paused` with a check violation on `cooking_sessions_status_check` (raw `UPDATE` inside a savepoint).
- `migration_shape_test.exs` and `migration_sanity_test.exs` hold no rule for new migrations; neither was edited.
- Route: delegated writer.
- RED, before the schema, migration and service changed (3 of 6 failed): `Ecto.Enum.values(CookingSession, :status)` was `[:active, :paused, :completed]`; `refute changeset.valid?` got `true` for `paused`; `Expected exception Postgrex.Error but nothing was raised` on the raw `UPDATE`. GREEN after: 6 passed.
- Checks (`apps/api`, `MIX_ENV=test`, lane database):
  - `mix ecto.migrate --quiet`: exit 0; constraint `CHECK (status = ANY (ARRAY['active', 'completed']))`.
  - `Ecto.Migrator.down(Repo, 20261011150531, DropPausedFromCookingSessionStatus)`: `:ok`; `schema_migrations` went from 48 to 47 rows (only this version); constraint back to `ARRAY['active', 'paused', 'completed']`. `mix ecto.migrate --quiet` again: exit 0, 48 rows, constraint `ARRAY['active', 'completed']`.
  - `mix test test/meal_planner_api/services test/meal_planner_api/persistence/planning test/meal_planner_api_web/controllers/cooking_controller_test.exs test/support`: 407 passed, 9 skipped.
  - `mix compile --warnings-as-errors` (also with `--force`): exit 0, no warnings.
  - `mix format --check-formatted`: exit 0.
  - `mix credo --strict`: 345 files, no issues.
  - `mix test`: 1831 passed, 22 skipped, exit 0 (1825 before, plus the 6 new).
  - `mix dialyzer --format short`: exit 2 with the 9 known `call_without_opaque` warnings and nothing else; none in `cooking_service.ex`.
- Left alone, outside the edit surface: `apps/mobile/src/features/cooking/types/cookingApi.ts:21` still types the session status as `'active' | 'paused' | 'completed'`; `odd/tasks/calendar-meal-move.md:51` mentions an "`active` or `paused` Cooking session" in a record of earlier work.

## Next step
T3.
