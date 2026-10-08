# Feature: mobile casing and channel error envelope (X1)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/11 (label `ready-for-agent`, cross-cutting for specs #1 to #5, blocker #6 closed).
Branch: `claude/issue-11-b445e9` (from `main` at `507e107`).

## Objective

Every mobile-facing HTTP route and every planning channel message speaks camelCase, and a failed planning channel command replies the `{ error: { code, message } }` envelope, so the app never has to translate snake_case or parse a free-text channel error.

## Problem

Only the auth routes and `GET /api/me` are camelCase, by hand. The product routes (planning, calendar, recipes, cooking, shopping, inventory) read and render snake_case, the planning channel reads and pushes snake_case, and its error replies are `%{reason: string | atom}`. There is no casing transform anywhere and `ApiError` can only render onto a `Plug.Conn`.

## Scope and constraints

- Expand only: nothing is deleted, no route or event is renamed.
- Opt-in per pipeline. Auth routes, `/auth/me`, `/account/*` and `/api/accounts/:account_id/*` keep their pipelines; their contract tests stay byte-for-byte unchanged and green.
- One envelope renderer: channel replies reuse `MealPlannerApiWeb.ApiError`, no second allowlist.
- Decisions taken with the user (2026-10-08):
  - Every existing planning channel error reason becomes an allowlisted code in `ApiError` and in the mobile allowlist, kept in lockstep (mobile `errors.ts`, `authService.ts`, `AuthErrorCode` union, messages map).
  - Flat HTTP error bodies on the product controllers (21 sites, `%{error: string | atom}`) stay out of this slice. Their keys go through the casing transform like any other body; the envelope conversion belongs to the P/R/S slices that introduce each code.
- Out of scope, recorded as follow-ups: flat HTTP errors above; the `reason` field inside `generation_error` pushes (an event payload, not a command reply); stale `apps/api/docs/CHANNELS.md` planning section beyond the parts this change touches.
- RDD is on (global). Review candidate is each work-unit commit, assessed with `--base-ref <last reviewed boundary> --committed-only`. First boundary: `507e107`.

## Design

### Casing (pure module)

`MealPlannerApiWeb.Casing` with `camelize_keys/1` and `snake_keys/1`.

- Recurses through plain maps and lists only. Structs (`DateTime`, `Date`, `Decimal`, any other) are values and are returned untouched. Values are never changed, atoms included.
- Output keys are strings. Atom and string keys are both accepted; an atom key always comes out as a string, rewritten or not (`nil`, `true` and `false` included).
- A key name is only rewritten when it is an identifier in the source casing: snake_case identifier for `camelize_keys/1`, camelCase identifier for `snake_keys/1`. Any other name (dates, UUIDs, numeric strings, names with dashes or spaces) is kept as spelled, as a string. Only a key that is neither an atom nor a string (an integer, a tuple) is left exactly as it is. Both functions are idempotent.
- Opaque keys, one level: the direct keys of a map stored under an opaque key are data, not field names, and are preserved (the opaque key itself is rewritten). Recursion continues into the values, so field names deeper down are still rewritten. The list lives in one place in the module: `by_category` (ingredient category enum, includes `no_perecederos`, values are lists of item maps) and `timers` (client-supplied cooking timers keyed by id).
- Rationale (T1): an any-depth opaque rule left `byCategory.<category>[].ingredient_id` in snake_case, against criterion 1. `details` was rejected as opaque: its keys are field names (`causes`) and the name is too generic.
- The two rewrites are exact inverses. A word that starts with a digit is not an identifier, so keys such as `calories_per_100` or `item_2_id` are left untouched (none is routed on the mobile surface today). Every uppercase letter starts a word, so clients send `deviceId`, never `deviceID`.

### HTTP

`MealPlannerApiWeb.Plugs.MobileCasing`:

- Request: rewrites `conn.params`, `conn.body_params` and `conn.query_params` with `snake_keys/1` before the controller runs.
- Response: `register_before_send/2`; when the response body is JSON it is decoded, passed through `camelize_keys/1` and re-encoded. Non-JSON, empty, undecodable, chunked and file responses pass through untouched.

