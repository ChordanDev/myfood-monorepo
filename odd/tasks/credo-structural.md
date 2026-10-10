# Credo structural refactors (API)

## Objective

Clear the remaining `mix credo --strict` findings in `apps/api` so Credo can
become a blocking CI gate.

## Problem

After the mechanical cleanup (PR #163), 49 findings remain: 39
`Refactor.Nesting` (depth 3 to 6, limit 2), 9 `Refactor.CyclomaticComplexity`
(10 to 21, limit 9) and 1 `Readability.WithSingleClause`
(`persistence/leftovers.ex:72`). They concentrate in the generation, cart,
shopping and membership code.

## Scope

- In: extract private helpers and flatten control flow so each flagged
  function is under the limits. Behavior-preserving only.
- Out: changing public function signatures or return shapes, loosening limits
  in a `.credo.exs`, `# credo:disable` comments, Sobelow findings.

## Constraints

- Stacked on `chore/credo-cleanup` (PR #163).
- Existing tests are the safety net: no test is modified to make a refactor
  pass. A flagged function with no test coverage is refactored by pure
  extraction only and listed in the report.

## Tasks

- [x] T1 — Refactor the 49 flagged functions (delegated writer; 30+ files). Checks: `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix credo --strict` (target 0), full `mix test`, `mix dialyzer` (must not go up from 9 locally).
- [x] T2 — Commit `266f1a2`, stacked PR opened.
- [ ] T3 — Make Credo blocking in CI once it reports 0.

## Evidence

- Baseline: 49 findings on `87384d7` (`/private/tmp/claude-501/credo-structural.tsv`).
- T1 result: Credo --strict 49 -> 0; 1700 tests passed / 20 skipped; format and compile clean; Dialyzer unchanged at 9 locally. 27 lib files and 3 test helper files.
- Independent read-only verification of the lib diff against HEAD found no behavior change.
- Untested paths refactored by pure extraction only: `Mix.Tasks.AiPopulate`, `GeminiClient.process_sse_buffer/4`, `ShoppingService.assign_supermarket/3` (item_id path), `GenerationService.macro_violation?/2`, the racing-insert branch of `RevenuecatService.upsert_ledger_entry/2`.
- T3 pending: local Credo is 0 on Elixir 1.20; CI runs 1.17, where the count differed by 3 before. Flip the gate after a CI run confirms 0.
