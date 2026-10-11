# Move a Scheduled meal by id (issue #144)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/144 (`ready-for-agent`; review level: Jorge required in addition to RDD). Blocks #145 and #146, which are out of scope.
Branches: `feat/calendar-meal-move-1-api` (from main `f9c4f07`) and `feat/calendar-meal-move-2-mobile` on top of it.

## Objective
"Eat today" moves a Scheduled meal to today's slot without recreating any meal: both meals keep their ids, and their Cooking sessions, Shopping items and Slot favorites survive.

## Problem
`useEatToday` sends every cached meal of the span through `PUT /api/calendar/meals/range`. The server deletes the range and reinserts it, so every meal gets a new id, the cascade deletes its Cooking sessions, Shopping items and Slot favorites, `recipe_version_id` and `ai_generation_id` are dropped, and an edit another member made inside the span is overwritten by the cached copy.

## Scope
- API: `POST /api/calendar/meals/:id/move` with `{ date, slot }`, one transaction.
- Mobile: `useEatToday` calls it; the range client it no longer uses is removed.
- Kept: `PUT /api/calendar/meals/range` on the server, for plan regeneration.
- Out of scope: engine areas, the calendar channel (no broadcast is added; the range replace has none either), #145, #146.

## Decisions (assistant, from exploration)
- D1 Contract: the source is named by id and the destination by `(date, slot)`. The server resolves the meal sitting at the destination under a row lock and hands it the source's `(date, slot)`; an empty destination is a plain move. A two-id contract could not express the move into an empty slot, and resolving the displaced meal on the server is what removes the stale-cache overwrite.
- D2 No schema change. `scheduled_meals (account_id, date, slot)` and `slot_favorites (account_id, user_id, date, slot)` are plain unique indexes, checked per row, so two rows cannot exchange keys in one statement. The source is parked inside the transaction on a date no request can name (year 10000: every date the API parses has a four-digit year), the destination meal takes the source's key, then the source takes the destination's. Both rows are locked `FOR UPDATE` in id order.
- D3 Slot favorites are read by `(account_id, user_id, date, slot)`, so the favorites of both positions are exchanged with the meals (every user of the Account), with the same parking.
- D4 Shopping items: `planned_date` is part of the planned key and is always the meal's date. When a meal changes date, every planned item of that meal takes the new date in every status, so a bought or removed item still answers for its meal and nothing is derived twice. An `archived` item of a meal that lands on the Account's today or later is deleted, so the next list read derives it again; without that a skipped meal moved to today would have no Shopping items. A same-day slot change touches no Shopping item (the slot is read through the meal).
- D5 Guards on the server, mirroring the client rule: a cooked source or a cooked destination meal is refused. The 15:00 / 22:00 cutoffs stay in the client. No restriction on the dates.
- D6 Errors use the `ApiError` envelope, as every route added since spec #1 (the older calendar actions keep their flat bodies): 404 `scheduled_meal_not_found`, 422 `validation_error` naming `date` or `slot` (the position the meal already has counts as an invalid `slot`), 409 `scheduled_meal_cooked` for a cooked meal on either side, 409 `calendar_conflict` when a concurrent write takes the destination. The two new codes are added to the mobile allowlist in the same slice, because the mobile contract test scans the API for them.
- D7 The move lives in its own module and queries `ShoppingItem` directly, so `persistence/shopping.ex` and `services/shopping_service.ex` are not edited. Both open stacks (#43, #36) were merged into main while T1 was written; the branch was rebased onto main `7d4221b` and the endpoint is documented in `frontend_integration_guide.md` section 12.
- D8 Delivery: stacked to main, one slice per task (API, then mobile).

## Acceptance criteria (from #144)
- API: two meals with a Cooking session and a Slot favorite; after the swap the ids and the children survive.
- Mobile: `useEatToday` no longer issues the range PUT.

## Tasks
- [x] T1 API: `MealPlannerApi.Persistence.Calendar.MealMove`, controller action, route, tests. Route: delegated writer (several non-trivial files).
- [x] T2 Mobile: `moveCalendarMeal`, `planEatTodayMove`, `useEatToday`, tests; remove the unused range client. Route: delegated writer (several non-trivial files).
- [x] T3 Jorge review (required by the issue's triage comment) and its confirmed findings. Route: Jorge subagents, then one delegated writer for the API fixes and an inline mobile fix.

## Checks
- API (`apps/api`, `MIX_ENV=test`, `MYFOOD_TEST_DATABASE=meal_planner_api_test_144`): `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict`, `mix test`.
- Mobile (`apps/mobile`): `npm run lint`, `npm run typecheck`, `npx jest --ci`.

## Forecast
About 600 authored changed lines (API ~400 with tests, mobile ~200); two slices. Observed after T1: the API slice alone is about 700 lines, 470 of them tests, so the two slices go out as two stacked PRs.

## Progress / evidence
T1 (delegated writer, one work-unit commit `feat(api): move a Scheduled meal by id, keeping its children (#144)`):
- `MealMove.move/5` locks the source and the meal at the destination in id order, refuses a cooked meal on either side, exchanges the keys through the parking date, exchanges the Slot favorites of both positions and gives the planned Shopping items of each meal whose date changed the new date. An empty destination needs no parking.
- Only a unique violation, a serialization failure or a deadlock become `:conflict`; any other database error is raised.
- RED: 19 of 40 tests failed before the implementation (13 module tests, 6 controller tests; `MealMove.move/5 is undefined`).
- GREEN: the two test files pass, 40 tests; `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict` clean; `mix test` 1740 passed, 20 skipped, 0 failed. Parent spot check: the two test files, 40 passed.
- Parent follow-up in the same commit (inline, mechanical): errors moved to the envelope (D6), the two codes registered in `ApiError` and in the mobile allowlist, guide section 12. Checks after the rebase: see the PR body.
- Known limits, unchanged by this work: an `active` or `paused` Cooking session follows its meal off today and `finish` does not check the date; stored Shopping item quantities are not recomputed when the order of the meals changes; no broadcast on the calendar channel.

T2 (delegated writer, one work-unit commit `feat(mobile): move the meal by id in Eat today (#144)`, on `feat/calendar-meal-move-2-mobile`):
- `moveCalendarMeal` posts the destination to `/api/calendar/meals/:mealId/move`; `planEatTodayMove` returns the source id and the destination, with the old refusals plus "already at the destination"; `useEatToday` keeps its behaviour. `replaceCalendarRange` and its two types are removed: nothing else called them.
- Proving check: `useEatToday.test.tsx` runs the real `calendarApi` over a mocked `fetch` and asserts that the only write is one `POST .../meals/m2/move` and that no request goes to `/api/calendar/meals/range`.
- RED: `npx jest --ci src/features/home` failed 11 tests in 3 suites before the implementation (missing `planEatTodayMove` and `moveCalendarMeal`; the hook sent `PUT` where `POST` was expected).
- GREEN: `npx jest --ci src/features/home` 163 passed; `npm run lint` exit 0 (4 warnings in files not touched); `npx tsc --noEmit` clean; `npx jest --ci` 146 suites, 2217 passed. Parent spot check: `src/features/home`, 163 passed.
- After the review (T3): when the move is refused or gets no answer, the hook re-reads the calendar before resolving false, so a stale cache or a lost answer does not keep failing the same way. RED: the refusal test failed with no `GET` after the `POST`. GREEN: `npx jest --ci` 146 suites, 2218 passed; `npx tsc --noEmit` and `npm run lint` clean.
- Left as it was: the hook still resolves false for any refusal without showing the code's message (the "eat-today errors" item of #146); `MealPlanEntry.selectedQuantity` has no reader now that the range body is gone.

API checks on the rebased slice (parent): `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict`, `mix sobelow --config` clean; `mix test` 1795 passed, 22 skipped, 0 failed. `mix dialyzer` reports 9 `call_without_opaque` warnings on this machine, none in a file of this work.

T3 (Jorge review of `7d4221b..9b6c666`: advisory approval, no blocker; four confirmed findings, all fixed in the stack):
- Shopping derivation (confirmed, medium, activated by the move): a Shopping list read that loaded a meal before a move committed stored a second open item under the meal's old date; the list double-counted it and every later move of that meal answered 409. Fix, commit `fix(api): derive Shopping items only for the date their meal holds (#144)`: `ensure_shopping_items_from_schedule/2` stores a line only under `FOR KEY SHARE` on its meal and only while the meal still holds the line's date; the check without a lock runs first, so a read with nothing to store takes no lock. The batch insert and its per-row fallback run in savepoints, because a failed statement would otherwise abort that transaction (checked on a connection outside the sandbox: without the option the next statement fails with `in_failed_sql_transaction`, with it the transaction stays usable).
- Parking date (confirmed, low): a client could store a meal on `0001-01-01` and block every swap from that slot. Fix: the parking date is year 10000, which `Date.from_iso8601/1` cannot parse and PostgreSQL stores.
- Conflict without a trace (confirmed, low): the move logs the Postgres code and the constraint when it answers `:conflict`.
- Mobile hook after a refusal (confirmed, low, worsened): the hook re-reads the calendar, see T2.
- Not changed: a date PostgreSQL cannot store (`-9999-01-01`) still raises on every calendar route through the shared `parse_date/1` (pre-existing); the opposite lock order of a move and a partial purchase confirm (suspect, equivalent at base, either side retries); a Slot favorite created during a move is not exchanged (theoretical: no path creates a Slot favorite today, `PlanningService.toggle_slot_favorite/2` fails its changeset).
- RED for the fixes: 5 of 29 tests failed before them. GREEN: `mix test` 1799 passed, 22 skipped, 0 failed; compile, format, credo, sobelow clean.
