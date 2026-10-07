# Feature: mobile auth contract

Spec: https://github.com/ChordanDev/myfood-monorepo/issues/1 (label `ready-for-agent`).
Tickets (sub-issues of #1, native blocking edges): #6 prefactor envelope+TTL (= T1), #7 login + CurrentMe (= T3 + login half of T4), #8 signup (= signup half of T4), #9 device sessions (= T2), #10 contract closure (= T5). Work one ticket per session; #7 is the frontier after #6.
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
- [x] T1 — Error envelope + token lifetimes. One renderer for `{ error: { code, message } }` with status per code; use it in `AuthErrorHandler`, `LoadCurrentMembership`, `VerifyTokenType`, `EnforceCapability`, `OptionalBearerUser`. Guardian TTL per token type (access 1h, refresh 30d); expired access → `access_token_expired`, missing/invalid → `unauthenticated`. Route: delegated writer (2+ non-trivial files). Test-first: plug/pipeline tests through ConnCase (prior art `auth_pipeline_test.exs`, `load_current_membership_test.exs`).
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

- T0 — local: `mix ecto.create`, `mix ecto.migrate` ok with `MYFOOD_TEST_DB_USERNAME=luccagiordana MYFOOD_TEST_DB_PASSWORD=""`; `mix test` on email_code_auth controller + service, auth_controller, accounts_controller: 62 passed. Commits: d73b423, 2597aae. Native review (lineage review-d3a0dd2840d85719): assessed high (hot path: auth in doc), consent granted, 4 lenses, approved, acknowledged. Advisory non-blocking: R2-001 (doc line 41 wording), R3-001 (test.exs:5 empty-password default). Reviewed boundary → 2597aae.
- T1 — route: delegated writer (test-first, one RED→GREEN slice per behaviour). RED evidence: `api_error_test.exs` 4 failures (`ApiError.error/2 is undefined`); `auth_pipeline_test.exs` expired token → `right: %{"error" => "unauthorized", "reason" => "invalid_token"}`, unsupported/refresh typ → `right: %{"error" => "unsupported_token_type"}`, missing membership claim → `right: %{"error" => "membership_id_required"}` (6 failures incl. `load_current_membership_test`, `account_membership_queries_test`, `membership_controller_test`); capability denial → `right: %{"error" => "subscription_required"}` (7 failures across `enforce_capability_test`, cart/shopping/calendar/revenuecat controller tests); `optional_bearer_user_test.exs` → `right: %{"error" => "invalid_bearer"}` (2); `guardian_test.exs` TTL → `left: 2419200, right: 3600` (3). GREEN: each slice green after its implementation; final `mix format` ok; `mix compile --warnings-as-errors --force` ok; `mix test test/meal_planner_api_web test/meal_planner_api/auth`: 309 passed; `mix test`: 909 passed, 20 skipped, 0 failures (the 3 known planning-candidate failures did not reproduce locally). Contract scan simulation (mobile regex over `apps/api/lib`): atoms `access_token_expired`, `account_not_found`, `trial_expired`, `unauthenticated` — all allowlisted. New: `lib/meal_planner_api_web/controllers/api_error.ex` (`ApiError.error/2`, `server_fault/1` → `unknown_error` 500), `test/.../controllers/api_error_test.exs`, `test/.../plugs/optional_bearer_user_test.exs`. Changed: `auth_error_handler.ex`, plugs `load_current_membership.ex`, `verify_token_type.ex`, `enforce_capability.ex`, `optional_bearer_user.ex`, `config/config.exs` (`token_ttl`: access/access_v2 1h, refresh 30d); tests updated to the envelope: `auth_pipeline_test.exs` (now ConnCase), `load_current_membership_test.exs`, `enforce_capability_test.exs`, `guardian_test.exs`, `auth_controller_test.exs:89`, `planning_controller_test.exs:124`, `membership_controller_test.exs:103`, `cart_lifecycle_test.exs:111`, `shopping_controller_test.exs:40`, `calendar_controller_test.exs:518,734`, `revenuecat_controller_test.exs:454`, `test/meal_planner_api/persistence/accounts/account_membership_queries_test.exs:135`. Not changed (out of T1 scope, own flat bodies): `recipe_controller.ex`/`cooking_controller.ex` 403 `subscription_required`, `invite_controller.ex` 401 `unauthorized`, channel `subscription_required` replies. Commit: 5b3d3f4

## Known environmental failures

- `test/meal_planner_api/services/planning_candidate_builder_test.exs`: 3 pre-existing failures on `main` (CI evidence in `odd/tasks/monorepo-bootstrap.md`).

## Delivery

- Forecast: ~1,400 authored changed lines (migrations, schema, controller, serializer, plugs, tests). Exceeds the ~400-line delivery budget.
- Strategy: `ask-on-risk` → user chose `stacked-to-main` (2026-10-07). Slices: S1 = T0+T1 on `feat/mobile-auth-contract`; S2 = T2 on `feat/mobile-auth-device-sessions` (stacked on S1); S3 = T3 on `feat/mobile-auth-current-me`; S4 = T4 on `feat/mobile-auth-routes`; S5 = T5 on `feat/mobile-auth-contract-closure`. Each slice is its own PR to `main`, merged in order. PR creation is the user's call.
- Reviewed boundary: `2c81e7f` (T1 approved and acknowledged, lineage review-82b588bedd4d55ed; 13 advisory findings carried to #6 comment, #9, #10 and the cross-cutting envelope ticket).

## Next step

Commit the T1 work unit on `feat/mobile-auth-contract` (S1), assess with `--base-ref 2597aae --committed-only`, then T2 via delegated writer.
