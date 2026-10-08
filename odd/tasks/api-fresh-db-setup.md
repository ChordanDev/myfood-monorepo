# Feature: api boots and signs people up on a fresh database

Branch: `fix/api-fresh-db-setup` (from `main` at `507e107`). No spec issue; reported by the maintainer on 2026-10-08.

## Objective

A developer (or a new environment) that runs `mix ecto.create && mix ecto.migrate && mix phx.server` in `apps/api` gets a running API where email-code sign-up works, without knowing about `OPTIMIZER_PYTHON` or `priv/repo/seeds.exs`.

## Problem

Both were confirmed on 2026-10-08 before any change.

1. **Boot.** `config/config.exs:36` and `config/dev.exs:36` default `optimizer_python` to the bare name `"python3"`. `OptimizerPortRunner.open_port/1` hands it to `Port.open({:spawn_executable, ...})`, which does not search `PATH`: `Port.open({:spawn_executable, "python3"}, [:binary])` raises `%ErlangError{original: :enoent}` on a machine where `System.find_executable("python3")` answers `/opt/homebrew/bin/python3`. The raise happens inside `OptimizerServer.init/1`, so the supervisor cannot start the child and the application does not boot. `config/prod.exs` and `config/runtime.exs` never set `optimizer_python`, so production runs on the same bare default.
2. **Sign-up.** A database built only by migrations holds two `subscription_plans` rows, `family_6` and `trial` (inserted by `20260625000002_alter_accounts_to_plan_enum.exs`, whose moduledoc wrongly says `individual` and `family_4` come from `20260326120000_create_subscription_plans.exs`; that migration only creates the table). `Subscriptions.ensure_default_plan_id(:individual)` answers `{:error, :plan_not_found}`, `Accounts.register_with_verified_email/2` folds it into `:unable_to_issue_identity` without logging, `EmailCodeSignup` rolls back with `:registration_failed` and `MobileAuthController` answers 500 `unknown_error`. Nothing in the logs names the missing row.

How the rows reach an environment today: only through `priv/repo/seeds.exs` (and `SubscriptionPlanFixtures.ensure_plans!/0` in tests). The repository has no release module, Dockerfile, Procfile or deploy workflow, and no document mentions the seeds, so production depends on someone running `seeds.exs` by hand. That script also creates a demo Account (`Familia Demo`), two `@myfood.local` Users, a recipe and a scheduled meal, so it is not something to run against production. The state of the real production database was not inspected (no access).

## Decisions (taken 2026-10-08)

- **Missing Python stops the boot with an explicit error** instead of starting with the circuit open. `OptimizerServer` already stops with `{:shutdown, reason}` when the runner cannot spawn and when the handshake never completes, so a deploy without a working optimizer is caught at boot rather than silently serving `OptimizerFallback` menus. Cost: a machine without Python 3 on `PATH` cannot start the API even for work unrelated to planning. Starting degraded would change the supervision contract and is left as a follow-up if that cost bites.
- **A bare executable name is resolved in the runner**, not in config, so every environment (including production, which has no override) gets it. A name with a directory component is expanded against the working directory, as `spawn_executable` did; an absolute path is kept.
- **The reference Plans are inserted by a data migration** (`individual`, `family_4`; `ON CONFLICT (name) DO NOTHING`, values copied from `seeds.exs`). Every environment that migrates gets them, existing rows are untouched, and nobody has to run the demo seeds in production. Cost: reference data now lives in two places (migration and `seeds.exs` / test fixtures), and a later change to a plan's limits needs a new migration.
- **The missing-Plan path is also logged** (`Logger.error` in `Subscriptions.ensure_default_plan_id/1`), so a deleted or never-inserted row is no longer an anonymous 500. The HTTP answer stays 500 `unknown_error`: no new `error(:atom)` code, mobile allowlist untouched.

## Scope and constraints

- `apps/api` plus the two READMEs. No mobile change.
- No new error code in `MobileAuthController` / `ApiError`.
- Conventional commits, no attribution lines, no push, no PR.
- Tests run against a dedicated fresh database (`MYFOOD_TEST_DATABASE=meal_planner_api_test_fresh_setup`) so the shared local test database, which already holds committed Plan rows, cannot mask the sign-up bug.
- RDD is on (global). Review candidate = each work-unit commit.

## Tasks

- [x] T1 — Resolve the optimizer Python executable. `OptimizerPortRunner.open_port/1` resolves the executable (`System.find_executable/1` for a bare name, working-directory expansion for a relative path, absolute paths kept) and answers `{:error, {:python_not_found, name}}` with an actionable `Logger.error` when nothing executable is found. Route: delegated writer (2+ non-trivial files). Test-first: new `optimizer_port_runner_test.exs` (bare name through `PATH`, absolute path, unknown bare name, missing absolute path; RED = `ErlangError :enoent`), plus a characterization test in `optimizer_server_test.exs` that a runner error stops `init/1` with `{:shutdown, reason}`.
- [x] T2 — Reference Plans on every migrated database. Migration `20261008120000_seed_individual_and_family_4_plans.exs`; `Subscriptions.ensure_default_plan_id/1` logs the missing Plan. Route: same delegated writer. Test-first: new `subscriptions/reference_plans_test.exs` without fixtures (RED on the fresh database: rows missing, registration refused), log assertion in `subscriptions_test.exs`, and a `mobile_auth_controller_test.exs` case for sign-up with the `individual` row deleted (500 `unknown_error`, logged, code still pending, no User).
- [ ] T3 — Setup docs. Root `README.md` and `apps/api/README.md` list create, migrate and the optional demo seeds, and describe the `OPTIMIZER_PYTHON` resolution. Route: same delegated writer. Passive docs: structural readback only.

