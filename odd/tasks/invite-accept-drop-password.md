# Feature: invite accept without a password

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/107 (label `ready-for-agent`, review level: Jorge in addition to RDD).
Branch: `refactor/invite-accept-drop-password` (from `main` at `fa49e88`).

## Objective

Invite accept for a new User takes a name only. Nothing in the API hashes, stores or asks for a password: the `users.password_hash` column and the `bcrypt_elixir` dependency are gone.

## Problem

`POST /api/invites/:token/accept` asks a new User for `{ "name", "password" }` and stores a bcrypt hash. Since the legacy authentication sweep (#14) no route verifies a password, so the hash is never read. The contract asks for a secret it cannot use, and one column and one dependency exist only for that write.

## Decision (triage comment of 2026-10-11)

Remove it all: the `password` parameter, the `users.password_hash` column (new migration) and `bcrypt_elixir`. Sign-in is by email code only. The app is pre-launch, so no stored data is preserved and no compatibility path is kept.

## Scope

- In: `InviteController.resolve_invitee/2`, `AccountsMembership.accept_invite/2` (new User clause), the `User` schema field, a migration that removes the column, `mix.exs` and `mix.lock`, their tests, the code comments that describe the old body and the Spanish integration guide (`apps/api/docs/FRONTEND_INTEGRATION.md`).
- A body that still carries a `password` key is accepted and the key is ignored: the new User path is chosen by a non-empty `name`, as before.
- Out: the payload shape of invite accept (snake_case, a `refresh_token` that `POST /api/auth/refresh` rejects), named as a separate question in the ticket. The archived openspec documents keep their history.

## Acceptance criteria (from the ticket)

- [x] Invite accept does not require or store a password. (`invite_accept_controller_test.exs`: a new User accepts with `{ "name" }`; a stray `password` key is ignored.)
- [x] The Spanish integration guide documents the new body. (`apps/api/docs/FRONTEND_INTEGRATION.md`, "Usuario nuevo" and the `401` row.)
- [x] `users.password_hash` and `bcrypt_elixir` are removed. (Migration `20261011035817`; `mix.lock` loses `bcrypt_elixir`, `comeonin` and `elixir_make`.)

## Tasks

- [x] T1 — Invite accept takes a name only; the column, the schema field and the dependency are removed; tests and guide updated. Route: delegated writer (controller, context, schema, migration, dependency files and three test files; the reading prepares the write). Test-first: an accept with `{ "name" }` and no `password` answers 401 before the change.

## Checks

From `apps/api`, with `MIX_ENV=test MYFOOD_TEST_DB_USERNAME=<local role> MYFOOD_TEST_DB_PASSWORD="" MYFOOD_TEST_DATABASE=meal_planner_api_test_107`:

- `mix compile --warnings-as-errors --force`
- `mix format --check-formatted`
- `mix test`
- `mix credo --strict` on touched files
- The migration runs up, down and up again on the test database.
- Its version does not repeat one on `main` or on an open pull request branch.

## Delivery

One pull request to `main`, `Closes #107`. Forecast: about 150 authored changed lines, under the delivery budget. Strategy: `single-pr`.

## Progress

- 2026-10-11: T1 done by one delegated writer. RED: the accept with `{ "name" }` answered `401 unauthorized` before the change. GREEN: `invite_accept_controller_test.exs` and `accounts_membership_test.exs`, 49 passed (re-run by the parent).
- Checks observed on `meal_planner_api_test_107`: `mix compile --warnings-as-errors --force` clean; `mix format --check-formatted` clean; `mix test` 1735 passed, 21 skipped, 0 failures; `mix credo --strict` on the touched files, no issues; migration `20261011035817` ran up, down (column back as `character varying`) and up again.
- Left as they are, outside the scope: `apps/api/docs/CULINARY_AGENT_HARNESS_RESEARCH.md` and `apps/api/docs/AUTH_COMPATIBILITY_PRD.md` name `bcrypt_elixir` and `comeonin` in dated dependency lists.
- The commit, the pull request and the review outcome are recorded in the pull request and in the Engram mirror, not here.
