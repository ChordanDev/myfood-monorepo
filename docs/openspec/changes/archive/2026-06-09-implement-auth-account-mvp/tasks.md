# Tasks: implement-auth-account-mvp

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1,400 backend lines across migrations, contexts, web/API, and tests |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 schema/account graph → PR 2 email-code flows/rate limits → PR 3 sessions/tokens/refresh/logout → PR 4 `/me` access gate/API integration + frontend contract pointer |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## Pre-implementation blocker

- [x] Inspect and resolve existing backend working tree before writing code: run `cd ../my_food_back && git status --short` and coordinate/clean/stash only unrelated generated-file changes/deletes owned by the caller. Do not mix this auth slice with unrelated backend generator churn.

## Work Unit 1 — Account graph schema and access calculation (PR 1)

### RED
- [x] Add failing context tests in `../my_food_back/test/my_food_back/accounts_test.exs` for creating one User, one Individual Account, one owner Membership, a 10-day trial, normalized unique email, and access-state boundary (`now < trial_ends_at` allowed; at/after locked unless subscription active).
- [x] Add fixture helpers in `../my_food_back/test/support/fixtures/accounts_fixtures.ex` only as needed by these tests. (Not needed for Work Unit 1; tests use `DataCase` directly.)

### GREEN
- [x] Generate reversible migrations with `mix ecto.gen.migration ...` under `../my_food_back/priv/repo/migrations/` for `users`, `accounts`, and `memberships` with indexes/constraints from `design.md`.
- [x] Implement schemas in `../my_food_back/lib/my_food_back/accounts/user.ex`, `account.ex`, and `membership.ex`.
- [x] Implement `../my_food_back/lib/my_food_back/accounts.ex` functions for email normalization, individual account graph creation, current membership/account loading, and access calculation.
- [x] Add deterministic time seam in `../my_food_back/lib/my_food_back/clock.ex` or explicit `now` arguments for tested account/access functions.

### REFACTOR / VERIFY
- [x] Verify with `cd ../my_food_back && mix test test/my_food_back/accounts_test.exs`.
- [x] Acceptance mapping: covers signup graph creation prerequisites and Trial Gate Access Semantics scenarios.
- [x] Rollback boundary: remove PR 1 migrations/schemas/context before any auth routes depend on them.

## Work Unit 2 — Email code request/verify primitives (PR 2)

### RED
- [x] Add failing tests in `../my_food_back/test/my_food_back/auth/email_code_test.exs` for signup/login request rules: hashed 6-digit code only, no User on request, duplicate signup `email_already_exists`, unknown login `email_not_found`, 10-minute expiry, 5-attempt cap, new code invalidation, 60-second cooldown, and stable `rate_limited` result.
- [x] Add Swoosh/test delivery assertions or adapter fakes in `../my_food_back/test/support/` without exposing plaintext code in DB assertions. (Used Swoosh test assertions in the focused context test; no separate fake module was needed.)

### GREEN
- [x] Generate migrations for `email_codes` and persisted rate-limit events (or the minimal persisted structures chosen for email/IP/device practical limits) under `../my_food_back/priv/repo/migrations/`.
- [x] Implement `../my_food_back/lib/my_food_back/auth/email_code.ex`, core request/verify functions in `../my_food_back/lib/my_food_back/auth.ex`, and stable auth error tuples/codes.
- [x] Implement `../my_food_back/lib/my_food_back/email_delivery.ex` with a Swoosh-backed adapter boundary using existing `MyFoodBack.Mailer` local/test configuration.
- [x] Implement `../my_food_back/lib/my_food_back/rate_limits.ex` for cooldown plus email/IP/device practical rate checks, hashing raw identifiers before persistence.

### TRIANGULATE / VERIFY
- [x] Add tests for both `signup` and `login` flows sharing the same security rules without cross-invalidating each other.
- [x] Verify with `cd ../my_food_back && mix test test/my_food_back/auth/email_code_test.exs`.
- [x] Acceptance mapping: Explicit Signup Code Request, Explicit Login Code Request, Email Code Security Rules, and Standard Error Response Contract.
- [x] Rollback boundary: remove email-code/rate-limit migrations and context code; PR 1 account graph remains usable independently.

## Work Unit 3 — Sessions, tokens, refresh, and logout (PR 3)

### RED
- [x] Add failing tests in `../my_food_back/test/my_food_back/auth/session_test.exs` for device-scoped session creation, second-device login preserving first session, valid refresh rotating refresh token, old/revoked refresh rejection, and logout revoking only current session.

### GREEN
- [x] Generate `sessions` migration under `../my_food_back/priv/repo/migrations/` with hashed refresh token, device/IP/user-agent metadata, expiry, and revocation fields.
- [x] Implement `../my_food_back/lib/my_food_back/auth/session.ex` and `../my_food_back/lib/my_food_back/auth/tokens.ex` using short-lived signed access tokens and high-entropy refresh secrets stored only as hashes.
- [x] Extend `../my_food_back/lib/my_food_back/auth.ex` so signup verification transaction consumes code, creates account graph, creates session, and returns tokens; login verification consumes code and creates only a new session.
- [x] Implement refresh-token rotation and current-session logout semantics.

