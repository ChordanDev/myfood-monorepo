# Auth Account Trial Specification

## Purpose

Define the Slice 1 backend contract for explicit email-code authentication, Individual Account creation, device-scoped sessions, `/me`, and the Trial Period access gate for the individual-first MVP.

Google, Facebook, Apple, and other social/OAuth identity providers are intentionally out of scope for this MVP slice. They require a separate post-MVP specification covering provider token validation, account linking, and provider-specific edge cases.

## Requirements

### Requirement: Explicit Signup Code Request

The system MUST let a new User explicitly request an account creation email code by submitting only an email address to `POST /auth/signup/request-code`.

The request payload MUST be:

```json
{ "email": "user@example.com" }
```

A successful response MUST indicate that a code was accepted for delivery without exposing the code value:

```json
{
  "status": "code_sent",
  "expiresInSeconds": 600,
  "resendAvailableInSeconds": 60
}
```

If the email already belongs to a User, the system MUST reject the request with error code `email_already_exists`.

#### Scenario: New email requests signup code

- GIVEN no User exists for `new@example.com`
- WHEN the client posts `{ "email": "new@example.com" }` to `/auth/signup/request-code`
- THEN the system stores only a hashed 6-digit numeric code
- AND the system returns `status: code_sent`, `expiresInSeconds: 600`, and `resendAvailableInSeconds: 60`
- AND the system does not create a User yet

#### Scenario: Existing email requests signup code

- GIVEN a User already exists for `user@example.com`
- WHEN the client posts `{ "email": "user@example.com" }` to `/auth/signup/request-code`
- THEN the system rejects the request with error code `email_already_exists`

### Requirement: Signup Code Verification Creates User Account And Session

The system MUST verify signup codes through `POST /auth/signup/verify-code` and, on success, create a User, an Individual Account, an owner Membership, a 10-day Trial Period, and a device-scoped session.

The request payload MUST be:

```json
{
  "email": "user@example.com",
  "code": "123456",
  "deviceId": "optional-device-id"
}
```

A successful response MUST include short-lived and long-lived session credentials and a `/me`-compatible current user snapshot:

```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "tokenType": "Bearer",
  "me": {
    "user": {
      "id": "string",
      "email": "user@example.com",
      "displayName": null
    },
    "account": {
      "id": "string",
      "type": "individual",
      "trialEndsAt": "2026-06-14T00:00:00Z",
      "access": { "canUseApp": true, "reason": null }
    },
    "membership": { "role": "owner" },
    "onboarding": { "isComplete": false }
  }
}
```

#### Scenario: Valid signup code creates the MVP account graph

- GIVEN a valid unexpired signup code exists for `new@example.com`
- WHEN the client verifies the code
- THEN the system creates exactly one User for that email
- AND the system creates one Individual Account for the User
- AND the system creates an owner Membership between the User and Account
- AND the Account receives a Trial Period ending 10 days after creation
- AND the system creates a session for the current device
- AND the response includes `accessToken`, `refreshToken`, and `me.account.access.canUseApp: true`

### Requirement: Explicit Login Code Request

The system MUST let an existing User request a passwordless login code through `POST /auth/login/request-code`.

The request payload MUST be:

```json
{ "email": "user@example.com" }
```

A successful response MUST be:

```json
{
  "status": "code_sent",
  "expiresInSeconds": 600,
  "resendAvailableInSeconds": 60
}
```

If the email does not belong to a User, the system MUST reject the request with error code `email_not_found`.

#### Scenario: Existing user requests login code

- GIVEN a User exists for `user@example.com`
- WHEN the client posts the email to `/auth/login/request-code`
- THEN the system accepts the request and returns `status: code_sent`

#### Scenario: Unknown email requests login code

- GIVEN no User exists for `missing@example.com`
- WHEN the client posts the email to `/auth/login/request-code`
- THEN the system rejects the request with error code `email_not_found`

### Requirement: Login Code Verification Creates Device Session

The system MUST verify login codes through `POST /auth/login/verify-code` and create a new revocable session for the current device without creating a new User or Account.

The request payload MUST be:

```json
{
  "email": "user@example.com",
  "code": "123456",
  "deviceId": "optional-device-id"
}
```

A successful response MUST include `accessToken`, `refreshToken`, `tokenType: Bearer`, and a `/me`-compatible `me` object.

#### Scenario: Existing user logs in from a second device

- GIVEN a User has an active session on one device
- AND a valid login code exists for the User's email
- WHEN the client verifies the login code from another device
- THEN the system creates a separate session for the second device
- AND the first device session remains active
- AND the response includes credentials for only the second device session

### Requirement: Email Code Security Rules

The system MUST enforce email-code security rules consistently for signup and login flows.

Codes MUST be 6 numeric digits, expire after 10 minutes, be stored only as hashes, allow at most 5 verification attempts, and be invalidated when a new code is issued for the same flow/email context. Resend attempts MUST be subject to a 60-second cooldown. Requests and verifications MUST be rate limited by email, IP, and device where practical.

#### Scenario: Expired code is rejected

- GIVEN an email code was issued more than 10 minutes ago
- WHEN the client verifies that code
- THEN the system rejects the verification with error code `code_expired`

#### Scenario: Invalid code increments attempts

- GIVEN a valid unexpired email code exists
- WHEN the client submits an incorrect code
- THEN the system rejects the verification with error code `code_invalid`
- AND the system records a failed attempt for that code