Router: a new `:mobile_casing` pipeline placed right after `:api` so the hook is registered even when a later plug halts. Applied to the product scope (`[:api, :mobile_casing, :auth, :enforce_capability]`) and to `GET /me`, which moves into its own `[:api, :mobile_casing, :auth]` scope. Nothing else is piped through it.

### Channel

- `ApiError.envelope/1` returns the bare `%{error: %{code: code, message: message}}` map for an allowlisted code; `error/2` is rebuilt on top of it. Unknown reasons never leak: they reply the `unknown_error` envelope and are logged.
- Error replies (commands and joins) become that envelope. A reply that carried `request_id` keeps it next to `error` for correlation.
- Inbound: one public `handle_in/3` normalizes the payload with `snake_keys/1` and dispatches to the existing clauses.
- Outbound: ok replies are camelized where they are built; every event pushed on `planning:<account_id>` is intercepted and camelized in `handle_out/3`, because four modules outside the channel broadcast to the topic (`Generation.Server`, `PlanningSessionServer`, `PlanningSessionSweeper`, `AIChannel`). A test pins the intercept list against the events those modules emit.

## Tasks

- [x] **T1 Casing module.** `Casing.camelize_keys/1` and `snake_keys/1` with the rules above, unit tested (nested lists, structs, atom values, mixed atom and string keys, non-identifier keys, opaque keys, idempotence). Route: delegated (preparation reading plus two files).
- [x] **T2 HTTP opt-in pipeline.** `MobileCasing` plug, `:mobile_casing` pipeline, product scope and `/me` wired, product controller tests updated to camelCase requests and responses. Also closes the three advisory findings of the T1 review in `Casing` (deterministic winner on key collisions, tests for the opaque rule reach and for special atom keys). Route: delegated (plug, router, about ten test files).
- [x] **T3 Channel error envelope.** `ApiError.envelope/1`, channel codes added to the API allowlist and to the mobile allowlist in lockstep, command and join error replies converted, channel tests updated. Route: delegated (API and mobile files).
- [x] **T4 Channel casing.** Inbound normalization, camelCase ok replies, `intercept` plus `handle_out/3` for every outbound event, tests asserting pushes. `apps/api/docs/CHANNELS.md` planning section updated for the envelope and casing. Route: delegated.

## Acceptance criteria (from the ticket)

1. Any route in the authenticated mobile pipeline (planning, calendar, recipes, cooking, shopping, inventory, me) responds with camelCase keys only, recursively, nested lists included. (T1, T2)
2. camelCase request params on those routes and on planning channel commands are normalized before the controller or handler sees them. (T2, T4)
3. Pushes and broadcasts from the planning channel carry camelCase payloads. (T4)
4. A failed channel command replies `{ error: { code, message } }` with an allowlisted code. (T3)
5. Auth and account-scoped routes behave exactly as before, contract tests unchanged. (T2, checked in every task)
6. The transform is opt-in per pipeline. (T2)

## Checks

- API, from `apps/api`: `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix test`. Use an isolated database (`MYFOOD_TEST_DATABASE=myfood_test_issue11`) because another worktree runs the same suite.
- Mobile, from `apps/mobile` (T3 only): `npm test`, `npm run typecheck`, `npm run lint`.
- Test-first: each task observes RED on its new or updated tests before the implementation.

## Delivery

- Strategy: `ask-on-risk`; chain strategy `stacked-to-main`, carried over from the user's choice on the mobile auth feature (2026-10-07).
- Forecast: about 1,100 authored changed lines (T1 ~200, T2 ~350, T3 ~300, T4 ~250), above the 400 budget, so two slices are planned: S1 = T1 + T2 (HTTP), S2 = T3 + T4 (channel) stacked on S1. Boundaries are confirmed from the real counts.
- Running count after T4: about 3,400 (T4 and T3b about 945, of which about 700 are channel tests). After T3: about 2,450 (T2b 66, T3 about 780). Earlier: 550 after T1 (module 141, tests 409), about 1,650 after T2 (T2 adds about 1,100: plug 92, router and casing about 80, new plug and contract tests about 600, product test updates about 330). The forecast was low because the test matrices dominate; nothing was compressed to fit.
- Revised slices, one per task, stacked to main in order: S1 = T1 (`08c2fde`), S2 = T2, S3 = T3, S4 = T4. Pull requests are opened only on the user's instruction.

