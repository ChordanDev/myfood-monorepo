# Feature: a successful generation run emits `proposal_ready`

Branch: `fix/158-proposal-ready-string-slot` (from `main` at `b79198c`). Spec: issue #158, with the triage comment of 2026-10-11, which wins over the issue body where they differ.

## Objective

A generation run whose optimizer answer is valid ends in a `proposal_ready` broadcast, from `Generation.Server` and through the Planning channel.

## Problem

`PayloadAdapter.translate_response/2` returns each resolved slot with `slot` as a string (`"lunch"`); every optimizer backend emits strings. `Generation.Server` hands that list to `GenerationService.build_proposal_json/1`, which calls `GenerationService.slot_key/2`, guarded by `is_atom(slot)`. The `FunctionClauseError` is swallowed by the run's `rescue` and broadcast as `generation_error` with `reason: "pipeline_error"`, so no run of the real engine reaches `proposal_ready`. No test covers the success path: `generation/server_test.exs` never asserts `proposal_ready`, and `planning_start_test.exs` feeds it through `Endpoint.broadcast!` with atom slots.

## Scope and constraints

- In scope: `GenerationService.slot_key/2` accepts the string slot, plus the two tests the issue asks for (one that drives `Generation.Server` to `proposal_ready` with a seeded recipe, one `planning_start_test.exs` case with the real engine).
- Out of scope, left for the engine owner (triage decision): the missing `run_id` on `generation_error` broadcasts and the `{day, slot}` tuples in `incomplete_coverage`. `Generation.Server`, the Optimizer port and its backends, `PayloadAdapter` and the Planning session server are not edited.
- If the success path fails for a second reason inside those engine files, the work stops there and the finding goes to the report.
- Blocked issues (#25 and the planner chain) are not started here.
- Conventional commits, no attribution lines. One PR against `main`, `Closes #158`.

## Tasks

- [x] T1 — `slot_key/2` accepts a string slot and a run reaches `proposal_ready`. Route: delegated (one writer; the engine test needs the run server, its fixtures and the optimizer server read first). Test-first: a `generation/server_test.exs` case that starts a run with a seeded recipe and expects `proposal_ready`, plus unit cases for `slot_key/2` and for `build_proposal_json/1` fed the output of `PayloadAdapter.translate_response/2`. RED observed: the engine case times out on `proposal_ready` with `generation_error` / `pipeline_error` in the mailbox; both unit cases raise `FunctionClauseError` in `slot_key/2`. Commit: `43060aa` `fix(api): accept the optimizer's string slot in slot_key`.
- [x] T2 — `planning_start_test.exs` asserts the `proposal_ready` days produced by the real engine: `start_planning` over two days, three meals per day, then the `planning_message` summary. Route: delegated (same writer). Test-first: written against the unfixed `slot_key/2` and observed failing on `assert_push("proposal_ready", ...)` with `pipeline_error` in the mailbox. Commit: `test(api): assert proposal_ready from a real generation on start_planning`.

Forecast: about 150 authored changed lines, one PR. Observed: 199 added, 5 removed across five files in `apps/api`; the fixture helpers and their docs are the difference. Delivery strategy: `ask-on-risk` (below the budget, no slicing).

## Decisions

- **The engine tests start their own optimizer server.** `Generation.Server` calls `OptimizerServer.select_weekly_menu/1` directly, not the configured `planning_optimizer_client`, and `config/test.exs` sets `start_optimizer_server: false`, so a run that reaches the optimizer in tests ends in `optimizer_unavailable`. `ServerTestFixtures.start_optimizer_server!/0` starts the real `OptimizerServer` on the existing `FakePortRunner`, and `answer_optimizer_request/1` answers the pending solve request with what `OptimizerMock` selects for the real payload, as a JSON solution frame. `Generation.Server`, the `OptimizerServer` framing and `PayloadAdapter` run for real; the Python solver does not, as in every other test of the suite. This is test support, not an engine edit, so it was not treated as a second engine failure.
- **`insert_recipe/2` takes `:suitable_for_slots`.** `start_planning` expands breakfast, lunch and dinner, and the fixture seeded lunch and dinner only. The default is unchanged.
- **The channel case does not pin `priceCents`, costs or macros.** Seeded recipes cost 0, and what an unknown price should look like on the wire is not this issue's question.

## Checks

From `apps/api`, with `MIX_ENV=test`, `MYFOOD_TEST_DB_USERNAME=luccagiordana`, `MYFOOD_TEST_DB_PASSWORD=""` and `MYFOOD_TEST_DATABASE=meal_planner_api_test_158`, on the final tree:

- `mix compile --warnings-as-errors`: exit 0, no warnings.
- `mix test` on `generation_service_test.exs`, `generation/server_test.exs` and `planning_start_test.exs`: 146 passed (run by the writer and again by the parent).
- With only the `slot_key/2` guard reverted, the two new engine cases: 0 of 2 passed, both on `pipeline_error` (parent run). Restored afterwards.
- `mix test`: 1737 passed, 21 skipped, 0 failed.
- `mix format --check-formatted` on the five touched files: exit 0.
- `mix credo --strict`: no issues.
- Repeats: the engine case 5 of 5, the channel case 17 of 17.
- Not run: `mix sobelow --config` and dialyzer (no `lib/` change beyond a guard and its spec).

## Observations for the engine owner (nothing changed)

- `server_owned_budget/1` (`generation/server.ex`) uses the Account's `default_budget_cents` as the budget and Accounts are created with 0, while `GenerationService` rejects a menu whose cost exceeds the budget. A real run with any priced recipe looks likely to end in `budget_exceeded`. Read from the code, not reproduced; the new tests seed recipes that cost 0.
- `docs/CHANNELS.md` says `priceCents` is `null` when the price is unknown; a real run sends `0`.
- The `rescue _ ->` of the run logs nothing, which is what kept this failure invisible.
- Already known and left as they are by the triage decision: no `run_id` on `generation_error`, `{day, slot}` tuples in `incomplete_coverage`.

## Progress

T1 and T2 done. Next step: the PR against `main` with `Closes #158`. Review outcome and anything found after the last commit are recorded in the PR and in Engram, not here.
