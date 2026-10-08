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
- Re-auth after refresh: the token store notifies subscribers when tokens are persisted or cleared. A new access token makes an open socket reconnect, and Phoenix rejoins the joined topics. A cleared session closes the socket and leaves the client dormant (still subscribed) until the next token; only `disconnect()` ends it.
- Join: `joinTopic(topic, handlers)`. A refused join is parsed with `errorFromEnvelope` into an `ApiError`. `unauthenticated` triggers one refresh and reconnect; any other code leaves the channel (no rejoin loop) and is handed to `onRefused`.
- Tested against a fake socket injected through a factory.

### Mobile: planner

`usePlanningTopic()` in `src/features/planner` joins `planning:<me.account.id>` while the screen is mounted and exposes the refusal. `PlannerScreen` shows the reason with the existing error copy.

## Tasks

- [x] T1 API: planning join replies `unauthenticated`, `forbidden` or `trial_expired`; join tests cover the three refusals; `CHANNELS.md` join section updated. Route: delegated (reading prepares the write; code, tests and docs).
- [x] T2 Mobile: token-change subscription in the token store, `phoenix` dependency, socket module with connect, auth param, join, reconnect and re-auth, ESLint restriction, fake-socket tests. Route: delegated (several non-trivial files).
- [x] T3 Mobile: `usePlanningTopic` and the refusal reason on `PlannerScreen`, with a test. Route: delegated (several non-trivial files).

## Acceptance criteria

- One mobile module owns connect, auth param, join, reconnect and re-auth after refresh; nothing else imports the Phoenix client directly.
- A rejected connect triggers a refresh and a reconnect without user action.
- Join is refused server-side without an active Membership or when capability enforcement denies, as an envelope with `unauthenticated`, `forbidden` or `trial_expired`.
- Socket wrapper tested against a fake socket; channel join tests cover the three refusals.

## Checks

- API (from `apps/api`, `MYFOOD_TEST_DATABASE=meal_planner_api_test_issue24`): `mix test test/meal_planner_api_web/channels/planning_channel_test.exs test/meal_planner_api_web/user_socket_test.exs test/meal_planner_api_web/channels`, `mix format --check-formatted`.
- Mobile (from `apps/mobile`): `npm test`, `npm run typecheck`, `npm run lint`.

## Delivery

Forecast: about 700 authored changed lines (API about 120, socket module about 430, planner about 150), above the 400-line budget. Actual: about 3,630 (insertions plus deletions summed per commit, lockfile and this document excluded; most of it is tests). Strategy `ask-on-risk`: the chain strategy is asked before any pull request is opened. Work units are committed so either slicing works:

| Slice | Commits | Authored lines |
| --- | --- | --- |
| API join refusals | `4818f68` | 227 |
| Token subscription and socket URL | `f6d548f`, `18d17c8` | 239 |
| Socket module | `57b57b9`, `89a08a2`, `c5e77f2` | 2,692 |
| Planner join and notice | `7ff1b93`, `ec462dd` | 471 |

Chain strategy chosen by the user (2026-10-08): stacked pull requests to `main`, one per slice in the order of the table, each branch built on the previous one. The socket slice cannot be cut further without separating the wrapper from the tests that pin its races (about 1,900 of its lines are tests and the fake socket), so it carries a `size:exception` recommendation.

## Progress

- T1 done, commit `4818f68`. RED: 8 of 19 join tests failed before the change (expired token joined, capability denial replied `subscription_required`). GREEN: `mix test test/meal_planner_api_web/channels test/meal_planner_api_web/user_socket_test.exs` 149 passed; `mix format --check-formatted` clean; `mix compile --warnings-as-errors` clean on Elixir 1.20.3.
  - `join/3` is a `with` over `check_authenticated/1`, `fetch_active_membership/2` and `check_join_capability/1`. The token check runs before the Membership lookup.
  - Expiry is `exp <= now`, one second stricter than Guardian (`exp >= now` is still valid there). Kept: the effect is one early refresh, and the boundary test stays deterministic.
  - A token without an integer `exp` is not treated as expired.
  - Local Postgres has no `postgres` role: API test commands also need `MYFOOD_TEST_DB_USERNAME=luccagiordana`.

- T2 done, commits `f6d548f` (token-change subscription, socket URL) and `57b57b9` (socket module, `phoenix` ~1.8.9, `@types/phoenix`, ESLint restriction). RED: 11 tests failed on the missing `subscribeToAccessToken` and `getSocketUrl`; the socket suite could not load its module (weak RED, compensated with mutation checks on every guard). GREEN: `npm test -- --ci` 97 suites, 1549 tests; `npm run typecheck` clean; `npm run lint` 0 errors (4 warnings on the base).
  - Public surface (`@/api/socket`): `getSocketClient()`, `planningTopic(accountId)`, `SocketClient` with `connect`, `disconnect`, `joinTopic`, `getStatus`, `subscribeToStatus`. `createSocketClient(deps)` takes the socket factory, so tests inject `createFakeSocket` from `src/api/socket/testing/fakeSocket.ts`.
  - Phoenix facts the wrapper relies on, verified in `node_modules/phoenix` 1.8.15: `params` is called on every connection attempt; `connect()` during a pending `disconnect()` is unsafe, so the wrapper reconnects only from the `disconnect` callback; a refused channel rejoins on a timer until `leave()`.
  - `socketClient.phoenix.test.ts` runs the wrapper on the real Phoenix `Socket` over a scripted transport, to catch a semantic change on a `phoenix` upgrade.
  - Accepted change to the design: a refresh that fails on the network does not spend the streak (a phone that was offline with an expired token would otherwise never refresh on its own).
