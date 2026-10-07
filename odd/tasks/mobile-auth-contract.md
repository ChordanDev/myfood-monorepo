# Feature: mobile auth contract

Spec: https://github.com/ChordanDev/myfood-monorepo/issues/1 (label `ready-for-agent`).
Branch: `feat/mobile-auth-contract` (from `main` at `38a4a7e`).

## Objective

`apps/api` serves the auth contract `apps/mobile` already implements, so a person can sign up, log in, refresh, log out and be routed by `GET /api/me` end to end against the real backend.

## Problem

Mobile calls `POST /api/auth/{signup,login}/{request-code,verify-code}`, `/api/auth/refresh`, `/api/auth/logout` and `GET /api/me` with camelCase bodies and reads `{ error: { code, message } }`. The API exposes `/api/auth/email-code/*`, snake_case, flat error strings, a three-shape verify response, non-rotating refresh tokens, a no-op logout and no Trial on fresh Accounts.

## Scope and constraints

- Mobile contract wins; mobile code does not change except un-skipping its contract test.
- Legacy routes stay. Mobile is the only client, so `/api/auth/refresh`, `/api/auth/logout`, `GET /api/me` and the auth plugs change behaviour in place.
- Trial is 7 days (code wins over old PRDs).
- Decisions taken (see spec): membership resolution owner-first, `account_not_found` when no active Membership, email existence revealed on request-code, access TTL 1h, refresh TTL 30d, resend cooldown 60s, plan mapping `trial/individual → individual`, `family_4 → family`, `family_6 → family_plus`.
- RDD is on (global). Review candidate = each work-unit commit; assess after each commit with `--base-ref <last reviewed boundary> --committed-only`.

## Tasks

- [x] T0 — Make `config/test.exs` DB credentials env-driven (`MYFOOD_TEST_DB_USERNAME/PASSWORD/HOSTNAME`, CI defaults unchanged) so `mix test` runs locally. Route: inline (one mechanical file). Checks: `mix ecto.create && mix ecto.migrate` locally, auth test files green.
- [ ] T1 — Error envelope + token lifetimes. One renderer for `{ error: { code, message } }` with status per code; use it in `AuthErrorHandler`, `LoadCurrentMembership`, `VerifyTokenType`, `EnforceCapability`, `OptionalBearerUser`. Guardian TTL per token type (access 1h, refresh 30d); expired access → `access_token_expired`, missing/invalid → `unauthenticated`. Route: delegated writer (2+ non-trivial files). Test-first: plug/pipeline tests through ConnCase (prior art `auth_pipeline_test.exs`, `load_current_membership_test.exs`).
- [ ] T2 — Device sessions. Migration + schema (`refresh_sessions`: token hash, user, membership, device_id, expires_at, revoked_at, replaced_by). `mint_token_pair` writes a row; `POST /api/auth/refresh` rotates with `refresh_token_{invalid,revoked,replayed,expired,session_mismatch}`; `POST /api/auth/logout` revokes and returns 204. camelCase bodies. Route: delegated writer. Test-first: `auth_controller_test.exs` refresh/logout sections rewritten.
- [ ] T3 — `CurrentMe` serializer + `GET /api/me`. `users.onboarding_completed_at` migration; serializer with plan/access matrix; `/api/me` returns the mobile shape. Route: delegated writer. Test-first: serializer unit tests + `accounts_controller_test.exs`.
- [ ] T4 — Mobile auth routes. `MobileAuthController` with signup/login request-code (existence checks, cooldown, `expiresInSeconds`/`resendAvailableInSeconds`) and verify-code (`deviceId`; signup creates User+Account+owner Membership+Trial in one transaction via a passwordless registration path; login resolves Membership owner-first; single response shape with `me`). Service: `code_expired` vs `code_invalid`, codes allowed for not-yet-existing users (nullable `user_id` on verification codes), new code invalidates previous. Route: delegated writer. Test-first: new `mobile_auth_controller_test.exs` modelled on `email_code_auth_controller_test.exs`.
- [ ] T5 — Contract closure. Un-skip `authErrorCodeContract.test.ts`, run jest; `mix precommit`; mark `frontend_integration_guide.md` auth section as superseded by issue #1; GLOSSARY entry for Device session points at the new module. Route: inline/mechanical + verification worker.

## Acceptance criteria

- The seven mobile routes respond exactly as typed in `apps/mobile/src/features/auth/types/auth.ts` and `src/api/errors.ts`.
- Every 401 from auth plugs is an envelope with an allowlisted code.
- Refresh rotation, replay detection and logout revocation are observable through HTTP tests.
- Fresh sign-up yields `access.canUseApp: true`, `trialEndsAt` ≈ now + 7d, `onboarding.isComplete: false`.
- Mobile contract test passes un-skipped; API suite green except the three known planning-candidate failures.

## Verification evidence

- T0 — local: `mix ecto.create`, `mix ecto.migrate` ok with `MYFOOD_TEST_DB_USERNAME=luccagiordana MYFOOD_TEST_DB_PASSWORD=""`; `mix test` on email_code_auth controller + service, auth_controller, accounts_controller: 62 passed. Commit: (pending)

## Known environmental failures

- `test/meal_planner_api/services/planning_candidate_builder_test.exs`: 3 pre-existing failures on `main` (CI evidence in `odd/tasks/monorepo-bootstrap.md`).

## Delivery

- Forecast: ~1,400 authored changed lines (migrations, schema, controller, serializer, plugs, tests). Exceeds the ~400-line delivery budget.
- Strategy: `ask-on-risk` → chain strategy pending user answer (`stacked-to-main` or `feature-branch-chain`). Slice boundaries recorded here once chosen.
- Reviewed boundary: `38a4a7e` (branch point).

## Next step

Ask chain strategy; then T1 via delegated writer (test-first).
