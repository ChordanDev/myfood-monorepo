# Credo cleanup (API)

## Objective

Bring `mix credo --strict` in `apps/api` down from 286 findings by fixing the
mechanical ones, without changing behavior.

## Problem

Credo runs in CI as an informational step because of its backlog. 238 of the
286 findings are mechanical (aliases, ordering, number formatting, redundant
`with` clauses); 48 are structural (`Refactor.Nesting`, `CyclomaticComplexity`).

## Scope

- In: every check except `Refactor.Nesting` and `Refactor.CyclomaticComplexity`.
- Out: the 48 structural findings (separate decision), Sobelow findings, any
  `.credo.exs` that disables or loosens checks.

## Tasks

- [x] T1 — Fix mechanical findings in `lib/` and `test/` (delegated writer). Route: delegated, 100+ files. Checks: `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix credo --strict`, full `mix test`, `mix dialyzer`.
- [ ] T2 — Commit as work units and open the PR.

## Evidence

- T1 result: 286 -> 49 findings. Left: 39 Nesting, 9 CyclomaticComplexity (out of scope) and 1 WithSingleClause in `persistence/leftovers.ex:72`, whose `case` rewrite would add a CyclomaticComplexity finding.
- T1 checks: format ok, compile --warnings-as-errors ok, 1700 tests passed / 20 skipped, Dialyzer unchanged at 9 locally.
- Public renames: `PlanningRepo.is_slot_favorite?/4` -> `slot_favorite?/4`; `RecipeRepo.is_favorite?/2` and `RecipeService.is_favorite?/2` -> `favorite?/2`.

- Baseline: 286 findings on `0977c2e` (`/private/tmp/claude-501/credo.json`).
- Delivery: single PR; the diff is large but mechanical (mostly alias lines).
