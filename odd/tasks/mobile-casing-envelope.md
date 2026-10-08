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
- Output keys are strings. Atom and string keys are both accepted.
- A key is only rewritten when it is an identifier in the source casing: snake_case identifier for `camelize_keys/1`, camelCase identifier for `snake_keys/1`. Anything else (dates, UUIDs, numeric strings, keys with dashes or spaces, non-binary keys) is left as is. Both functions are idempotent.
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
- [ ] **T2 HTTP opt-in pipeline.** `MobileCasing` plug, `:mobile_casing` pipeline, product scope and `/me` wired, product controller tests updated to camelCase requests and responses. Route: delegated (plug, router, about ten test files).
- [ ] **T3 Channel error envelope.** `ApiError.envelope/1`, channel codes added to the API allowlist and to the mobile allowlist in lockstep, command and join error replies converted, channel tests updated. Route: delegated (API and mobile files).
- [ ] **T4 Channel casing.** Inbound normalization, camelCase ok replies, `intercept` plus `handle_out/3` for every outbound event, tests asserting pushes. `apps/api/docs/CHANNELS.md` planning section updated for the envelope and casing. Route: delegated.

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
- Running count: 550 after T1 (module 141, tests 409; the two-direction test matrix accounts for the overage).

## Progress

T1 done. Next step: T2. Local test runs need `MYFOOD_TEST_DB_USERNAME=<local role>` and an empty `MYFOOD_TEST_DB_PASSWORD` next to `MYFOOD_TEST_DATABASE`. Baseline suite on `507e107`: 1081 passed, 20 skipped, 0 failures.

| Task | Commit | Checks | Review |
|------|--------|--------|--------|
| T1 | `feat(api): add key casing transform for the mobile contract` | RED 31/31 failing (module missing), then 7 failing on the one-level opaque rule; GREEN 35 passed. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1116 passed, 20 skipped, 0 failures. Parent spot check: casing tests 35 passed. | pending assessment |