### TRIANGULATE / VERIFY
- [x] Add locked-account login test proving authentication still succeeds and returned `me.account.access.canUseApp` can be false after trial expiry.
- [x] Verify with `cd ../my_food_back && mix test test/my_food_back/auth/session_test.exs test/my_food_back/auth/email_code_test.exs`.
- [x] Acceptance mapping: Signup Code Verification Creates User Account And Session, Login Code Verification Creates Device Session, Session Refresh And Logout, Locked account can still authenticate.
- [x] Rollback boundary: disable session-dependent APIs and revoke/delete non-production sessions without deleting users/accounts.

## Work Unit 4 — JSON API routes, controllers, plugs, and `/me` (PR 4)

### RED
- [x] Add failing controller tests in `../my_food_back/test/my_food_back_web/controllers/auth_controller_test.exs` for all auth endpoints under `/api/auth/*`, exact success response shapes, and `error.code` envelopes.
- [x] Add failing controller tests in `../my_food_back/test/my_food_back_web/controllers/me_controller_test.exs` for authenticated `/api/me`, unauthenticated rejection, omitted full preferences, active trial access, expired trial lock, and active subscription override.

### GREEN
- [x] Update `../my_food_back/lib/my_food_back_web/router.ex` with `/api/auth/signup/request-code`, `/api/auth/signup/verify-code`, `/api/auth/login/request-code`, `/api/auth/login/verify-code`, `/api/auth/refresh`, authenticated `/api/auth/logout`, and authenticated `/api/me`.
- [x] Implement `../my_food_back/lib/my_food_back_web/controllers/auth_controller.ex` and `auth_json.ex` using Phoenix 1.8 JSON serializers, not `Phoenix.View`.
- [x] Implement `../my_food_back/lib/my_food_back_web/controllers/me_controller.ex` and `me_json.ex` with the spec response shape and no full preferences collection.
- [x] Implement `../my_food_back/lib/my_food_back_web/plugs/authenticate_session.ex` and optional `require_unlocked_account.ex` for future internal app-data routes; do not apply locked-account denial to auth routes or `/me`.

### TRIANGULATE / VERIFY
- [x] Add integration tests proving request-code → verify-code → `/me` works for signup and login, including stable codes: `code_expired`, `code_invalid`, `too_many_attempts`, `rate_limited`, `email_already_exists`, `email_not_found`.
- [x] Verify with `cd ../my_food_back && mix test`.
- [x] Run final backend quality gate per `../my_food_back/AGENTS.md`: `cd ../my_food_back && mix precommit`.
- [x] Acceptance mapping: Current User Contract, Protected App Data Gate backend SHOULD behavior, Standard Error Response Contract, and all endpoint response shapes in `spec.md`.
- [x] Rollback boundary: remove router entries/controllers/plugs while preserving lower-level contexts and migrations if needed.

## Frontend contract pointer tasks only (no frontend implementation in this change)

- [x] After backend PRs pass, add a pointer in the relevant frontend integration issue/branch to `meal-app-docs/openspec/changes/implement-auth-account-mvp/specs/auth-account-trial/spec.md`; do not duplicate product decisions into `../my-expo-app`. Evidence: `../my-expo-app/docs/SHARED_DOCS.md` now points to this OpenSpec contract.
- [x] Confirm frontend consumers use `/api/me` `account.access.canUseApp` as the primary gate and handle `trial_expired`, but leave screen/token-storage implementation to the frontend slice. Evidence: `../my-expo-app/src/services/authService.ts` loads `/api/me`; `../my-expo-app/src/features/auth/context/AuthContext.tsx` derives `canUseApp` and `isTrialExpired`; `../my-expo-app/app/index.tsx` and `../my-expo-app/app/(tabs)/_layout.tsx` gate internal app loading from that state.

## Final acceptance checklist

- [x] All backend spec scenarios in `openspec/changes/implement-auth-account-mvp/specs/auth-account-trial/spec.md` have corresponding automated backend tests or an explicit justified exception. Frontend-only consumption scenarios are deferred to the frontend slice.
- [x] Strict TDD evidence is present in commit history or PR notes for each work unit: RED test first, GREEN implementation, TRIANGULATE edge case, REFACTOR/VERIFY.
- [x] Full test command passes: `cd ../my_food_back && mix test`.
- [x] Final precommit passes: `cd ../my_food_back && mix precommit`.
- [x] Shared docs remain the source of truth; backend/frontend repos contain implementation and pointers only, not copied product decisions.

## Post-verify blocker remediation — 2026-06-09

- [x] Add Strict TDD regression coverage for verify-code rolling `rate_limited` behavior before implementation.
- [x] Enforce verify-code rolling rate limits by email, IP, and device using persisted `rate_limit_events` with `action: verify_code`.
- [x] Preserve the existing per-code 5-attempt `too_many_attempts` cap while adding rolling verification limits above it.
- [x] Audit email delivery state: Slice 1 requires a Swoosh-backed abstraction with local/test adapters and configurable production delivery; provider-specific SMTP credentials remain runtime configuration, not committed secrets.
- [x] Add a local proof path for code sending through the development Swoosh mailbox at `/dev/mailbox` and document SMTP sandbox environment variables.
- [x] Verify backend blocker remediation with focused auth tests, full `mix test`, and `mix precommit`.
