# Dialyzer: align id types in @spec with the schemas

## Objective

Bring `mix dialyzer` in `apps/api` down from 119 warnings by fixing the
`@spec`s that still declare ids as `pos_integer()` while the Ecto schemas use
`binary_id` (UUID).

## Problem

Many `@spec`s in `lib/meal_planner_api/data/*`, `generation/server.ex`,
`services/planning_service.ex` and others type ids as `pos_integer()`. Callers
pass UUIDs, so Dialyzer concludes the calls cannot succeed and cascades into
`no_return`, `call`, `pattern_match` and `unused_fun` warnings in controllers,
channels and services.

## Scope

- Only `@spec` and `@type` lines. No runtime behavior changes.
- Each id is checked against the schema's `@primary_key` / foreign key type
  before changing; a schema that really uses integer ids keeps `pos_integer()`.

## Tasks

- [x] T1 — Fix id types in specs across `apps/api/lib` (delegated writer). Checks: `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix dialyzer --format short` 119 -> 41.
- [x] T2 — Commit as one work unit: `8196421`.

## Progress

- Remaining 41 warnings are body-level: dead `nil` branches after bang calls (`account_service.ex:30`, `inventory_service.ex:360`, `planning_service.ex:184`), `build_candidates/2` spec vs. builder returns, `DynamicSupervisor.on_start/0` (should be `Supervisor.on_start/0`).

## Evidence

- Baseline: 119 warnings (`/private/tmp/claude-501/dialyzer3.log`).
- Previous commit: `7cea4af` (added `@type t` to schemas).
