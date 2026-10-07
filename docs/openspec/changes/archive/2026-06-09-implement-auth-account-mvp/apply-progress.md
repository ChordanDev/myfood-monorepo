# Apply Progress: implement-auth-account-mvp

## Current status

- `changeName`: `implement-auth-account-mvp`
- `phase`: `apply`
- `artifactStore`: `openspec`
- `deliveryPath`: `auto-chain`
- `chainStrategy`: `stacked-to-main`
- `mode`: `Strict TDD`
- `status`: Slice 1 apply work complete after post-verify blocker remediation; ready for formal `sdd-verify` re-run before archive.

This file is cumulative. Stale intermediate "Remaining tasks" snapshots were removed because `tasks.md` is the authoritative checkbox state.

## Workload / PR boundary

- Full Slice 1 was delivered as stacked backend work units:
  1. Account graph schema and access calculation.
  2. Email-code request/verify primitives.
  3. Sessions, tokens, refresh, and logout.
  4. JSON API routes, controllers, plugs, and `/me`.
- Frontend implementation remains out of scope for this backend Slice 1 change.
- Frontend readiness was limited to a shared-doc pointer and evidence inspection of existing `/api/me` gating consumers.

## Completed tasks and persisted checkbox updates

`openspec/changes/implement-auth-account-mvp/tasks.md` is fully checked for Slice 1 apply readiness:

- Backend Work Units 1–4 RED, GREEN, TRIANGULATE, and verification tasks are complete.
- Backend acceptance mapping, full `mix test`, and `mix precommit` tasks are complete.
- Frontend contract pointer task is complete via `../my-expo-app/docs/SHARED_DOCS.md`.
- Frontend consumer confirmation is complete by inspection:
  - `../my-expo-app/src/services/authService.ts` loads `/api/me` through `getMe()` and refresh/restore flows.
  - `../my-expo-app/src/features/auth/context/AuthContext.tsx` derives `canUseApp`, `accessReason`, and `isTrialExpired` from `me.account.access`.
  - `../my-expo-app/app/index.tsx` routes authenticated locked users to `TrialExpiredScreen` and only redirects to tabs when `canUseApp` is true.
  - `../my-expo-app/app/(tabs)/_layout.tsx` blocks direct tab access when `!isAuthenticated || !canUseApp`.
- Final acceptance checklist is complete for apply. Formal verification remains intentionally uncreated until `sdd-verify`.

## Files changed across apply

Backend (`../my_food_back`):

- `lib/my_food_back/accounts.ex`
- `lib/my_food_back/accounts/user.ex`
- `lib/my_food_back/accounts/account.ex`
- `lib/my_food_back/accounts/membership.ex`
- `lib/my_food_back/auth.ex`
- `lib/my_food_back/auth/email_code.ex`
- `lib/my_food_back/auth/session.ex`
- `lib/my_food_back/auth/tokens.ex`
- `lib/my_food_back/email_delivery.ex`
- `lib/my_food_back/rate_limits.ex`
- `lib/my_food_back/rate_limits/event.ex`
- `lib/my_food_back_web/router.ex`
- `lib/my_food_back_web/controllers/auth_controller.ex`
- `lib/my_food_back_web/controllers/auth_json.ex`
- `lib/my_food_back_web/controllers/me_controller.ex`
- `lib/my_food_back_web/controllers/me_json.ex`
- `lib/my_food_back_web/plugs/authenticate_session.ex`
- `lib/my_food_back_web/plugs/require_unlocked_account.ex`
- `priv/repo/migrations/20260607201017_create_account_graph.exs`
- `priv/repo/migrations/20260607232722_create_email_codes.exs`
- `priv/repo/migrations/20260607232723_create_rate_limit_events.exs`
- `priv/repo/migrations/20260608000144_create_sessions.exs`
- `test/my_food_back/accounts_test.exs`
- `test/my_food_back/auth/email_code_test.exs`
- `test/my_food_back/auth/session_test.exs`
- `test/my_food_back_web/controllers/auth_controller_test.exs`
- `test/my_food_back_web/controllers/me_controller_test.exs`

Frontend pointer/evidence (`../my-expo-app`):

