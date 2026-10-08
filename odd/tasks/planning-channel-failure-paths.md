# Planning channel failure paths

Feature: `planning-channel-failure-paths`. Branch: `fix/planning-channel-failure-paths`, first based on `claude/issue-11-b445e9` at `908fc00` (ticket #11 is not merged into `main`), now on `feat/mobile-channel-casing` (see the delivery record). Engram mirror: `odd/planning-channel-failure-paths/tasks`.

## Objective

The planning channel replies the error envelope and stays alive on three inputs that crash it or fail for the wrong reason today.

## Problem

Three pre-existing failure paths in `apps/api/lib/meal_planner_api_web/channels/planning_channel.ex`, found by reading the code during ticket #11 and left out of it (see `odd/tasks/mobile-casing-envelope.md`, "Notes and follow-ups"):

1. `send_message` crashes the channel process. The `with` in the command has no `else` clause for `{:error, :invalid_session_id}` (from `require_uuid/1`) nor for the bare `:error` of `IntentAtomizer.atomize/1`; the `{:error, :atomize_failed}` clause next to them is dead, nothing returns that tuple.
2. A real command pushed with a payload that is not a map raises, because the clause reads it with `Map.get/3`. Only the unknown-event catch-all is covered by a test.
3. Cold-start `generate_menu` replies `unknown_error`: `DynamicSupervisor.start_child/2` answers `{:error, {:invalid_child_spec, _}}`.

## Why

A crashed channel process drops the client's subscription with no reply to act on, and the mobile client can only branch on the envelope codes. The third path means a generation can never start through the channel on a fresh node.

## Diagnosis of the third path

It is a real defect, not test configuration. `MealPlannerApi.Generation.Supervisor` is a plain `Supervisor` (`use Supervisor`, `supervisor.ex:9`) whose children are the `Generations` registry and an unnamed `DynamicSupervisor`. `Generation.Server.start_and_call/4` (`server.ex:221`) calls `DynamicSupervisor.start_child/2` on the outer module name, so the request reaches a plain supervisor in the tuple format of a dynamic one and is rejected as an invalid child spec. The child spec built by `use GenServer, restart: :temporary` is valid; the target process is the wrong one. The same call fails in every environment.

## Scope and constraints

- In scope: the three paths above, their channel tests, and the tests that relied on the cold-start failure to produce an `unknown_error` reply.
- Not changed: event names, the envelope shape `%{error: %{code, message}}`, the `MealPlannerApiWeb.ApiError` allowlist and its semantics, the generation pipeline.
- Test-first: one failing channel test per case in `apps/api/test/meal_planner_api_web/channels/planning_channel_test.exs`, observed RED before the fix.

## Design

- T1: the `else` of `send_message` replies `invalid_payload` for `{:error, :invalid_session_id}` (the code `cancel_planning` already replies for the same reason) and for the bare `:error` of the atomizer; the dead `:atomize_failed` clause goes away.
- T2: the guard lives at the single entry `handle_in/3`: a payload that is not a map replies `invalid_payload` before any command clause reads it.
- T3: the inner `DynamicSupervisor` gets a name and `Generation.Server` starts its children there. Tests that start a generation server clean it up, and the test of the `unknown_error` fallback gets a source of an unlisted reason that does not depend on this defect.

## Tasks

- [x] T1 `send_message` replies `invalid_payload` on a non-UUID `session_id` and on an intent the atomizer rejects; the channel stays alive. Route: delegated writer (channel plus test file, reading prepares the write).
- [x] T2 A real command with a non-map payload (string, list, integer) replies `invalid_payload`; the channel stays alive. Route: same delegated writer, continued.
- [x] T3 Cold-start `generate_menu` starts a generation server and replies ok. Route: same delegated writer, continued (server, supervisor, tests).
- [x] T4 Test-only: the four advisory findings of the review, accepted by the user. A server-level test of two or more concurrent cold `start_generation/4` calls for one account; a case that pins `invalid_payload` over `no_active_session` for `send_message` with a non-map payload and no session; the `get_status` barrier in the chat test; an explicit wait in `stop_generation_server/1`. Route: same delegated writer, continued (three test files).

## Acceptance criteria

1. `send_message` with a `session_id` that is not a UUID replies `%{error: %{code: "invalid_payload", ...}}` and a later command on the same socket still gets a reply.
2. `send_message` with an intent the atomizer rejects replies the same envelope and the channel stays alive.
3. `generate_menu` and `swap_constraints` pushed with a string, a list and an integer reply `invalid_payload` and the channel stays alive.
4. `generate_menu` with valid constraints and no running server replies ok with a `run_id`, with no `unknown_error` warning in the log.
5. The `unknown_error` fallback for a reason outside the allowlist is still proved by a test.

## Checks

From `apps/api`, with `MYFOOD_TEST_DB_USERNAME=<local role>`, `MYFOOD_TEST_DB_PASSWORD=""` and an isolated `MYFOOD_TEST_DATABASE`:

- `mix format --check-formatted`
- `mix compile --warnings-as-errors`
- `mix test`

## Delivery

Strategy `ask-on-risk`. Forecast: under 400 authored changed lines, one slice. Push, pull request and merge are the user's decisions.

### Delivery record

- 2026-10-08: ticket #11 was rebased onto `main` and published as the stack #63 to #66 while this feature was in progress, so the branch was rebased from `908fc00` onto the top of that stack, `feat/mobile-channel-casing` at `6e12d5e` (pull request #66), with no conflict. Commit identities changed: T1 `f84137e` is now `637f13d`, T2 `60692bc` is `b471e30`, T3 `d76800c` is `fb01fca`, T4 `edffe4a` is `eff0518`; the document commits `e9f6fc2`, `391145e` and `6688a4e` are `59ee541`, `62d00ef` and `c3828b2`. The native review recorded below ran on the pre-rebase commits.
- Checks after the rebase (parent run): `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1233 passed, 20 skipped, 0 failures.
- Running count: 561 changed lines (about 50 in `lib`, about 415 in tests, 95 in this document), above the 400 budget. The user chose one pull request with `size:exception` over three stacked slices: position 5 of the stack, based on `feat/mobile-channel-casing`.
- The user declined the native review of the whole accumulated branch (the ticket #11 commits plus this feature); the slice review below stands for T1 to T3, and T4 was under the budget.

## Progress

T1 to T3 done; the five acceptance criteria are covered by tests. T4 (the review follow-ups) done. Next step: delivery, on the user's instruction. Local runs use `MYFOOD_TEST_DATABASE=meal_planner_api_test_channel_paths`, created with `MIX_ENV=test mix ecto.create` and `MIX_ENV=test mix ecto.migrate` (there is no `test` alias). Reviewed boundary: `e9f6fc2`.

| Task | Commit | Checks | Review |
|------|--------|--------|--------|
| T1 | `f84137e` `fix(api): reply invalid_payload when send_message gets a bad session id or intent` | RED, one slice at a time: `WithClauseError` on `{:error, :invalid_session_id}`, then on the bare `:error`, each crashing the channel (`EXIT` in the test). GREEN: channel file 65 passed. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1187 passed, 20 skipped, 0 failures (writer run). Parent spot check: channel file 65 passed. | medium (`executable_change`), 80 lines, `under_budget`: pending in the slice. |
| T2 | `60692bc` `fix(api): reply invalid_payload when a planning command gets a non-map payload` | RED before the fix, run per command: `BadMapError` on `Map.get/3` for the three payload kinds on `generate_menu`, `swap_constraints`, `confirm_proposal`, `start_planning`, `cancel_planning` and `send_message` with a session (18 tests); `chat` and `reject_proposal` already replied through the catch-all (6 characterization tests). GREEN: channel file 89 passed. Writer mutation check: an unguarded `handle_in/3` fails the `generate_menu` and `swap_constraints` cases. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1211 passed, 20 skipped, 0 failures (writer run). Parent spot check: channel file 89 passed. | medium (`executable_change`), slice at 158 lines, `under_budget`: pending in the slice. |
| T3 | `d76800c` `fix(api): start generation servers under the dynamic supervisor` | RED: the channel cold-start test got an `unknown_error` reply with the `:invalid_child_spec` warning in the log. GREEN: 1 passed. The server-level cold-start test was written after the fix; its failure is proved by the mutation run. Writer mutation check: with `start_and_call/4` pointed back at `Generation.Supervisor`, both new tests fail and the channel file drops to 86 of 90. Repeated runs: channel file 14 runs, `server_test.exs` 3 runs, both files together 5 runs, no failing test. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1213 passed, 20 skipped, 0 failures, twice (writer) and once more (parent run, with no `owner exited` nor `unknown_error` line in the log). | medium (`executable_change`), slice `908fc00..d76800c` at 355 lines, `under_budget` at that commit. With the feature document (`e9f6fc2`) the slice `908fc00..e9f6fc2` reached 442 lines, `slice_budget_reached`: consent granted; one lens (reliability) approved and acknowledged, lineage `review-a7056285c03c78de`. Reviewed boundary: `e9f6fc2`. Four advisory findings, none blocking, recorded below. |
| T4 | `edffe4a` `test(api): cover the concurrent cold start and pin the review follow-ups` | Test-only, no file under `apps/api/lib` in the commit. Characterization, no RED; writer mutation checks: without the `{:error, {:already_started, pid}}` clause of `start_and_call/4` the concurrent test fails 10 of 10 runs; with a non-map payload handed to the command the precedence test fails (`no_active_session`). Lib hashes restored. Both files together 10 runs with different seeds, 125 passed each. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1215 passed, 20 skipped, 0 failures (writer run and parent run, no error line in the log). | medium (`executable_change` in a test file), slice since `e9f6fc2` at 149 lines, `under_budget`: no review due, pending in the slice. |

## Notes and follow-ups

- T1: the atomizer rejection is exercised with an intent that is a string, so it does not depend on which atoms the test VM has loaded.
- T2: the guard runs before the command looks at socket state, so `send_message` with a non-map payload and no session replies `invalid_payload` instead of `no_active_session`. No existing test pinned the old order.
- T2: `snake_case_payload/1` is gone (the guard made its non-map clause dead), and the test `a payload that is not a map is handed to the command as it is` was renamed to `a payload that is not a map replies invalid_payload on an unknown event`, body untouched.
- T2: several crashed channels in one ExUnit run take the application down, and later tests fail in setup with `could not lookup Ecto repo`. Cause not confirmed. RED runs of crash paths are cleaner in small groups.
- T3: the diagnosis held. `start_and_call/4` is the only production path that starts a generation server, so the cold start failed in every environment, not only in tests.
- T3: in the test environment the optimizer server is not started (`start_optimizer_server: false`), so a generation calls no external service: `OptimizerServer.select_weekly_menu/1` returns `{:error, :optimizer_unavailable}` and the run ends in a `generation_error` broadcast (`no_candidates_for_slot` with the test accounts). The server works on the database from its own process through the shared sandbox, so a test that starts one waits for the pipeline with `Server.get_status/1` (answered after the queued `:run_optimization`) and then stops the server: `stop_generation_server/1` in `test/support/server_test_fixtures.ex`.
- T3: every test of the channel file gets the same account id, so a leaked generation server answers the commands of later tests. The `setup` of the file has an `on_exit` that stops any server still registered for the account.
- T3: existing channel tests changed. `generates response with request_id` and `build_request_id generates unique ids` now assert the ok reply and stop the server; `error when Server.start_generation fails with invalid constraints` became `... fails with a fault` and takes its unlisted reason from `start_generation_server_stub/2` instead of from the defect; the chat test `success when GenerationServer is running` asserts the reply and the push instead of sleeping (before the fix it never had a running server); `generate_menu replies and announces the generation in camelCase` got the `get_status` barrier. Acceptance criterion 5 is proved by `a reason outside the allowlist replies unknown_error and is logged`, which already used the stub and is untouched.
- Follow-up (product decision, not in this feature): `generate_menu` does not validate its dates before it starts. `PlanningRequestValidator.validate_request/3` checks only the actor and the participants, so `"date_from" => "invalid-date"` replies ok with a `run_id` and fails later through a `generation_error` event. The cold-start defect used to hide this; no test covers it.
- Follow-up (not in this feature): a generation server started by a cold start is `restart: :temporary` and nothing stops it when idle, so one process per account stays registered after its generation ends. Reachable only now that the cold start works.
- Follow-up (not in this feature): `Server.handle_cast({:chat, ...})` discards the result of `handle_chat/3`, so a chat modification re-runs the pipeline with the old constraints; `Server` calls `OptimizerServer` directly instead of the configured `planning_optimizer_client`, so the `proposal_ready` path is not reachable from a channel test; the comment above `MealPlannerApi.Generation.Supervisor` in `application.ex` still calls it a DynamicSupervisor.
- Follow-up (unconfirmed): an `owner exited` log line appeared next to the test `send_intent, broadcast by the AI channel, is pushed in camelCase` in 2 traces and was not reproduced in 15 later runs.
- Follow-up from the review (advisory, not blocking; accepted by the user as T4): two clients of one account pushing a cold `generate_menu` at once is reachable only now; `start_and_call/4` already routes `{:error, {:already_started, pid}}` to the running server, but no test issues two concurrent `start_generation/4` calls. The chat test waits for the `invalid_modification` push with a fixed 1000 ms budget instead of the `get_status` barrier. `stop_generation_server/1` inherits the default `GenServer.call` timeout. No case of the non-map matrix pushes `send_message` without a session, so the new precedence over `no_active_session` is not pinned by an assertion.
- T4: callers of `start_generation/4` do not collide on their own in tests, because each one reads the database before the Registry lookup and the shared sandbox connection serves those reads one at a time (12 tasks released together: the mutation failed 0 of 10 runs). The committed test suspends `MealPlannerApi.Generation.ServerSupervisor` with `:sys.suspend/1`, waits through a receive trace until each of 8 callers has queued its start request, and resumes it; both are undone in an `after`, and the file is `async: false`. It asserts the invariant, not one interleaving: every result is `{:ok, run_id}` or `{:error, :already_running}`, at least one is ok, one server is registered. Observed: 1 ok and 7 `already_running` in every run. No defect found; with a connection pool the race is reachable in production and the code handles it.
- T4: the barrier of the chat test goes before the chat push, not after it. The cast comes from the channel process and `get_status` from the test process, so a call sent after the push is not ordered after the cast. With the pipeline already finished, the push assertion is back on the default timeout.
- T4: `stop_generation_server/1` now resolves the pid, monitors it, waits with `:sys.get_state(pid, 30_000)` (answered in mailbox order, explicit timeout, no dependency on the private call messages of `Server`), terminates the child and asserts the `:DOWN`. It covers the messages already in the mailbox; a chat modification handled before the wait queues another generation that the stop would cut.
- T4: the chat test and the camelCase test still call `Server.get_status/1` as their in-test barrier, with its default 5 s timeout.
- Follow-up (not in this feature): the `else` of `send_message` has no catch-all. `PlanningSessionServer.apply_intent/3` forwards whatever `validate_ai_intent/1` returns as `{:error, _}`, so a reason added to that validator would crash the channel again.
