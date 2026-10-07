# Design: implement-auth-account-mvp

## Overview

Implement Slice 1 in the Phoenix backend (`../my_food_back`) as a small JSON API centered on passwordless email-code authentication, the individual-first account graph, revocable device sessions, and the `/me` trial access gate.

`meal-app-docs` remains the source of truth. Backend implementation should reference this OpenSpec change rather than copying product decisions into app repos.

## Goals

- Explicit signup: email-only account creation request, verified by a 6-digit email code.
- Login: passwordless code verification for existing users.
- On successful signup verification, create exactly one `User`, one `Individual Account`, one owner `Membership`, a 10-day Trial Period, and one device session.
- Support multiple concurrent device sessions per user.
- Support revocable refresh tokens, short-lived access tokens, refresh, and current-device logout.
- Expose `/me` as the frontend gate for identity, active account, owner membership, onboarding status, and `account.access.canUseApp`.
- Keep locked accounts able to authenticate and call `/me`, while protected app-data endpoints can reject access.

## Current backend context

The backend is a Phoenix 1.8 application with Ecto/Postgres, Swoosh, Jason, Req, and Bandit already present in `mix.exs`. The router currently exposes an empty `/api` JSON scope. No domain contexts or auth schemas were found under `lib` during design review. Existing config uses `MyFoodBack.Mailer` with Swoosh local/test adapters, which is suitable for the Slice 1 mock/local email boundary.

Backend git state was not mutated by this design task. Implementers should check `git status` in `../my_food_back` before applying because the repo appears early/skeletal and generated files may be in flux.

## Architecture

### Context modules

Recommended module boundaries:

- `MyFoodBack.Accounts`
  - Owns `User`, `Account`, `Membership`, onboarding flags, and access-state calculation.
  - Public functions for creating the individual account graph and loading the current user snapshot.
- `MyFoodBack.Auth`
  - Owns `EmailCode` and `Session` schemas and auth flows.
  - Public functions for request-code, verify-code, refresh, logout, token verification, and plugs.
- `MyFoodBack.EmailDelivery`
  - Adapter boundary for sending email codes.
  - Initial implementation delegates to Swoosh local/test mailer; production provider remains configurable.
- `MyFoodBack.RateLimits`
  - Slice 1-friendly rate-limit/cooldown checks for email-code request and verify flows.
  - Can start database-backed for deterministic tests and later move to ETS/Redis if needed.

### Web modules

- `MyFoodBackWeb.AuthController`
  - `signup_request_code/2`
  - `signup_verify_code/2`
  - `login_request_code/2`
  - `login_verify_code/2`
  - `refresh/2`
  - `logout/2`
- `MyFoodBackWeb.MeController`
  - `show/2`
- `MyFoodBackWeb.AuthJSON` and `MyFoodBackWeb.MeJSON`
  - Phoenix 1.8 JSON serializers; do not introduce `Phoenix.View`.
- `MyFoodBackWeb.Plugs.AuthenticateSession`
  - Verifies Bearer access token and assigns current user/session/account.
- `MyFoodBackWeb.Plugs.RequireUnlockedAccount`
  - For future protected app-data routes. Not required on auth routes or `/me`.

Router shape:

```elixir
scope "/api", MyFoodBackWeb do
  pipe_through :api

  post "/auth/signup/request-code", AuthController, :signup_request_code
  post "/auth/signup/verify-code", AuthController, :signup_verify_code
  post "/auth/login/request-code", AuthController, :login_request_code
  post "/auth/login/verify-code", AuthController, :login_verify_code
  post "/auth/refresh", AuthController, :refresh

  pipe_through :authenticated_api
  post "/auth/logout", AuthController, :logout
  get "/me", MeController, :show
end
```

If logout also accepts a submitted refresh token, it may be allowed in the unauthenticated API pipe, but the preferred default is authenticated logout revoking the session identified by the current access token.

## Data model

Use UUID primary keys if the project standard is not yet fixed. Use `:utc_datetime_usec` timestamps where practical; existing generator config uses `:utc_datetime` and can remain unless the backend team chooses to standardize on microseconds before first migrations.

### `users`