## Progress

T1 to T4 done; all six acceptance criteria are covered by tests. Next step: delivery, on the user's instruction. Local test runs need `MYFOOD_TEST_DB_USERNAME=<local role>` and an empty `MYFOOD_TEST_DB_PASSWORD` next to `MYFOOD_TEST_DATABASE`. Baseline suite on `507e107`: 1081 passed, 20 skipped, 0 failures.

| Task | Commit | Checks | Review |
|------|--------|--------|--------|
| T1 | `08c2fde` `feat(api): add key casing transform for the mobile contract` | RED 31/31 failing (module missing), then 7 failing on the one-level opaque rule; GREEN 35 passed. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1116 passed, 20 skipped, 0 failures. Parent spot check: casing tests 35 passed. | medium, `slice_budget_reached`; consent granted; one lens (reliability) approved and acknowledged, lineage `review-3219a9d7b7a496b4`. Reviewed boundary: `08c2fde`. Three advisory findings accepted into T2: pin the winner when two keys collapse to one name, state the name-global reach of the opaque rule in a test, cover `nil`/`true`/`false` atom keys. |
| T2 | `47db472` `feat(api): opt product routes and /me into the camelCase mobile pipeline` | RED: plug and casing unit tests 21 of 58 failing, contract test 9 of 13 failing; first full run 25 failures (24 product tests, 1 cross-account) before the product assertions were updated. GREEN: unit 59 passed, contract 12 passed. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1152 passed, 20 skipped, 0 failures (parent run). Auth and account contract tests untouched in `git diff --stat`. | medium, `slice_budget_reached`; consent granted; one lens (reliability) approved and acknowledged, lineage `review-388db08de6a5e873`. Reviewed boundary: `47db472`. Advisory findings: two accepted as test-only work before T3 (a router-level halting request that proves the pipeline order, and a `/me` check that fails without the pipeline); the rank-tie note is not reachable because the two rewrites are injective, the comment is reworded with them. |
| T2b | `da70520` `test(api): prove the mobile casing pipeline order through the router` | Test-only. Mutation check by the writer: with the plug a no-op, 3 of 4 wiring tests fail. Included in the T3 full run. | reviewed with T3 |
| T3 | `eaa2b6f` `feat: reply the error envelope on planning channel commands` | RED: 44 of 81 failing across channel, renderer and wiring tests; mobile contract test 2 failing with only the mirror updated. GREEN: focused API tests 99 passed. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1169 passed, 20 skipped, 0 failures (parent run). Mobile: `npm test` 92 suites, 1438 passed, 1 skipped; `npm run typecheck` ok; `npm run lint` ok with the 4 baseline warnings (parent run). | high (`hot_path`, auth types); consent granted; four lenses approved and acknowledged, lineage `review-7d6bd5c476fc1cae`. Reviewed boundary: `eaa2b6f`. Advisory findings accepted into T4: malformed client dates must reply `invalid_date` instead of `unknown_error`, the `serialize_reason/1` comment must state how events and replies differ, and one table-driven mobile test covers the pass-through of the new codes. Not accepted here: a compatibility window for the old `reason` reply (the mobile app has no channel client yet and is the only client); the duplicated mobile allowlists and the `AuthErrorCode` name (pre-existing structure, follow-up). |
| T4 | `31c6dd8` `feat(api): speak camelCase on the planning channel` (includes the T3 review follow-ups on the channel) | RED: channel tests 57 of 63 failing. GREEN: 63 passed. Writer mutation checks: an event removed from the intercept list fails 2 tests, a no-op `handle_out/3` fails 15, no inbound normalization fails 7. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1185 passed, 20 skipped, 0 failures (parent run). | medium, `slice_budget_reached`; consent granted; one lens (reliability) approved and acknowledged, lineage `review-11047b5172e07588`. Reviewed boundary: `f6593df`. Six advisory findings, none blocking, recorded below as follow-ups. |
| T3b | `f6593df` `test(mobile): cover the pass-through of the planning channel codes` | Characterization test, no RED; mutation check by the writer (removing `lost_lock` from `errors.ts` fails 1 test). `npm test` 92 suites, 1468 passed, 1 skipped (parent run); `npm run typecheck` ok; `npm run lint` ok with the 4 baseline warnings (writer run). | reviewed with T4 |

