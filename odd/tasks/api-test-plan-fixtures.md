# Feature: tests and seeds leave the reference Plans as the migrations wrote them

Branch: `fix/api-test-plan-fixtures` (from `main` at `d67a7d9`). No spec issue; reported by the maintainer on 2026-10-08 (noticed while working on `fix/api-fresh-db-setup`).

## Objective

A test database holds the same `subscription_plans` rows after `mix test` as after `mix ecto.migrate`, and the fixtures and the demo seeds describe `family_6` with the values its migration inserts.

## Problem

Both were confirmed on 2026-10-08 before any change, on a dedicated database built by `mix ecto.create && mix ecto.migrate` at `d67a7d9`.

1. **Committed fixture rows.** `test/meal_planner_api/services/device_sessions_concurrency_test.exs` calls `SubscriptionPlanFixtures.ensure_plans!/0` in `setup_all` with the sandbox in `:auto` mode and no checkout, so the upsert is committed. Before: `family_6|6|30|family_6`, `trial|6|30|trial`. After that file alone (5 passed), and after a full `mix test` (1081 passed, 20 skipped): `family_4|4|7|NULL`, `family_6|6|7|NULL`, `individual|1|7|NULL`, `trial|6|30|trial`. No other table kept a row. The other three suites that call the fixtures without a checkout (`inventory_concurrency_test.exs`, `cart_concurrency_test.exs`, `services/cooking_atomicity_test.exs`) are skipped unless they are pointed at an explicitly disposable database, so they are not part of a normal run.
2. **Fixture and seed values.** `test/support/subscription_plan_fixtures.ex` and `priv/repo/seeds.exs` upsert `family_6` as `max_planning_days: 7`, `revenuecat_entitlement_id: nil` with `on_conflict: {:replace, ...}`. Migration `20260625000002_alter_accounts_to_plan_enum.exs` inserts `30` / `"family_6"`.

## Decision on the `family_6` values (2026-10-08)

The migration values are the ones of record: `max_planning_days: 30`, `revenuecat_entitlement_id: "family_6"`.

- The archived Phase A design (`apps/api/openspec/changes/archive/2026-07-21-phase-a-tenancy-refactor/design.md`, §2.2 item 5 and Q10) specifies exactly those values, and the migration implements them. The fixture and seed values date from `74f8d15` (2026-03-26), before that design; they were never updated.
- `docs/GLOSSARY.md` and `docs/adr/` say nothing about planning days or the entitlement id of a Plan.
- No reader contradicts either value. `Subscriptions.max_planning_days/1` and `serialize_policy/1` only pass the row through (the `subscription` object of the auth and account responses). Planning does not read the row: `PlanningService.resolve_max_days/1` and `Planning.weekly_plan_for/2` cap at 5 or 7 from `subscription_tier`. `RevenuecatService` stores the entitlement id the webhook carries and never looks at `subscription_plans.revenuecat_entitlement_id`.

## Scope and constraints

- `apps/api` tests, test support and `priv/repo/seeds.exs`. No migration, no `lib/` change.
- What the concurrency suite proves (one active Device session per User and device under real overlap) stays as it is.
- Conventional commits, no attribution lines, no push, no PR.
- Checks run against the dedicated database `meal_planner_api_test_fixture_leak`.

## Tasks

- [x] T1 — No test commits Plan rows. The two tests that run on real connections stop calling `ensure_plans!/0`; a new `SubscriptionPlanFixtures.ensure_committed_plan!/1` inserts only the Plan the test needs when the database lacks it and registers its deletion with `on_exit`. Route: inline (one small helper, two call sites). Test-first exception: the property is the state of the database after the suite has finished, so it is observed as a before/after snapshot of every table, not as an ExUnit assertion. RED is the snapshot recorded above.
- [x] T2 — Fixtures and seeds agree with the migration for `family_6`. Route: inline (two mechanical value edits and one test). Test-first: a `subscriptions_test.exs` case that the `family_6` row keeps `30` / `"family_6"` once the fixtures ran.

Forecast: about 60 authored changed lines, one PR if one is asked for. Delivery strategy: `ask-on-risk`.

## Checks

From `apps/api`, with `MIX_ENV=test`, the local database credentials and `MYFOOD_TEST_DATABASE=meal_planner_api_test_fixture_leak`:

- `mix compile --warnings-as-errors`
- `mix test`, with a snapshot of `subscription_plans` and of the row count of every table before and after
- `mix format --check-formatted` on touched files

## Progress and evidence

- 2026-10-08 — Baseline and RED for T1 recorded under "Problem".
- 2026-10-08 — T1. Changing only the concurrency suite was not enough: that file alone left the database unchanged, but a full run still committed the three fixture rows. The second source is `test/meal_planner_api/accounts_test.exs` ("at most one concurrent joiner becomes :owner ..."), which checks out a connection with `sandbox: false` and then called `ensure_plans!/0`. Both now call `ensure_committed_plan!("individual")`. GREEN, each on a database rebuilt from migrations: the concurrency file alone (5 passed) and the full suite (1081 passed, 20 skipped) leave `subscription_plans` at `family_6|6|30|family_6`, `trial|6|30|trial` with the same ids and `updated_at`, and every table at its previous row count. With an `individual` row committed beforehand, the concurrency file leaves that row in place, untouched. `mix compile --warnings-as-errors` and `mix format --check-formatted` on the three files are clean. Commit: `b11a512`. Review assessment against `d67a7d9`: `medium`, `review_due: false` (`under_budget`).
- 2026-10-08 — T2 (its commit is the one that adds this line). RED: the new `subscriptions_test.exs` case failed with `plan.max_planning_days == 30`, left `7`. GREEN after the two value edits: full suite 1082 passed, 20 skipped on a database rebuilt from migrations, and `subscription_plans` plus every row count identical before and after. On a database made to look like one a pre-fix run had been through (`individual` and `family_4` committed, `family_6` at `7|NULL`): 1082 passed with `--seed 0`, rows left as they were. Seeds: `mix run priv/repo/seeds.exs` on a migrated database leaves `family_6|6|30|family_6`. `mix compile --warnings-as-errors` and `mix format --check-formatted` on the touched files are clean. The dedicated database was dropped afterwards.

## Out of scope, noticed

- A test database that already went through a full run before `b11a512` keeps its committed `individual`, `family_4` and `family_6|6|7|NULL` rows; nothing here repairs it. `MIX_ENV=test mix ecto.reset` rebuilds it from the migrations.
- The migration inserts `family_6` with `ON CONFLICT (name) DO NOTHING`, and the seeds upserted `7` / `nil` from 2026-03-26 on. An environment that ran the seeds before `20260625000002` therefore still holds `7` / `nil`. Whether any deployed database is in that state was not inspected (no access); changing it would need a data migration.
- Nothing enforces `subscription_plans.max_planning_days`: planning caps at 5 or 7 from `subscription_tier`. The 30 is only reported to clients in the `subscription` object.
- `inventory_concurrency_test.exs`, `cart_concurrency_test.exs` and `services/cooking_atomicity_test.exs` still call `ensure_plans!/0` on real connections. They are skipped unless pointed at a disposable database, and `cooking_atomicity_test.exs` keeps its committed rows on purpose, so they were left alone.
- `test/meal_planner_api/subscriptions_test.exs` has an unused `alias ...Subscriptions.Plan` warning on `main`; `fix/api-fresh-db-setup` starts using it.
