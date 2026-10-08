# Feature: mobile socket client and planning topic join (P2)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/24 (label `ready-for-agent`, part of spec #3, blockers #9 and #11 closed).
Branch: `claude/issue-24-99279a` (from `main` at `f4b849d`).

## Objective

The mobile app opens a Phoenix socket with the Device session's access token, joins `planning:<accountId>`, reconnects after a token refresh, and shows the envelope reason when a join is refused.

## Problem

The app has no socket client: `phoenix` is not a dependency and nothing notifies the app when tokens rotate. On the API, a refused planning join replies `forbidden` or `subscription_required`; the spec asks for `unauthenticated`, `forbidden` or `trial_expired`, and the HTTP capability plug already replies `trial_expired` for the same predicate.

## Scope and constraints

- Engine off-limits: Planning candidate builder, Optimizer port and fallback, Generation run server internals, Planning session server internals.
- Touched: the planning channel `join/3` and its tests, channel docs, the mobile client.
- Only the planning topic is joined; the calendar topic is not.
- `MealPlannerApiWeb.ChannelCapability` is shared by the calendar, AI and shopping channels and keeps its return value; the planning join maps it.
- `UserSocket.connect/3` keeps returning a bare `:error`. The app cannot read a reason from a refused WebSocket upgrade, so the wrapper treats a failure before the socket ever opened as an auth rejection candidate.
- Open PR #67 (`fix/planning-channel-failure-paths`) rewrites the command handlers and about 285 lines of `planning_channel_test.exs`; it does not touch `join/3`. Keep test edits inside the join `describe` blocks to limit the conflict.
- RDD is on (global). Review candidate is each work-unit commit, assessed with `--base-ref <last reviewed boundary> --committed-only`. First boundary: `f4b849d`.

## Design

### API: planning join refusals

`PlanningChannel.join/3` replies the `ApiError` envelope with:

| Condition | Code |
| --- | --- |
| The socket carries no identity, or its access token has expired since connect (`claims["exp"]` in the past) | `unauthenticated` |
| No Membership resolves, the Membership belongs to another Account, or it is not `active` | `forbidden` |
| `ChannelCapability.authorize/1` denies (enforcement flag on, Account not eligible) | `trial_expired` |

Rationale for `unauthenticated`: connect already rejects an invalid token, so the only join-time authentication failure is a socket that outlived its access token (1 hour TTL). The code is the app's cue to refresh and reconnect.

The `start_planning` and confirm capability re-checks keep replying `subscription_required` (out of scope, follow-up).

### Mobile: one socket module

`apps/mobile/src/api/socket/`, the only importer of `phoenix` (enforced by ESLint `no-restricted-imports`).

- Connect: URL derived from `EXPO_PUBLIC_API_URL` (`http` to `ws`, `/socket`), `params` is a function returning `{ token }` so every (re)connect sends the current access token.
- Rejected connect: the first error of a failure streak before the socket opened triggers `refreshTokens()` (single-flight, Auth A4). On success the socket reconnects with the new token. On a session-invalid refresh the socket stops and reports `unauthenticated`. On a network failure Phoenix's backoff keeps retrying. One refresh per streak; the streak resets on open.
- Re-auth after refresh: the token store notifies subscribers when tokens are persisted or cleared. A new access token makes an open socket reconnect, and Phoenix rejoins the joined topics. A cleared session disconnects.
- Join: `joinTopic(topic, handlers)`. A refused join is parsed with `errorFromEnvelope` into an `ApiError`. `unauthenticated` triggers one refresh and reconnect; any other code leaves the channel (no rejoin loop) and is handed to `onRefused`.
- Tested against a fake socket injected through a factory.

### Mobile: planner

`usePlanningTopic()` in `src/features/planner` joins `planning:<me.account.id>` while the screen is mounted and exposes the refusal. `PlannerScreen` shows the reason with the existing error copy.

## Tasks

- [x] T1 API: planning join replies `unauthenticated`, `forbidden` or `trial_expired`; join tests cover the three refusals; `CHANNELS.md` join section updated. Route: delegated (reading prepares the write; code, tests and docs).
- [ ] T2 Mobile: token-change subscription in the token store, `phoenix` dependency, socket module with connect, auth param, join, reconnect and re-auth, ESLint restriction, fake-socket tests. Route: delegated (several non-trivial files).
- [ ] T3 Mobile: `usePlanningTopic` and the refusal reason on `PlannerScreen`, with a test. Route: delegated (several non-trivial files).

## Acceptance criteria

- One mobile module owns connect, auth param, join, reconnect and re-auth after refresh; nothing else imports the Phoenix client directly.
- A rejected connect triggers a refresh and a reconnect without user action.
- Join is refused server-side without an active Membership or when capability enforcement denies, as an envelope with `unauthenticated`, `forbidden` or `trial_expired`.
- Socket wrapper tested against a fake socket; channel join tests cover the three refusals.

## Checks

- API (from `apps/api`, `MYFOOD_TEST_DATABASE=meal_planner_api_test_issue24`): `mix test test/meal_planner_api_web/channels/planning_channel_test.exs test/meal_planner_api_web/user_socket_test.exs test/meal_planner_api_web/channels`, `mix format --check-formatted`.
- Mobile (from `apps/mobile`): `npm test`, `npm run typecheck`, `npm run lint`.

## Delivery

Forecast: about 700 authored changed lines (API about 120, socket module about 430, planner about 150), above the 400-line budget. Strategy `ask-on-risk`: the chain strategy is asked before any pull request is opened. Work units are committed so either slicing works: T1, T2, T3.

## Progress

- T1 done, commit `4818f68`. RED: 8 of 19 join tests failed before the change (expired token joined, capability denial replied `subscription_required`). GREEN: `mix test test/meal_planner_api_web/channels test/meal_planner_api_web/user_socket_test.exs` 149 passed; `mix format --check-formatted` clean; `mix compile --warnings-as-errors` clean on Elixir 1.20.3.
  - `join/3` is a `with` over `check_authenticated/1`, `fetch_active_membership/2` and `check_join_capability/1`. The token check runs before the Membership lookup.
  - Expiry is `exp <= now`, one second stricter than Guardian (`exp >= now` is still valid there). Kept: the effect is one early refresh, and the boundary test stays deterministic.
  - A token without an integer `exp` is not treated as expired.
  - Local Postgres has no `postgres` role: API test commands also need `MYFOOD_TEST_DB_USERNAME=luccagiordana`.

Next: T2.
