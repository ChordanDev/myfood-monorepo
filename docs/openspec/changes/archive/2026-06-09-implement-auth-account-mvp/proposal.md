# Proposal: implement-auth-account-mvp

## Intent

Deliver Slice 1: **Auth + Account + Trial Gate** for the individual-first MVP. This change establishes the backend contract for explicit email-code account creation, passwordless login, device-scoped sessions, automatic Individual Account setup, and the `/me` access gate that the frontend will use before loading internal app data.

The backend implementation target is Phoenix/Elixir in `../my_food_back`. This OpenSpec artifact remains in `meal-app-docs`, the shared source of truth; app repositories should receive pointers to this change later rather than duplicated product decisions.

## Scope

### In scope

- Explicit signup flow where a new User chooses account creation and submits only an email.
- Passwordless email-code authentication for signup and login.
- Email code security rules:
  - 6 numeric digits.
  - Expires after 10 minutes.
  - Store only hashed codes.
  - Maximum 5 verification attempts.
  - New code invalidates the previous active code for the same flow/email context.
  - Resend cooldown of 60 seconds.
  - Rate limiting by email, IP, and device where practical in the backend.
- Signup verification creates:
  - `User`.
  - `Individual Account`.
  - owner `Membership`.
  - 10-day trial state on the Account.
  - device-scoped session.
- Login verification for existing users creates a new device-scoped session.
- Session model with short-lived access token and long-lived revocable refresh token.
- Refresh token rotation/revalidation as needed by backend security design.
- Logout revokes only the current device/session.
- `/me` contract returning identity, active account, membership role, onboarding status, and account access state.
- Trial/access gate semantics:
  - New accounts can use the app during the 10-day Trial Period.
  - Expired trial without active subscription returns `account.access.canUseApp: false`.
  - Authentication remains possible while locked so the user can reach billing/paywall surfaces.
- Backend tests for happy paths and required edge cases.
- Frontend-facing contract clarity for later integration in `../my-expo-app`.

### Out of scope

- Google, Facebook, Apple, or any other social/OAuth identity provider login. Social login is a post-MVP capability and must be specified separately, including account linking with email-code users and provider-specific edge cases.
- Onboarding profile collection beyond exposing onboarding status and preserving endpoint placeholders already defined in the PRD.
- Preference CRUD implementation.
- Billing provider integration; subscription status may be represented or mocked sufficiently to compute access state.
- Family Account, Family Plus, shared memberships beyond owner membership, and family planning.
- Planner, recipes, favorites, shopping list, inventory, leftovers, and AI integrations.
- Frontend implementation in this proposal phase.

## Affected areas

### Shared documentation / OpenSpec

- `openspec/changes/implement-auth-account-mvp/proposal.md` defines the change intent and boundaries.
- Future SDD artifacts for this change should specify endpoint contracts, data schemas, tests, and tasks.

### Backend (`../my_food_back`)

Expected implementation areas in the Phoenix backend:

- Database schemas/migrations for users, accounts, memberships, email codes, sessions, and trial/subscription access state.
- Auth context/services for request-code, verify-code, refresh, and logout flows.
- Token issuing/verification/revocation infrastructure.
- Email delivery adapter boundary, with provider choice still open.
- Rate limiting/cooldown logic.
- `/me` controller/serializer/access computation.
- Tests run with `cd ../my_food_back && mix test` per `openspec/config.yaml`.

### Frontend (`../my-expo-app`)

Frontend is not implemented in this step, but the backend contract must support later work for:

- Create account, login, and code verification screens.
- Secure token storage and session restore.
- `/me` loading state and access routing.
- Locked/paywall routing when `account.access.canUseApp` is false.

## Success criteria

- A new user can request and verify a signup code, resulting in a User, Individual Account, owner Membership, 10-day trial, and authenticated device session.
- An existing user can request and verify a login code, resulting in a device-specific session.
- Duplicate signup for an existing email returns `email_already_exists`.
- Login for an unknown email returns `email_not_found`.
- Expired, invalid, over-attempted, and rate-limited code flows return the expected error codes:
  - `code_expired`
  - `code_invalid`
  - `too_many_attempts`
  - `rate_limited`
  - `email_already_exists`
  - `email_not_found`
- Refresh works for valid active sessions and fails for revoked/invalid refresh tokens.
- Logout revokes only the current session/device.
- `/me` returns user, active account, membership role, onboarding status, and `account.access.canUseApp`.
- An account with an expired trial and no active subscription returns `account.access.canUseApp: false`.
- Backend tests cover required happy paths and edge cases.
- No product decisions are duplicated into app repos during this proposal phase.

## Risks and mitigations

- **Email provider unresolved**: The provider is an open question. Mitigate by defining an email delivery adapter and using a mock/local adapter for tests and early development.
- **Billing provider unresolved**: Access lock depends on subscription state. Mitigate by modeling trial/subscription access state now and mocking active subscription checks until billing is selected.
- **Security complexity in passwordless auth**: Codes, refresh tokens, rate limits, and device sessions are sensitive. Mitigate with hashed code storage, token revocation tests, rate-limit tests, and no plaintext code persistence.
- **User vs Account terminology drift**: The product distinguishes User from Account. Mitigate by following `CONTEXT.md`: User is the authenticated person; Account is the billing/sharing container.
- **Review budget pressure**: Auth schema, controllers, token logic, and tests may exceed the 400 changed-line review budget. Mitigate by forecasting chained PRs before implementation if detailed tasks exceed budget.
- **Trial boundary edge cases**: Time-based access can be flaky in tests. Mitigate with injectable clock/time helpers or deterministic test setup.

## Rollback plan

- Because this proposal does not implement code, rollback is deleting or superseding `openspec/changes/implement-auth-account-mvp/proposal.md`.
- For later backend implementation, rollback should be planned per PR:
  - Feature-gate new auth routes until stable.
  - Keep migrations reversible where possible.
  - Avoid coupling downstream planner/inventory code to auth internals before this slice is verified.
  - Preserve compatibility for unauthenticated health/dev routes if they exist.

## Open questions

- Which email delivery provider should be used for production email codes?
- Which billing provider will own subscription state after the mocked access model?
- What exact access-token and refresh-token lifetimes should be used?
- Should refresh tokens rotate on every refresh or remain stable until expiry/revocation?
- What device identifier, if any, should the frontend provide in addition to IP/user agent for rate limiting and session labeling?