#### Scenario: Too many attempts locks code verification

- GIVEN a code has reached 5 failed verification attempts
- WHEN the client submits another verification attempt for that code
- THEN the system rejects the verification with error code `too_many_attempts`

#### Scenario: New code invalidates previous code

- GIVEN a code exists for a flow/email context
- WHEN a new code is successfully issued for the same flow/email context
- THEN the previous code MUST no longer verify successfully

#### Scenario: Rate limited request is rejected

- GIVEN the email, IP, or device has exceeded the configured rate limit
- WHEN the client requests or verifies a code
- THEN the system rejects the operation with error code `rate_limited`

### Requirement: Session Refresh And Logout

The system MUST support device-scoped session refresh through `POST /auth/refresh` and current-session logout through `POST /auth/logout`.

`POST /auth/refresh` MUST accept:

```json
{ "refreshToken": "string" }
```

A successful refresh response MUST include a valid `accessToken` and MAY include a rotated `refreshToken`:

```json
{ "accessToken": "string", "refreshToken": "string", "tokenType": "Bearer" }
```

`POST /auth/logout` MUST revoke only the session identified by the current authenticated request or submitted refresh token.

#### Scenario: Valid refresh token refreshes the session

- GIVEN a session has a valid, active refresh token
- WHEN the client posts the refresh token to `/auth/refresh`
- THEN the system returns a new valid access token
- AND the session remains associated with the same User and device

#### Scenario: Revoked refresh token is rejected

- GIVEN a refresh token belongs to a revoked session
- WHEN the client posts the refresh token to `/auth/refresh`
- THEN the system rejects the request with an authentication error

#### Scenario: Logout revokes only current device

- GIVEN a User has active sessions on two devices
- WHEN the User logs out from one device
- THEN the system revokes only that device session
- AND the other device session remains valid

### Requirement: Current User Contract

The system MUST expose `GET /me` for authenticated clients to retrieve identity, active account, membership role, onboarding status, and account access state. `/me` MUST NOT return the full preferences collection.

A successful response MUST follow this shape:

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

`account.access.canUseApp` MUST be the frontend's primary gate before loading internal app data. When access is denied, `account.access.reason` MUST explain the denial with a stable machine-readable value such as `trial_expired`.

#### Scenario: Authenticated user loads current state

- GIVEN an authenticated User belongs to an active Individual Account
- WHEN the client calls `GET /me`
- THEN the system returns the User identity, Individual Account, owner Membership, onboarding status, and account access state
- AND the response omits full preferences

#### Scenario: Unauthenticated client cannot load current state

- GIVEN no valid access token is provided
- WHEN the client calls `GET /me`
- THEN the system rejects the request with an authentication error

### Requirement: Trial Gate Access Semantics

The system MUST grant app access during the Account's 10-day Trial Period and MUST deny app access when the Trial Period has expired and there is no active subscription.

Authentication MUST remain possible for locked Accounts so the frontend can route the User to billing or paywall surfaces. Locked Accounts MUST NOT be treated as a free plan.

#### Scenario: Trial account can use app

- GIVEN an Account is within its 10-day Trial Period
- AND the Account does not have an active subscription
- WHEN an authenticated client calls `GET /me`
- THEN the response includes `account.access.canUseApp: true`
- AND `account.access.reason` is `null`

#### Scenario: Expired trial without subscription is locked

- GIVEN an Account's Trial Period has expired
- AND the Account does not have an active subscription
- WHEN an authenticated client calls `GET /me`
- THEN the response includes `account.access.canUseApp: false`
- AND `account.access.reason: "trial_expired"`

#### Scenario: Locked account can still authenticate

- GIVEN an Account is locked because its Trial Period expired without an active subscription
- WHEN the User completes login verification with a valid code
- THEN the system creates a device session
- AND the response includes `me.account.access.canUseApp: false`

### Requirement: Protected App Data Gate

The system MUST require a valid authenticated session for protected MVP app data endpoints and SHOULD deny internal app-data access when `account.access.canUseApp` is false, while still allowing authentication, session management, `/me`, and billing/paywall-support endpoints.

#### Scenario: Frontend gates internal app loading

- GIVEN `/me` returns `account.access.canUseApp: false`
- WHEN the frontend receives the response
- THEN the frontend MUST route the User to a locked/paywall state
- AND the frontend MUST NOT load internal planner, recipe, shopping, or inventory data

#### Scenario: Backend denies protected app data for locked account

- GIVEN an authenticated User belongs to a locked Account
- WHEN the User requests a protected internal app data endpoint
- THEN the system SHOULD reject access with a stable authorization error indicating the Account is locked

### Requirement: Standard Error Response Contract

The system MUST return stable machine-readable error codes for authentication and trial-gate failures so clients can render deterministic states.

Error responses for this slice MUST include an `error.code` field and SHOULD include a human-readable `error.message`:

```json
{ "error": { "code": "code_invalid", "message": "Invalid code" } }
```

The auth code flows MUST support at least these error codes: `code_expired`, `code_invalid`, `too_many_attempts`, `rate_limited`, `email_already_exists`, and `email_not_found`.

#### Scenario: Client receives stable error code

- GIVEN a user submits an invalid login code
- WHEN the backend rejects the verification
- THEN the response includes `error.code: "code_invalid"`
- AND the frontend can branch on the code without parsing message text