- `id`
- `email` normalized to lowercase, unique, not null
- `display_name`, nullable
- `onboarding_completed_at`, nullable
- timestamps

Indexes:

- unique index on `lower(email)` or a normalized stored `email` unique index.

### `accounts`

- `id`
- `type`: `individual` initially; future values `family`, `family_plus`
- `trial_started_at`, not null
- `trial_ends_at`, not null
- `subscription_status`: `none | active | past_due | canceled`, default `none`
- timestamps

Access calculation:

- `canUseApp = true` when `subscription_status == active` OR `now < trial_ends_at`.
- Otherwise `canUseApp = false`, `reason = trial_expired`.
- Boundary decision: trial is active while `now < trial_ends_at`; at exactly `trial_ends_at`, trial is expired.

### `memberships`

- `id`
- `user_id`
- `account_id`
- `role`: `owner` initially
- `status`: `active` initially, optional but recommended for future family support
- timestamps

Indexes/constraints:

- unique `user_id, account_id`
- index `account_id`
- optional partial unique index to enforce one active owner per individual account.

### `email_codes`

- `id`
- `email` normalized, not null
- `flow`: `signup | login`
- `code_hash`, not null
- `expires_at`, not null
- `attempt_count`, default `0`
- `consumed_at`, nullable
- `invalidated_at`, nullable
- `last_sent_at`, not null
- `request_ip_hash`, nullable
- `device_id_hash`, nullable
- timestamps

Rules:

- Store only a hash of the 6-digit code; never persist plaintext.
- New successfully issued code invalidates previous unconsumed active codes for the same normalized email + flow.
- Verification only considers latest active code for that email + flow.
- On valid verification, set `consumed_at` in the same transaction as user/session creation.

Hashing recommendation:

- Use `:crypto.mac(:hmac, :sha256, app_secret, "#{flow}:#{email}:#{code}")` or a dedicated code pepper from runtime config.
- Use constant-time comparison for verification.
- Do not use password hash libraries unless already present; short-lived codes plus HMAC and rate limits are sufficient for Slice 1.

### `sessions`

- `id`
- `user_id`
- `device_id_hash`, nullable
- `device_label`, nullable derived from user agent if desired
- `refresh_token_hash`, not null, unique
- `refresh_token_version`, integer default `1` if rotation history is needed
- `access_token_jti`, nullable if access-token revocation is required later
- `last_used_at`, nullable
- `expires_at`, not null
- `revoked_at`, nullable
- `revoked_reason`, nullable
- `user_agent`, nullable
- `ip_hash`, nullable
- timestamps

Default lifetimes:

- Access token: 15 minutes.
- Refresh token/session: 30 days.
- Email code: 10 minutes.
- Trial: 10 days.

## Token/session strategy

Recommended default: rotate refresh tokens on every successful `/auth/refresh`.

Rationale:

- Rotation limits replay risk for mobile devices and stolen refresh tokens.
- The spec permits refresh responses to include a rotated token.
- Tests can remain deterministic by asserting old refresh tokens fail after rotation.

Implementation details:

- Access token can be a Phoenix-signed token (`Phoenix.Token`) or compact signed token containing `session_id`, `user_id`, `jti`, and `exp`. Avoid storing access token plaintext.
- Refresh token should be a high-entropy random secret returned once to the client; persist only its SHA-256/HMAC hash.
- On refresh:
  1. Hash submitted refresh token and find active, unexpired session.
  2. If session is revoked/expired, reject with authentication error.
  3. Generate new access token and new refresh token.
  4. Replace `refresh_token_hash`, update `last_used_at`, and return both tokens.
- On logout:
  - Revoke only the current session (`revoked_at` set).
  - Other sessions for the same user remain valid.
- If refresh-token reuse is detected after rotation, Slice 1 may simply reject it. A future hardening task can revoke all sessions for that user/device.

## API contracts

All endpoints live under `/api` unless the implementation intentionally chooses a different API prefix and updates this OpenSpec first.

### Standard success envelopes

Auth code request:

```json
{
  "status": "code_sent",
  "expiresInSeconds": 600,
  "resendAvailableInSeconds": 60
}
```

Auth verify and refresh:

