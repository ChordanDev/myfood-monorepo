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
- [ ] T2 `start_planning` accepts camelCase dates, day count (1-10) and free text, starts generation, replies with the envelope on error.
- [ ] T3 Events `session_started`, `generation_started`, `proposal_ready`, `planning_message`, `generation_error` pushed in camelCase with frozen payload shapes (channel-built, engine untouched).
- [ ] T4 Fixture mechanism: channel tests write payload fixtures, committed on the app side; an app test fails on drift.
- [ ] T5 Mobile: socket `push`/`on`, fake socket extension, Planner state derived from events, day-by-day cards, progress, retry.
- [ ] T6 Planner screen integration test drives start -> cards against the fake socket.

## Acceptance criteria

Mirror issue #25: camelCase params and envelope errors; five events in camelCase with frozen shapes; `planning_invalid_range`/`planning_range_locked`; fixtures with drift test; Planner integration test; existing planning channel tests green.

## Checks

API (from `apps/api`): `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix test` (needs `MYFOOD_TEST_DB_USERNAME` and a per-worktree test database). Mobile (from `apps/mobile`): `npm run verify`.

## Progress

Exploration done.

- T1 (API half, delegated writer, worktree `myfood-monorepo-worktrees/planning-start`): `planning_invalid_range` (422) and `planning_range_locked` (409, `details.ownerName` only for another Membership) in `ApiError`, mobile `errors.ts` and `auth.ts`; `MealPlannerApi.Planning.LockOwner` reads the owner name. Observed: `mix test` for `test/meal_planner_api_web` 671 passed, `authErrorCodeContract.test.ts` 9 passed. Commit: recorded in the T2 entry.
