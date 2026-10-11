# Feature: switch-account without the continuation branch

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/108 (label `ready-for-agent`, review level: Jorge in addition to RDD).
Branch: `refactor/switch-account-drop-continuation`, stacked on `refactor/invite-accept-drop-password` (#107, pull request #193), because both edit `apps/api/docs/FRONTEND_INTEGRATION.md`. The pull request targets that branch. The work started from the tip of the #43 stack, which modified `docs/GLOSSARY.md`; that stack merged into `main` while this was being written, so the commit was rebased onto #107 with `main` at `7d4221b` merged in.

## Objective

`POST /api/auth/switch-account` is a bearer-only route. The account selection continuation is gone: its exchange code, its two schemas and tables, and its glossary term.

## Problem

A continuation was minted by `POST /api/auth/email-code/verify` and exchanged at switch-account. The legacy authentication sweep (#14, pull request #72) removed that route, so the only minter left is a test helper that lives in `lib`. The exchange side can only answer 401, on a branch that takes no bearer token and has no rate limit.

## Decision (triage comment of 2026-10-11)

Remove the continuation branch. Choosing a Membership at sign-in is not planned for mobile.

## Scope

- In: `Plugs.SwitchAccountAuth`, the `continuation_token` clause of `AccountLifecycleController.switch_account/2`, `EmailCodeAuth.mint_test_continuation/3`, `exchange_continuation/3`, `hash_continuation/1` and what only they reach, `AccountScopeHelpers.render_exchange_response/2`, the schemas `AccountSelectionContinuation` and `AccountSelectionContinuationMembership`, a migration that drops their tables, their tests, the router comments and the glossary term.
- A body with `continuation_token` is not special any more: without a bearer token it gets the answer of any unauthenticated request; with one, the key is ignored.
- Out: the payload shape of switch-account (snake_case, a `refresh_token` that cannot be renewed), named as a separate question in the ticket; #53 (login hardening), which shares `services/email_code_auth.ex` and is blocked on this ticket.

## Acceptance criteria (from the ticket)

- [x] `POST /api/auth/switch-account` accepts a bearer token only; a body with `continuation_token` is handled like any other unauthenticated request. (`account_lifecycle_controller_test.exs`: without a bearer token the answer is byte-equal to the one without the key; with one, the switch works.)
- [x] `mint_test_continuation/3`, `exchange_continuation/3`, `hash_continuation/1`, `render_exchange_response/2` and the two schemas are gone, with a migration that drops the tables. (Migration `20261011041326`; no hit for any of the names under `lib`, `test`, `config` or `priv` outside the two migrations.)
- [x] The glossary no longer defines the term.

## Tasks

- [x] T1 — Continuation branch removed end to end (plug, controller clause, service functions, helper, schemas, migration, tests, router comments, glossary). Route: delegated writer (seven non-trivial lib files and two large test files; the reading prepares the write). Test-first: a switch-account request with a `continuation_token` body and no bearer token answers `401 invalid_continuation` before the change, and the standard unauthenticated answer after it.

## Checks

From `apps/api`, with `MIX_ENV=test MYFOOD_TEST_DB_USERNAME=<local role> MYFOOD_TEST_DB_PASSWORD="" MYFOOD_TEST_DATABASE=meal_planner_api_test_108`:

- `mix compile --warnings-as-errors --force`
- `mix format --check-formatted`
- `mix test`
- `mix credo --strict`
- `mix sobelow --config`
- The migration runs up, down and up again on the test database.
- Its version does not repeat one on `main` or on an open pull request branch.

## Delivery

One pull request to `refactor/invite-accept-drop-password`, `Closes #108`. Forecast: about 1,200 authored changed lines, nearly all deletions (the two test files hold about 100 mentions between them). That exceeds the delivery budget of about 400 lines; the removal is one behavior and does not split into slices that work alone, so it ships as one pull request. Strategy: `exception-ok`.

## Progress

- 2026-10-11: T1 done by one delegated writer. `Plugs.SwitchAccountAuth` and its pipeline are deleted and the route is mounted in the `[:api, :auth]` scope: the plug already delegated to `AuthPipeline` for a body without the key, so the bearer path runs the same plugs as before. RED: without a bearer token the request with the key answered the flat `401 {"error":"invalid_continuation"}` instead of the `unauthenticated` envelope, and with a bearer token it answered the same 401 instead of 200. GREEN: both pass, and the bearer tests that existed pass untouched.
- Checks observed on `meal_planner_api_test_108`, before the rebase onto #107: `mix compile --warnings-as-errors --force` clean; `mix format --check-formatted` clean (the migration checked by path, since the formatter inputs do not cover `priv`); `mix test` 1720 passed, 21 skipped, 0 failures; `mix credo --strict` and `mix sobelow --config` clean; migration `20261011041326` ran up, down and up again, and after `down` the two tables matched the original ones in columns (9), indexes (4) and constraints (13).
- Both integration guides said the route returns flat errors built by "its own controller or plug"; they now name the controller only. The Spanish guide (`apps/api/docs/FRONTEND_INTEGRATION.md`) is also edited by the pull request of #107, in another section.
- After the rebase the checks ran again on a database created from scratch; the pull request carries those results.
- The commit, the pull request and the review outcome are recorded in the pull request and in the Engram mirror, not here.
