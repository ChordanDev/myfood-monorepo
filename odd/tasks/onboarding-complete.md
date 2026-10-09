# Feature: Complete onboarding in one transaction (O4)

Ticket: ChordanDev/myfood-monorepo#20. Parent spec: #2. Branch: `claude/issue-20` (branch point `0737f6a`).

## Objective

`POST /api/onboarding/complete` saves profile, preferences, Slot cooking times and Account timezone together or not at all, stamps `onboarding_completed_at` only if null, and returns `{ user: { id, displayName, householdSize, cookingSkill, onboardingCompletedAt }, preferences, slotCookingTimes }`.

## Constraints

- Second call replaces data, keeps the original timestamp; no `already_completed` error.
- Any invalid field in any group (including unknown IANA timezone) leaves no partial rows.
- Account timezone column and `MealPlannerApi.AccountClock` already exist on main (from #39); reuse `Account` timezone validation.
- Mobile: existing onboarding service test and screen integration test stay green, modified only to carry `timezone`.
- Authored changed lines heuristic ~400 per task (advisory).

## Tasks

- [x] T1 API: extract slot-times validation; compose profile + stamp + timezone + preferences + slot times in one transaction (service + controller + route + tests incl. rollback, idempotent timestamp, `/api/me` isComplete).
- [ ] T2 Mobile: add `timezone` (device IANA zone) to request type and payload builder; adjust tests; drop dead `onboarding_already_complete` handling only if tests stay green.

## Checks

- API: `mix test` for touched files with test DB env (see memory api-local-test-db-env).
- Mobile: `npx jest` for onboarding tests + `npm run typecheck`.

## Progress / evidence

- T1: delegated writer (2+ non-trivial files). Checks: onboarding/profile/preferences/slot/current_me tests 136 passed, full `mix test` 1455 with one flaky failure that passed on rerun, format and `--warnings-as-errors` clean.
