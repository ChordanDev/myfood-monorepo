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

- [ ] T1 — Fix id types in specs across `apps/api/lib` (delegated writer). Checks: `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix dialyzer --format short` (record the new total).
- [ ] T2 — Commit as one work unit with a Conventional Commit message.

## Evidence

- Baseline: 119 warnings (`/private/tmp/claude-501/dialyzer3.log`).
- Previous commit: `7cea4af` (added `@type t` to schemas).