Forecast: about 250 authored changed lines, one PR if one is asked for. Delivery strategy: `ask-on-risk`.

## Checks

From `apps/api`, with `MIX_ENV=test MYFOOD_TEST_DB_USERNAME=luccagiordana MYFOOD_TEST_DB_PASSWORD="" MYFOOD_TEST_DATABASE=meal_planner_api_test_fresh_setup`:

- `mix compile --warnings-as-errors`
- `mix ecto.migrate` then `mix test`
- `mix format --check-formatted` on touched files

## Progress and evidence

- 2026-10-08 — Fresh database created and migrated at `507e107`: `subscription_plans` holds `family_6|6|30|family_6` and `trial|6|30|trial` only.
- 2026-10-08 — Baseline at `507e107` on the fresh database: `mix test` answers 1081 passed, 20 skipped, no failures (most suites call `SubscriptionPlanFixtures.ensure_plans!/0`).
- 2026-10-08 — T1, commit `c5548e1` (route: delegated writer). RED: 4 of the 6 new `optimizer_port_runner_test.exs` cases failed with `(ErlangError) Erlang error: :enoent` from `:erlang.open_port({:spawn_executable, "cat"}, ...)` (bare name, `./cat`, unknown bare name, missing absolute path). The absolute-path and relative-path cases and the `optimizer_server_test.exs` case (`{:shutdown, {:python_not_found, "python3"}}`) passed before the change: they characterize existing behavior. GREEN: both optimizer test files, 23 passed. Smoke: `OptimizerPortRunner.open_port()` with the default `"python3"` answers `{:ok, port}`. The tests spawn `cat -` (echo on stdin) rather than `cat <file>`: a program that exits at once races the runner's `Port.info/2` liveness check and is reported as `:spawn_failed`, which failed one runner test per full-suite run in three consecutive runs before the tests were changed.
- 2026-10-08 — The baseline run itself committed `individual` and `family_4` (and rewrote `family_6` to `6|7|NULL`) in the fresh database: `device_sessions_concurrency_test.exs` calls `ensure_plans!/0` in sandbox `:auto` mode with no checkout. With the rows there, the new `reference_plans_test.exs` passed before any fix. The two leaked rows were deleted by hand (no Account referenced them) to restore the migrations-only state before observing RED.
- 2026-10-08 — T2 (route: delegated writer). RED on the restored database: `reference_plans_test.exs` 0/3 passed (`Repo.get_by(Plan, name: "individual")` and `"family_4"` answered `nil`; `register_with_verified_email/2` answered `{:error, :unable_to_issue_identity}`). After `mix ecto.migrate`: `family_4|4|7`, `family_6|6|7`, `individual|1|7`, `trial|6|30`, and the file passes 3/3. RED for the log: the new `subscriptions_test.exs` and `mobile_auth_controller_test.exs` cases failed on an empty captured log (the 500 `unknown_error` answer already held). GREEN: the three files, 84 passed; full suite 1094 passed, 20 skipped, twice. Rollback: `down/0` of this migration alone ran (`Ecto.Migrator.run/4` with only this version; the rows stay) and `mix ecto.migrate` applied it again. `mix ecto.rollback --step 1` was not used: it would undo `202606070000000_add_checkout_session_to_shopping_items`, because six migrations carry 15-digit versions that sort after every 14-digit one.

## Out of scope, noticed

- `priv/repo/seeds.exs` and `SubscriptionPlanFixtures` upsert `family_6` with `max_planning_days: 7` and no RevenueCat entitlement, overwriting the `30` / `"family_6"` the migration inserts.
- `device_sessions_concurrency_test.exs` commits the fixture Plans outside the sandbox, so any database that ran the full suite holds them (and the rewritten `family_6`) for good. `reference_plans_test.exs` can only fail on a database no full run has touched.
- Six migrations have 15-digit versions (`202603311900000` … `202606070000000`). They sort after every 14-digit version, so they run last on a fresh database and `mix ecto.rollback --step 1` always targets `add_checkout_session_to_shopping_items`.
- On a machine whose `python3` lacks `ortools`, the boot now gets past the spawn and `optimizador.py` exits with `ModuleNotFoundError`; the server handles that as a crashed process (restart, then circuit open), not as a refused boot.
- The `Pending` section of the root `README.md` still says `apps/api` does not expose the mobile auth endpoints.
