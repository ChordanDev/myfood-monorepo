# Feature: Prepared leftovers (issue #45, S7)

Branch: `claude/hagamos-la-45-7a58aa` (from `main` at `21dee84`). Parent: #5. Blockers #11, #12 closed.

## Objective
A User saves cooked portions as a Prepared leftover (portions, consume-by date), sees open ones soonest first, and eats or discards them.

## Scope
- Account-owned table `prepared_leftovers` (source meal nullable, title, portions, storedAt, consumeByDate default Account today + 3 days, notes, consumedAt, discardedAt).
- `GET`, `POST`, `consume` (decrement, close at zero), `discard` under `/api/leftovers/prepared`, camelCase; error code `prepared_leftover_not_found`.
- Not Inventory, never in Shopping computation; not read by the planner.
- Dates via `AccountClock.today/2` server-side.
- Mobile list screen with consume and discard, tested against fixtures.

## Tasks
- [x] T1 API (commit 1bbe5f7, route: delegated writer): migration, schema, persistence module, service, controller, routes, error code, tests, GLOSSARY update. Route: delegated writer (2+ non-trivial files).
- [x] T2 (commit 3b1e249) Mobile: types, api client, list screen with consume/discard, fixtures, tests, route, `KNOWN_AUTH_ERROR_CODES` entry. Route: delegated writer.

## Checks
- API: `mix test` for new + migration tests (needs MYFOOD_TEST_DB_USERNAME override and per-worktree test DB).
- Mobile: jest for the feature + authErrorCodeContract test, typecheck.

## Progress
- Explored: pattern map done (inventory schema, calendar/cooking AccountClock use, shopping mobile slice).
