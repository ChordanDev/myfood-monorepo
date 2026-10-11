# Feature: refresh retry window

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/57 (label `ready-for-agent`, review level: Jorge in addition to RDD).
Branch: `feat/refresh-retry-window`, stacked on `refactor/switch-account-drop-continuation` (#108, pull request #197), because both edit the two integration guides. The pull request targets that branch.

## Objective

A refresh whose answer never reached the phone can be retried with the same refresh token for a short time and gets a working pair. After that time the same token is a replay, as today.

## Problem

`DeviceSessions.rotate/1` commits the rotation before the response reaches the phone. When that response is lost, the app still holds the old refresh token; its next refresh is answered `refresh_token_replayed`, which revokes the Device session on that device, the successor the app never received included. The person has to log in again with a new email code.

## Decision (triage comment of 2026-10-11)

A retry is tolerated for 10 seconds; after that, reuse revokes as today. The window is a config value. The decision changes the token replay surface and gets its own ADR. The ADR is drafted in the pull request body and filed by the maintainer as a `type:docs` issue, like #183; no ADR file is committed here.

## The rule

A refresh token that was already rotated is accepted again when all of these hold:

- the window is greater than zero and the token was replaced no longer ago than the window, measured from the moment its row was revoked by the rotation;
- the Device session that replaced it has not been used or ended since: its row is still the active one.

Then the unreceived successor is revoked, a new pair is issued from the presented row, and both the presented row and the superseded successor point at the new row. The presented row keeps the time of its first rotation, so retries do not extend its window. A successor superseded this way is itself a replaced token and follows the same rule.

In every other case a rotated token is a replay: `refresh_token_replayed`, and the session of that User on that device is revoked.

Only the SHA-256 digest of a refresh token is stored, so the pair the lost response carried cannot be handed out again. The triage comment says the retry "returns the same new pair"; this reads it together with the constraint and the acceptance criteria of the ticket body: the retry returns a new pair and revokes the one that was lost. The pull request asks the maintainer to confirm that reading.

## Scope

- In: `Services.DeviceSessions.rotate` (a clock argument, the retry rule), the config value `refresh_retry_window_seconds`, the tests of rotation (service, concurrency, HTTP), the module and controller docs and the refresh paragraph of both integration guides.
- Out: the mobile client (`apps/mobile/src/api/authRefresh.ts` keeps `retry: false` and one request in flight per token), logout, `sweep/1`, and any schema change.

## Acceptance criteria (from the ticket)

- [x] The retry interval is decided and recorded (an ADR if it is not zero). (10 seconds, `refresh_retry_window_seconds` in `config/config.exs`. The ADR is drafted in the pull request body for the maintainer to file; none is committed.)
- [x] Rotating token A into B and presenting A again inside the interval answers 200 with a new pair, B is revoked and the session on that device stays usable. (`device_sessions_test.exs` at `t0 + 9s` and at exactly `t0 + 10s`; `auth_controller_test.exs` over HTTP.)
- [x] Presenting A again after the interval answers `refresh_token_replayed` and revokes the sessions of that User on that device. (`device_sessions_test.exs` at `t0 + 11s`; `auth_controller_test.exs` with the row moved back a minute.)
- [x] The interval is covered by tests with an injected clock. (`DeviceSessions.rotate/2` takes `now`, as `sweep/1` does.)

## Tasks

- [x] T1 — Retry rule in `DeviceSessions.rotate`, the config value, tests and docs. Route: delegated writer (the service, config, three test files and two guides; the reading prepares the write). Test-first: rotating A and presenting A again nine seconds later answers `refresh_token_replayed` before the change.

## Checks

From `apps/api`, with `MIX_ENV=test MYFOOD_TEST_DB_USERNAME=<local role> MYFOOD_TEST_DB_PASSWORD="" MYFOOD_TEST_DATABASE=meal_planner_api_test_108` (no migration in this change):

- `mix compile --warnings-as-errors --force`
- `mix format --check-formatted`
- `mix test` (it includes `device_sessions_concurrency_test.exs`: the `runtime_db_concurrency` tag is not excluded)
- `mix credo --strict`
- `mix sobelow --config`

## Delivery

One pull request to `refactor/switch-account-drop-continuation`, `Closes #57`. Forecast: about 350 authored changed lines. Strategy: `single-pr`.

## Progress

- 2026-10-11: T1 done by one delegated writer. A first rotation and a retry share one path: `check_session/3` answers with the row that holds the User's place on the device (the presented row, or on a retry the row that replaced it, locked `FOR UPDATE`), and `replace/5` revokes it, issues the pair and points the replaced rows at the new one.
- RED: `rotate/2` undefined, and over HTTP the same token sent twice answered `401 refresh_token_replayed`. GREEN: the three test files, 65 passed. Mutations that the tests caught and that were reverted: dropping "the successor is still active" (3 failures), an exclusive boundary (1), a window anchored on `now` (8).
- Checks observed: `mix compile --warnings-as-errors --force` clean; `mix format --check-formatted` clean; `mix test` 1783 passed, 22 skipped, 0 failures; the Device session service and concurrency files three times in a row, 46 passed each; `mix credo --strict` and `mix sobelow --config` clean.
- `now` defaults at the call, so a request is judged by the time it arrived, before it waits for the device lock. A `now` earlier than the rotation counts as inside the window.
- Open, written in the pull request: the reading of "the same new pair", and whether a logout with a replaced token should also end the session that replaced it (today it is a no-op, as it was for any rotated token).
- The commit, the pull request and the review outcome are recorded in the pull request and in the Engram mirror, not here.