- `docs/SHARED_DOCS.md` — added the exact OpenSpec Slice 1 contract pointer.
- `src/services/authService.ts` — inspected as evidence for `/api/me` consumption; not edited.
- `src/features/auth/context/AuthContext.tsx` — inspected as evidence for `canUseApp` and `trial_expired` derivation; not edited.
- `app/index.tsx` and `app/(tabs)/_layout.tsx` — inspected as evidence for access gating; not edited.

OpenSpec:

- `openspec/changes/implement-auth-account-mvp/tasks.md`
- `openspec/changes/implement-auth-account-mvp/apply-progress.md`

## TDD Cycle Evidence

| Cycle | Layer | RED | GREEN | TRIANGULATE | REFACTOR / VERIFY |
| ----- | ----- | --- | ----- | ----------- | ----------------- |
| WU1 — Account graph | Context | `mix test test/my_food_back/accounts_test.exs` failed as expected before schemas/context existed. | Focused account tests passed: `5 tests, 0 failures`. | Access boundary and subscription override cases covered. | `mix format`, focused tests, and then full backend suite passed: `7 tests, 0 failures`. |
| WU2 — Email codes | Context | `mix test test/my_food_back/auth/email_code_test.exs` failed as expected before email-code implementation existed. | Focused email-code suite passed: `10 tests, 0 failures`. | Signup/login flow sharing, invalidation, cooldown, attempts, and rate-limit cases covered. | `mix format`, focused tests, full backend suite, and `mix precommit` passed: `19 tests, 0 failures`. |
| WU3 — Sessions/tokens | Context | `mix test test/my_food_back/auth/session_test.exs` failed as expected before session primitives existed. | Focused session suite passed after adding sessions/tokens/refresh/logout. | Second-device preservation, rotation/replay rejection, revoked/expired refresh rejection, and locked-account login covered. | Focused auth suites passed: `16 tests, 0 failures`; full suite and `mix precommit` passed: `25 tests, 0 failures`. |
| WU4 — API + `/me` | Controller/integration | Controller tests failed with `404 Not Found` before routes/controllers/plugs existed. | Controller suites passed: `11 tests, 0 failures`. | Endpoint-level `code_expired`, `too_many_attempts`, and `rate_limited` coverage added; focused suites passed: `12 tests, 0 failures`. | Full backend suite and `mix precommit` passed: `40 tests, 0 failures`. |
| Docs cleanup — frontend pointer/readiness | Documentation/evidence inspection | N/A — docs-only cleanup; no production behavior added. | N/A — no code edited. | N/A — evidence inspection confirmed existing frontend consumers already use the Slice 1 gate. | No tests run because only docs changed and frontend files were inspection-only. |

## Acceptance mapping

- Explicit Signup Code Request: covered by backend context/controller tests for normalized email, hashed code storage, no User creation on request, success envelope, duplicate signup, cooldown, and rate limiting.
- Signup Code Verification Creates User Account And Session: covered by backend tests asserting User, Individual Account, owner Membership, Trial Period, device session, tokens, and `me.account.access.canUseApp: true`.
- Explicit Login Code Request: covered by backend tests for existing-user login code requests and `email_not_found` for unknown email.
- Login Code Verification Creates Device Session: covered by second-device login tests preserving the first active session.
- Email Code Security Rules: covered by backend tests for 6-digit delivery, 10-minute expiry, 5-attempt cap, new-code invalidation, per-flow isolation, cooldown, stable `rate_limited`, and hashed persisted identifiers.
- Session Refresh And Logout: covered by refresh rotation, old/revoked/expired token rejection, replay rejection, and current-device logout tests.
- Current User Contract: covered by `/api/me` controller tests for user, account, membership, onboarding, access state, camelCase fields, and omitted full preferences.
- Trial Gate Access Semantics: covered by active-trial, exact-boundary/expired-trial lock, active subscription override, and locked-account-login tests.
- Protected App Data Gate: backend `RequireUnlockedAccount` plug exists for future app-data routes, and frontend evidence confirms internal app loading is gated by `/api/me` `account.access.canUseApp`.
- Standard Error Response Contract: covered by endpoint-level tests for stable `error.code` values.

## Deviations from design

