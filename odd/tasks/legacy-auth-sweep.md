# Feature: legacy authentication sweep

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/14 (X4, label `ready-for-agent`). Blocked by #10, which merged as `2cf5f95`.
Branch: `claude/issue-14-81c9a9` (from `main` at `9b057b8`).

## Objective

The API exposes one sign-in path, the A5 contract (`/api/auth/login/*`, `/api/auth/signup/*`, `/api/auth/refresh`, `/api/auth/logout`). The password, social and `/api/auth/email-code/*` routes are gone with their controller actions, service functions and tests, and the mobile app carries no password or social login code.

## Problem

The auth expand-contract left the old routes mounted next to the new ones. They still mint tokens (refresh tokens that `POST /api/auth/refresh` no longer honours), `OptionalBearerUser` accepts a refresh token as a bearer credential on `POST /api/auth/email-code/verify` (finding sec-perf-01 of the PR #49 review), and the router comments and the guides describe routes nobody calls.

## Evidence (2026-10-08, read-only map at `9b057b8`)

- Mobile calls only `/api/auth/{login,signup}/{request-code,verify-code}` (`apps/mobile/src/features/auth/api/authApi.ts:8,12`), `GET /api/me` (`:57`), `POST /api/auth/logout` (`:72`) and `POST /api/auth/refresh` (`apps/mobile/src/api/authRefresh.ts:33`). No `email-code`, password or social path appears under `apps/mobile/src`.
- The repository has no web client: `apps/` holds `api` and `mobile` only. Nothing is kept on that ground.
- Legacy routes, `apps/api/lib/meal_planner_api_web/router.ex:53-60,70,78-81`. `OptionalBearerUser` and the `:optional_bearer` pipeline have one consumer, `email-code/verify`.
- `Accounts.find_or_create_identity/1` has one production caller (`AuthController.social/2`) and about twenty test call sites that use it as a fixture.
- `MealPlannerApi.Services.EmailCodeAuth` is shared: only `request_code/2` and `verify_code/3` are legacy; hashing, minting, rate limits and the continuation exchange serve `EmailCodeLogin`, `EmailCodeSignup` and switch-account.

## Scope and decisions

- In: the seven password and social routes, the two `/api/auth/email-code/*` routes, their actions, the service functions only they reach, the private helpers, config keys and env entries that die with them, `OptionalBearerUser` and its pipeline, their tests, the router comments, the guides, and the inert social login UI in mobile.
- `Accounts.find_or_create_identity/1` is deleted (criterion 1). The tests that used it as a fixture move to the existing factory helpers.
- Kept, not in the ticket: `POST /api/auth/switch-account` and its continuation exchange; the invite-accept password (`InviteController.resolve_invitee/2`, `bcrypt_elixir`); the `users.password_hash` column. No migration.
- Public functions left without a production caller and outside the ticket (`RevenuecatService.resolve_tier/2`, `SubscriptionService.normalize_tier/1`, `AccountsMembership.claims_for/1`) are left in place and reported.
- Conventional commits, no attribution lines. No push and no PR without the maintainer asking.

## Acceptance criteria (from the ticket)

- [ ] Each removed route returns 404 and no controller action or service function for it remains.
- [ ] No test references the removed routes; the full API suite is green.
- [ ] The mobile app has no client code or screen for password or social login.
- [ ] The router comment block describes only routes that exist.

## Tasks

Every task is routed to one delegated writer (each touches two or more non-trivial files, and the reading prepares the write). Test-first where a runnable RED exists: a router test that expects 404 for the route fails before the deletion.

- [ ] T1 — Password routes gone: `POST /api/auth/password`, `/login`, `/register`; `AuthController.password/2`; `Accounts.register_with_password/1`, `authenticate_with_password/1` and the helpers only they use; their tests. Tests that obtained a token through the password route obtain it through the A5 login helper.
- [ ] T2 — Social routes gone: `POST /api/auth/social`, `/google`, `/facebook`, `/apple`; `AuthController.social/2` and its private helpers; `Accounts.find_or_create_identity/1` and its helper chain; `Auth.SocialVerifier`, its test fake, config keys and env entries; fixture call sites moved to the factory helpers.
- [ ] T3 — Email-code routes gone: `POST /api/auth/email-code/request` and `/verify`; `EmailCodeAuthController`; `EmailCodeAuth.request_code/2`, `verify_code/3` and what only they reach; `OptionalBearerUser` and the `:optional_bearer` pipeline; their tests.
- [ ] T4 — Router comments and documentation describe only routes that exist (`apps/api/README.md`, `frontend_integration_guide.md`, `docs/FRONTEND_INTEGRATION.md`, `ARCHITECTURE.md`, `docs/GLOSSARY.md`, live openspec specs).
- [ ] T5 — Mobile has no social login UI: `SocialLogin`, `SocialLoginIcons`, `SocialDivider`, their icons and metrics, and their use in `AuthLandingScreen`.

## Checks

API, from `apps/api`, with `MIX_ENV=test MYFOOD_TEST_DB_USERNAME=<local role> MYFOOD_TEST_DB_PASSWORD="" MYFOOD_TEST_DATABASE=meal_planner_api_test_issue14`:

- `mix compile --warnings-as-errors --force`
- `mix format --check-formatted`
- `mix test`
- `mix credo --strict` on touched files

Mobile, from `apps/mobile`: `npx tsc --noEmit`, `npm run lint`, `npx jest --ci`, `npm run knip`.

## Delivery

- Forecast: about 4,000 authored changed lines, nearly all deletions (`email_code_auth_controller_test.exs` 572, `social_verifier.ex` 315, `accounts_registration_test.exs` 253, the legacy halves of `accounts_test.exs`, `auth_controller_test.exs` and `email_code_auth_test.exs`). Exceeds the delivery budget of about 400 lines.
- Strategy: `ask-on-risk`; chain strategy `stacked-to-main`, the maintainer's choice of 2026-10-07 for `mobile-auth-contract`, reused here. Slices follow the tasks: S1 = T1, S2 = T2, S3 = T3, S4 = T4, S5 = T5. PR creation is the maintainer's call.

## Progress

Nothing implemented yet.

## Next step

T1.