## Notes and follow-ups

- T2: `cross_account_isolation_test.exs` reads product responses; five key reads were renamed by the parent (two of them feed `refute`s that would otherwise pass vacuously).
- T2: `POST /planning/confirm` now stores the client `meals` in `proposal_json` after normalization (snake_case keys).
- T2: the opaque key list is repeated in `test/support/casing_assertions.ex`; keep it in step with `Casing`.
- Follow-up (not in this ticket): `apps/api/frontend_integration_guide.md` and `apps/api/docs/FRONTEND_INTEGRATION.md` still show snake_case response keys for the product routes; the shopping channel still pushes snake_case; flat HTTP error bodies on the product controllers.
- T3: 29 channel codes were added to `ApiError` and to the mobile allowlist (55 codes on mobile): the 17 literal reasons plus 12 traced from the services (`not_a_member`, `missing_lock`, `lost_lock`, `terminal_lock`, `transaction_failed`, `already_active`, `invalid_identity`, `invalid_date`, `invalid_date_range`, `optimization_failed`, `optimizer_unavailable`, `optimizer_timeout`).
- T3: a changeset keeps replying `invalid_payload` (client validation failure); every other non-atom, non-string reason replies `unknown_error` and is logged.
- T3: allowlisting `not_found` on mobile changes one mobile behaviour: a `not_found` envelope is no longer collapsed to `unknown_error` (`onboardingService.test.ts` expectation updated by the parent).
- T3: the skipped mobile contract scanner matches the literal `error(:code)` only, so it does not see codes the channel resolves at runtime through `ApiError.envelope/1`. Ticket #10 owns un-skipping it.
- Follow-up (pre-existing, not in this ticket): `:invalid_format` from `Date.from_iso8601/1` in `planning_chat_service.ex` now replies `unknown_error`; cold-start `generate_menu` fails in every environment, not only in tests, with `{:invalid_child_spec, _}` (previously masked as `invalid_payload`): `MealPlannerApi.Generation.Supervisor` is a plain `Supervisor` and `Generation.Server.start_and_call/4` calls `DynamicSupervisor.start_child/2` on it (`generation/server.ex:221`). Fixed by pull request #67 (`fix/planning-channel-failure-paths`), stacked on this branch; `send_message` crashes the channel on a non-UUID `session_id` or when the intent atomizer returns a bare `:error`.
- T4: the 13 outbound events of `planning:<account_id>` are intercepted and camelized in `handle_out/3`. Encoding now happens in each channel process instead of the broadcaster, so a payload that cannot be encoded would crash the channel instead of raising in `Generation.Server`; no such payload is reachable today.
- T4: the drift guard compares the intercept list with the event literals passed to `*broadcast*` calls in every `lib` file that spells `"planning:`. It cannot see an event name that is not a literal, a broadcaster that never spells the topic prefix, or a broadcast through a function with another name.
- T4: a malformed client date (`:invalid_format`) replies `invalid_date`, mapped at the channel edge; the service is unchanged.
- T4: the 100 ms `assert_reply` in the confirm end-to-end channel test failed once in about 85 looped runs of the writer (timeout unchanged by this feature).
- Follow-up (not in this ticket): `apps/api/docs/CHANNELS.md` documents planning events and payloads that do not exist; only the casing and error subsection was added and the keys of the listed outgoing events re-spelled. The moduledoc of `planning_channel.ex` still says the server broadcasts to `channel_pid`.
- Follow-up from the T4 review (advisory, not blocking): a real command pushed with a non-map payload still crashes the channel as it did before this feature (only the unknown-event path is tested); the drift guard does not check which topic a broadcast targets; `handle_out/3` has no test of an unencodable payload; the confirm end-to-end test uses the default 100 ms reply timeout and now runs once per casing; `:invalid_format` maps to `invalid_date` for every command, proved only for `swap_constraints`; the mobile pass-through test extracts the codes from `api_error.ex` with a regex tied to a comment and to indentation.