- Work Unit 1 used explicit `now` arguments instead of a separate `Clock` module, which was an allowed deterministic time option.
- No Work Unit 1 fixture module was added because tests used `DataCase` directly.
- UUID primary keys were used for new account graph tables, following the design recommendation where no project standard was fixed.
- Work Unit 2 used Swoosh test assertions rather than a separate fake email adapter module.
- Work Unit 2 persisted request-code rate limits by email/IP/device and enforced per-code verification attempts; additional rolling verify-code IP/device limits can be hardened later.
- Work Unit 3 refresh rotation creates a new session row linked by `rotated_from_id` and revokes the old row instead of replacing the token hash in place.
- Work Unit 4 authenticated logout also accepts the submitted `refreshToken` body to reuse the existing lower-level `Auth.logout/2` primitive.

## Checks

- Prior backend apply evidence recorded `cd ../my_food_back && mix test` passing.
- Prior backend apply evidence recorded `cd ../my_food_back && mix precommit` passing.
- Earlier docs cleanup did not edit backend or frontend production/test code. The 2026-06-09 remediation below did edit backend auth/email delivery code and reran backend checks.

## Post-verify blocker remediation — 2026-06-09

### Scope

- Fixed the formal verify blocker where verify-code flows had per-code attempt caps but no rolling email/IP/device `rate_limited` enforcement.
- Audited email delivery against the Slice 1 design. Slice 1 requires a Swoosh-backed abstraction with local/test adapters and configurable production delivery; a specific production provider remains out of scope.
- Added a local proof path for sending verification codes through the development Swoosh mailbox.

### Files changed in this remediation

Backend (`../my_food_back`):

- `lib/my_food_back/auth.ex` — verify-code now checks and records rolling `verify_code` rate-limit events before consuming a code.
- `lib/my_food_back/rate_limits.ex` — added verify-code limits for email/IP/device scopes using existing hashed persisted events.
- `test/my_food_back/auth/email_code_test.exs` — added RED-first tests for verify-code event recording plus email/device `rate_limited` behavior.
- `lib/my_food_back/email_delivery.ex` — uses configured sender identity and English email-code copy.
- `lib/my_food_back_web/router.ex` and `config/dev.exs` — expose the Swoosh local mailbox at `/dev/mailbox` in development only.
- `README.md` — documents how to prove local email-code sending and which SMTP env vars configure real delivery.

OpenSpec:

- `openspec/changes/implement-auth-account-mvp/tasks.md`
- `openspec/changes/implement-auth-account-mvp/apply-progress.md`
- `openspec/changes/implement-auth-account-mvp/verify-report.md`

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| Verify-code rolling rate limit | `test/my_food_back/auth/email_code_test.exs` | Context/unit with Ecto | ✅ Existing focused suite: `12 tests, 0 failures` | ✅ Added tests failed: missing verify event recording and missing `rate_limited` behavior | ✅ Focused suite passed: `15 tests, 0 failures` | ✅ Email and device exceeded-limit cases plus event-recording case | ✅ `mix format`; focused auth controller/context suite passed: `27 tests, 0 failures` |
| Email sending proof path | `test/my_food_back/auth/email_code_test.exs` | Context/unit with Swoosh test adapter | ✅ Same focused suite baseline | ✅ Sender/copy expectation failed against old Spanish copy | ✅ Focused suite passed after configured sender + English copy | ✅ Existing Swoosh assertion continues proving dispatch with a six-digit code | ✅ Local mailbox route/docs only; no provider secrets committed |

### Checks after remediation

- `cd ../my_food_back && mix test test/my_food_back/auth/email_code_test.exs` → `15 tests, 0 failures`.
- `cd ../my_food_back && mix test test/my_food_back/auth/email_code_test.exs test/my_food_back_web/controllers/auth_controller_test.exs` → `27 tests, 0 failures`.
- `cd ../my_food_back && mix test` → `47 tests, 0 failures`.
- `cd ../my_food_back && mix precommit` → `47 tests, 0 failures`.

## Remaining tasks

- None for `sdd-apply` after the post-verify blocker remediation.
- `sdd-verify` should re-run next before archive, using at least `cd ../my_food_back && mix test` and `cd ../my_food_back && mix precommit`.
