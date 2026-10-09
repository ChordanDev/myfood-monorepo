# Feature: start planning and see the first proposal (P3)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/25 (label `ready-for-agent`, part of spec #3, blockers #23 and #24 closed).
Branch: `feat/planning-start-first-proposal` (from `main` at `0737f6a`).

## Objective

A User picks 1-10 days from today or later, optionally types a request, taps start, sees progress, and receives the first Planning proposal as day-by-day cards with the assistant's message and estimated cost; a failure shows a retry.

## Scope and constraints

- Engine off-limits: Planning candidate builder, Optimizer port and fallback, Generation run server internals, Planning session server internals. New payloads come from the channel and serializers, not from those servers.
- Touched: channel handlers and serializers, planning and calendar HTTP controllers, the Planning context payload handed to the engine, the mobile client.
- `proposal_ready` and `planning_message` stay as two events. Draft states `generating | ready | failed` are derived on the app from events. No budget override param (see P8).
- Error codes live in `ApiError`; mobile `src/api/errors.ts` stays in lockstep (contract test `authErrorCodeContract.test.ts`). No second allowlist.
- Every new outbound event goes in `@outbound_events` in `planning_channel.ex`.

## Evidence (exploration, 2026-10-08)

- `start_planning` (`planning_channel.ex:295`) reads only `range_from`/`range_to`; no day count, no free text, never starts generation (`generate_menu` does).
- `planning_message` is not emitted anywhere. `session_started` carries only `session_id`. `generation_error` payloads have three shapes.
- Codes `planning_invalid_range` and `planning_range_locked` do not exist; the API has `invalid_range` and `overlapping_range`. The overlap error carries no owner.
- Mobile socket `PhoenixChannel` has only `join`/`leave`; `fakeSocket.ts` cannot emit server events or answer pushes. `PlannerScreen.tsx` has local state only and no proposal cards.
- No fixture mechanism exists.

## Tasks

Route per task is recorded when started.

- [x] T1 Error codes: `planning_invalid_range`, `planning_range_locked` (owner display name when another Membership) in `ApiError`, mobile `errors.ts` and `auth.ts` union; start_planning maps to them.
- [x] T2 `start_planning` accepts camelCase dates, day count (1-7; ticket says 1-10, see Progress) and free text, starts generation, replies with the envelope on error.
- [x] T3 Events `session_started`, `generation_started`, `proposal_ready`, `planning_message`, `generation_error` pushed in camelCase with frozen payload shapes (channel-built, engine untouched).
- [x] T4 Fixture mechanism: channel tests write payload fixtures, committed on the app side; an app test fails on drift.
- [ ] T5 Mobile: socket `push`/`on`, fake socket extension, Planner state derived from events, day-by-day cards, progress, retry.
- [ ] T6 Planner screen integration test drives start -> cards against the fake socket.

## Acceptance criteria

Mirror issue #25: camelCase params and envelope errors; five events in camelCase with frozen shapes; `planning_invalid_range`/`planning_range_locked`; fixtures with drift test; Planner integration test; existing planning channel tests green.

## Checks

API (from `apps/api`): `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix test` (needs `MYFOOD_TEST_DB_USERNAME` and a per-worktree test database). Mobile (from `apps/mobile`): `npm run verify`.

## Progress

Exploration done.

- T1 (API half, delegated writer, worktree `myfood-monorepo-worktrees/planning-start`): `planning_invalid_range` (422) and `planning_range_locked` (409, `details.ownerName` only for another Membership) in `ApiError`, mobile `errors.ts` and `auth.ts`; `MealPlannerApi.Planning.LockOwner` reads the owner name. Observed: `mix test` for `test/meal_planner_api_web` 671 passed, `authErrorCodeContract.test.ts` 9 passed. Commit `af194d5`.
- T2 (API half): `start_planning` takes `rangeFrom`, `rangeTo` or `dayCount` (1-10), optional `request`; a range must start today or later (one day of UTC grace); starts the generation through `Server.start_generation` with the free text under the `request` constraint; a generation that cannot start cancels the session and replies the envelope. Existing channel tests moved to dates relative to today. Known conflict: `Generation.Server` window is 7 days, so 8-10 days is refused by the generation as `invalid_date_range`. Observed: `mix test test/meal_planner_api_web` 689 passed. Commit `3593e4c`.
- T3 (API half): `PlanningEvents` serializer + `handle_out` shape `proposal_ready` (day cards + `estimatedCostCents`), emit `planning_message` right after it, and give `generation_error` one shape; `generation_started` of `start_planning` carries `requestId`, `runId`, `sessionId`; `planning_message` added to `@outbound_events`; frozen shapes in `apps/api/docs/CHANNELS.md`. Observed: full `mix test` 1472 passed, 20 skipped; `mix format --check-formatted` and `mix compile --warnings-as-errors` clean. Commit: see git log (`feat(api): freeze the Planner events`).
- Range cap (user decision): ticket says 1-10 days, the user decided 1-7 until the engine (`Generation.Server`, window of 7 days) raises its cap; the channel now replies `planning_invalid_range` for more than 7 days before any session starts. Follow-up for the engine owner: a GitHub issue filed by the parent. Observed: `planning_start_test.exs` 31 passed. Commit: `fix(api): reject planning ranges over the 7-day generation window`.
- T4 (delegated writer): `MealPlannerApiWeb.PlannerFixtures.check!/3` (test support) records or asserts eight JSON fixtures in `apps/mobile/src/features/planner/fixtures/` from `planner_fixtures_test.exs` (`UPDATE_FIXTURES=1` rewrites; otherwise drift fails); UUIDs and dates normalized; mobile types and strict parsers in `features/planner/types/planningEvents.ts`, jest test `fixtures/__tests__/plannerFixtures.test.ts`; regeneration documented in CHANNELS.md. Observed: API `mix format --check-formatted` clean, `mix compile --warnings-as-errors` clean, full `mix test` 1476 passed, 20 skipped; mobile `npm run typecheck` clean, `npm run lint` 0 errors (4 pre-existing warnings), fixture jest 10 passed; tampering one fixture made the API test fail with the drift message. Known: `ApiError`/mobile `errors.ts` still say "1 to 10 days" (outside T4 surfaces); the fixture records the API text. Commit: `feat(api,mobile): generate planner payload fixtures from channel tests`.