## Delivery record

- 2026-10-08: the stack was rebased onto `main` at `9b057b8` (after #58, #60 and #61 merged) before the first push. Commit identities changed: T1 `08c2fde` is now `56cffc7`, T2 `47db472` is `4220efb`, T2b `da70520` is `e99bf3b`, T3 `eaa2b6f` is `8f8ef75`, T4 `31c6dd8` is `b4a7fe5`, T3b `f6593df` is `9e140f6`. The native reviews recorded above ran on the pre-rebase commits.
- The rebase had one conflict, in T3: ticket #10 made `apps/mobile/src/api/errors.ts` the single source of the mobile allowlist and messages and un-skipped the contract test. Resolution: the duplicated list in `authService.ts` and the mirror in `authErrorCodeContract.test.ts` are gone (main wins); the 29 channel codes live only in `errors.ts` and in the `AuthErrorCode` union. The earlier notes about a second mobile copy and a skipped contract test no longer apply.
- Checks after the rebase (parent run): tip `mix test` 1203 passed, 20 skipped, 0 failures; `mix format --check-formatted` and `mix compile --warnings-as-errors` ok; mobile `npm test` 92 suites, 1471 passed; typecheck and lint ok. T3 head on its own: `mix test` 1187 passed, 20 skipped; mobile 1441 passed; typecheck ok.
- Slices, stacked to main, each pull request based on the previous branch: S1 `feat/mobile-casing-transform` (T1), S2 `feat/mobile-casing-http` (T2, T2b), S3 `feat/mobile-channel-envelope` (T3), S4 `feat/mobile-channel-casing` (T4, T3b, this document).
- Every slice is above the 400-line review budget after one slicing pass; tests are most of each diff. Recommended as `size:exception`.
- Pull requests opened: #63 (S1), #64 (S2), #65 (S3), #66 (S4). Review follow-ups applied after they were opened, from advisory findings, none blocking:
  - #64, `5e5360a` `fix(api): keep the body over the query string when the casing differs`: `conn.params` arrives already merged, so a param sent as `recipe_id` in the query string and as `recipeId` in the body was two keys in it and the snake_case one won. The plug now merges the query string, the body and the path params again after the rewrite, in that order, so the body keeps precedence over the query string. Two plug tests added. Merged forward into #65 and #66.
  - #66, ordering: the intercept changed when the commanding socket receives an event the channel process broadcasts while it handles a command. Phoenix sends an intercepted broadcast to the channel process (`deps/phoenix/lib/phoenix/channel/server.ex`, `dispatch/3`), so the event now follows the reply; before the intercept it was fastlaned and preceded it. Events from other processes have no ordering relation to a reply. Recorded as an "Ordering" note in `apps/api/docs/CHANNELS.md` and pinned by `planning_channel_ordering_test.exs` (`cancel_planning` and `session_cancelled`, reply and push read from the test mailbox in arrival order). Characterization test, no RED; sensitivity check: with `session_cancelled` out of the intercept list the test fails on the order. 40 looped runs of the file, 0 failures.
  - #66, documentation: the `start_planning` and `cancel_planning` rows and the `start_planning` example of `CHANNELS.md` now show what the command clauses read (`range_from`, `range_to`, `session_id`) instead of contradicting the camelCase example; section 8.3 of `apps/api/frontend_integration_guide.md` shows camelCase event keys and the error envelope of the reply; the comment of the `generate_menu` error branch in `planning_channel.ex` no longer says that event payloads are left as they are (the keys are camelized, the `reason` field stays). The other sections of the guide and the planning commands and events that `CHANNELS.md` lists but the code does not have remain follow-ups.
  - #66, attribution: the note above on cold-start `generate_menu` blamed the test environment; it fails in every environment and is fixed by #67. The comment of the cold-start test in `planning_channel_test.exs` ("No generation server can be started in this setup") carries the same misattribution and is left for #67, which rewrites that test.