- Review of T1 and T2 (range `f4b849d..57b57b9`, medium, lens `review-reliability`): consent granted, approved, acknowledged. Reviewed boundary: `57b57b9`. Four advisory findings, all fixed in commit `89a08a2`:
  - Refresh retries during an outage are bounded by a cool-down (5 s doubling to 60 s), reset on open and on stop. Worst case after the network returns: about 65 s before the socket refreshes on its own; an authenticated HTTP call in that window refreshes and reconnects at once.
  - Refresh outcomes and stored-token reads are tied to the client run that started them, so one that outlives a `disconnect()` changes nothing in the next run. Exception: a session-invalid refresh still reports `unauthenticated` when the cleared session itself ended the run.
  - Test suites delete `EXPO_PUBLIC_API_URL` when it was unset instead of assigning `undefined`.
  - Checks after the fix: `npm test -- --ci` 97 suites, 1562 tests; typecheck and lint clean.
- T3 done, commit `7ff1b93`. RED: 15 of the new tests failed against inert stubs. GREEN: `npm test -- --ci` 98 suites, 1578 tests; typecheck clean; lint 0 errors.
  - `usePlanningTopic()` returns `idle` (no Account), `joining`, `joined` or `refused` with the `ApiError`. It connects the app socket, joins `planning:<me.account.id>`, leaves on unmount and never disconnects the socket.
  - `PlanningJoinNotice` renders `getAuthErrorMessage(error)` inline under the header, themed with `colorLight` and `textDark`.

- Review of the fixes and T3 (range `57b57b9..1329884`, medium, lens `review-reliability`): consent granted, approved, acknowledged. Reviewed boundary: `1329884`. Four advisory findings, not fixed, listed under follow-ups. One is answered by existing code: two socket runs cannot send overlapping rotations, because `refreshTokens` in `src/api/authRefresh.ts` is single-flight per refresh token.

- Review of the whole branch (range `f4b849d..eda31a1`, medium, lens `review-reliability`, asked by the stop hook): consent granted, approved, acknowledged. Four advisory findings, fixed at the user's request in commits `18d17c8`, `c5e77f2` and `ec462dd`:
  - A refresh that fails on the network no longer refuses a topic: the channel stays alive, Phoenix keeps rejoining and a later `unauthenticated` refusal asks again. Rejected connects and refused joins share one refresh budget and one cool-down.
  - A streak may refresh again 10 minutes after a successful refresh (`REFRESH_HOLD_AFTER_SUCCESS_MS`), so a socket that keeps failing never sends an expired token; at most six rotations an hour during a WebSocket-only outage.
  - `connect()` means "stay connected whenever a session exists": a cleared session, an invalid session or a start without a stored token leaves the client dormant, and the next announced token reopens the socket and rejoins the topics. `connect()` never rejects. The planner hook needed no behaviour change; a test covers a session that arrives after mount.
  - `clearSession` always announces `null`, and `persistTokens` announces the access token once its own write succeeded, even when a later storage call throws.
  - Checks after the fix: `npm test -- --ci` 98 suites, 1598 tests; typecheck clean; lint 0 errors.
  - Known effects: a topic refused after a session-invalid refresh stays left until the hook remounts; during a refresh outage the hook reads `joining` (there is no retrying state); a failed socket open is swallowed silently.

## Follow-ups (not in this ticket)

The first two were raised before the last fix round and were not re-verified after it.

- Socket status after an invalid session across runs: when a refresh is pending, the client is disconnected and connected again, and the refresh then finds the session invalid, the client ends `disconnected` instead of `unauthenticated` (`socketClient.ts`, the superseded branch). No consumer reads the status yet.
- A superseded join refresh resets the topic's refresh mark unconditionally and can allow one extra refresh on the same connection (`socketClient.ts`, join `superseded` continuation).

- `start_planning` and confirm still reply `subscription_required` for the rule the join now names `trial_expired`.
- The access token travels as a connect param, so it is part of the WebSocket URL. Phoenix 1.8 can send it as `authToken` (a subprotocol header) if `UserSocket` reads `connect_info: [:auth_token]`.
- `UserSocket.connect/3` refuses with no reason, so the app cannot tell a rejected token from an unreachable server. A socket `error_handler` would let the wrapper skip the refresh on network failures.
- `AuthContext` does not learn about a refresh or a cleared session triggered outside it (HTTP client or socket), so a session ended by the socket does not route to sign-in by itself.
- The hook does not follow the socket status: after `joined`, a dropped connection reads `joined` until the next reply.
- The socket client's `onJoined` is not guarded by its `left` flag; the hook guards it.
- If a connection takes longer than about 1.5 s to close, Phoenix detaches its handlers without marking channels errored and a joined topic may not rejoin (not fixable through the public API).
- Not run on a device or under Metro; `phoenix` bundling is unverified outside jest.
- Merge with PR #67 will conflict in `planning_channel_test.exs` (join blocks only on this side).

A last whole-branch review runs on the head that carries this document (the fix commits are part of it). Its outcome is reported in the pull requests, because a commit after it would change the reviewed candidate.

Next: open the four stacked pull requests; merge stays with the user.