```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "tokenType": "Bearer",
  "me": { }
}
```

Refresh may omit `me`; verify responses should include `me` to simplify first app routing.

### Standard error envelope

```json
{ "error": { "code": "code_invalid", "message": "Invalid code" } }
```

Required stable codes:

- `code_expired`
- `code_invalid`
- `too_many_attempts`
- `rate_limited`
- `email_already_exists`
- `email_not_found`

Recommended additional implementation codes:

- `unauthenticated`
- `account_locked`
- `validation_failed`

### `/me` serializer

```json
{
  "user": {
    "id": "string",
    "email": "user@example.com",
    "displayName": "string|null"
  },
  "account": {
    "id": "string",
    "type": "individual",
    "trialEndsAt": "2026-06-14T00:00:00Z",
    "subscriptionStatus": "none|active|past_due|canceled",
    "access": { "canUseApp": true, "reason": null }
  },
  "membership": { "role": "owner" },
  "onboarding": { "isComplete": false }
}
```

`/me` must not include full preferences.

## Flow details

### Signup request code

1. Normalize and validate email.
2. If user exists, return `email_already_exists`.
3. Check cooldown and rate limits for email/IP/device.
4. Generate 6 numeric digits.
5. Invalidate prior active signup code for email.
6. Store hashed code and expiry.
7. Send through `EmailDelivery` adapter.
8. Return `code_sent` without exposing the code.

Development-only logging may expose the code only if deliberately configured, never in tests/prod. Prefer Swoosh local mailbox for development instead.

### Signup verify code

1. Normalize email and validate code format.
2. Check verification rate limits.
3. Load latest active signup code.
4. Reject expired/invalid/over-attempted codes with stable errors.
5. In a database transaction:
   - Re-check no user exists for email.
   - Consume code.
   - Insert user.
   - Insert individual account with `trial_started_at = now`, `trial_ends_at = now + 10 days`.
   - Insert owner membership.
   - Insert session and refresh-token hash.
6. Return tokens and `/me` snapshot.

Use unique DB constraints to prevent duplicate users/accounts during concurrent verifications.

### Login request code

Same as signup request, except user must exist or return `email_not_found`, and prior active login codes are invalidated.

### Login verify code

Same code verification path as signup, except it loads existing user/account membership and creates only a new session. Locked accounts still receive a session and a `/me` response with `canUseApp: false`.

## Email delivery adapter

Define a small boundary, for example:

```elixir
@callback deliver_code(email :: String.t(), code :: String.t(), flow :: :signup | :login) :: :ok | {:error, term()}
```

Default implementations:

- Development: Swoosh local adapter via `MyFoodBack.Mailer`.
- Test: Swoosh test adapter, asserting delivery without external network.
- Production: configurable Swoosh provider; provider choice remains out of scope for this slice.

Controllers and auth contexts should not construct provider-specific API calls directly.

## Rate limiting and cooldown

Slice 1 should choose deterministic, testable limits over infrastructure-heavy dependencies.

Recommended approach:

- Enforce the 60-second resend cooldown from persisted `email_codes.last_sent_at` for same email + flow.
- Add a small `auth_rate_limits` table or reusable `rate_limit_events` table with:
  - `key_hash`
  - `scope`: `email | ip | device`
  - `action`: `request_code | verify_code`
  - `occurred_at`
- Check counts in rolling windows inside transactions or with simple inserts + count queries.
- Hash email/IP/device values so raw IP/device identifiers are not required for enforcement.

Initial suggested limits, adjustable by config:

- Request code by email+flow: 3 per 15 minutes, plus 60-second cooldown.
- Request code by IP: 20 per hour.
- Request code by device: 10 per hour.
- Verify attempts: hard cap 5 per code as required, plus IP/device rolling limits to reduce brute force.

If the backend team prefers fewer tables for Slice 1, cooldown + per-code attempts may be implemented first, but the design recommends at least persisted email/IP/device events because the spec requires rate limiting where practical.

## Deterministic time-bound tests

Time behavior must not rely on `Process.sleep/1`.

Recommended pattern:

- Centralize time access in `MyFoodBack.Clock` with `utc_now/0`.
- Allow tests to pass an explicit `now` into context functions or configure a test clock module.
- Tests create fixtures with `expires_at`, `trial_ends_at`, and cooldown timestamps relative to the fixed `now`.
- Assert exact boundary behavior:
  - code valid before `expires_at`.
  - code expired at/after `expires_at`.
  - trial usable before `trial_ends_at`.
  - account locked at/after `trial_ends_at` without active subscription.

## Testing plan

Run backend tests with:

```sh
cd ../my_food_back && mix test
```

Per backend `AGENTS.md`, final implementation should also run `mix precommit` after changes.

Required test coverage:

- Signup request stores hashed code only and does not create user.
- Duplicate signup returns `email_already_exists`.
- Signup verification creates user/account/membership/trial/session in one transaction.
- Unknown login request returns `email_not_found`.
- Login verification creates a second independent session without revoking the first.
- Expired code returns `code_expired`.
- Invalid code returns `code_invalid` and increments attempts.
- Sixth verification attempt returns `too_many_attempts`.
- New code invalidates previous code.
- Resend cooldown/rate limit returns `rate_limited`.
- Valid refresh rotates refresh token and returns a new access token.
- Revoked/old refresh token is rejected.
- Logout revokes only current session.
- `/me` omits preferences and returns account access state.
- Expired trial without active subscription returns `canUseApp: false`, `reason: trial_expired`.
- Active subscription with expired trial returns `canUseApp: true`.

Controller tests should assert response shapes and stable `error.code` values. Context tests should assert transactional behavior and DB constraints.

## File change forecast

Expected backend files for apply phase:

- Migrations under `../my_food_back/priv/repo/migrations/*`
- Schemas under:
  - `lib/my_food_back/accounts/user.ex`
  - `lib/my_food_back/accounts/account.ex`
  - `lib/my_food_back/accounts/membership.ex`
  - `lib/my_food_back/auth/email_code.ex`
  - `lib/my_food_back/auth/session.ex`
- Contexts/services:
  - `lib/my_food_back/accounts.ex`
  - `lib/my_food_back/auth.ex`
  - `lib/my_food_back/auth/tokens.ex`
  - `lib/my_food_back/email_delivery.ex`
  - `lib/my_food_back/rate_limits.ex`
  - `lib/my_food_back/clock.ex`
- Web:
  - `lib/my_food_back_web/router.ex`
  - `lib/my_food_back_web/controllers/auth_controller.ex`
  - `lib/my_food_back_web/controllers/auth_json.ex`
  - `lib/my_food_back_web/controllers/me_controller.ex`
  - `lib/my_food_back_web/controllers/me_json.ex`
  - `lib/my_food_back_web/plugs/authenticate_session.ex`
  - optional `lib/my_food_back_web/plugs/require_unlocked_account.ex`
- Tests under `../my_food_back/test/...`

Given the 400 changed-line review budget, implementation likely exceeds a single comfortable PR. Recommended chained PR forecast:

1. Schema/migrations + context basics + deterministic clock.
2. Email-code request/verify flows + email adapter + rate limits.
3. Sessions/tokens/refresh/logout.
4. `/me` serializer, plugs, access gate, and integration tests.

## Rollout and rollback

- Auth routes can be introduced under `/api` without affecting existing app features because the backend API scope is currently empty.
- Keep migrations reversible where feasible.
- Do not gate future planner/favorites endpoints until `/me` and session auth are verified.
- If token/session implementation must be rolled back, remove routes and revoke/delete sessions created in non-production environments; production rollback should preserve users/accounts and only disable affected auth endpoints.

## Open decisions resolved by this design

- Refresh tokens should rotate on every refresh by default.
- Access tokens should be short-lived, with a recommended 15-minute lifetime.
- Refresh sessions should default to 30 days.
- Trial is usable only while `now < trial_ends_at`; exact boundary is locked unless subscription is active.
- Email delivery should use a Swoosh-backed adapter boundary with local/test adapters for Slice 1.
- Time-dependent tests should use injectable/fixed time, never sleeps.

## Remaining open questions

- Production email provider selection.
- Production billing provider and subscription webhook model.
- Exact frontend-provided `deviceId` semantics and privacy constraints.
