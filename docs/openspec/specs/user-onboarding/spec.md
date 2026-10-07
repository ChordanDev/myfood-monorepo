# User Onboarding Specification

## Purpose

Define post-authentication Onboarding Profile capture for the individual-first MVP. The profile is collected once after account creation, gates the app on completion, and is read-only through this endpoint after completion. User Preferences live in the `user-preferences` capability. Slot cooking-time budget and hunger level per Meal Slot live in the `user-slot-cooking-times` capability but are required inputs of the same onboarding flow.

## Requirements

### Requirement: Onboarding Profile Fields

The system MUST persist an Onboarding Profile for each User with `display_name` (string, 1-60 chars), `household_size` (integer 1-20), and `cooking_skill` (one of `beginner`, `intermediate`, `advanced`). All three fields MUST be required for completion.

#### Scenario: All required fields provided

- GIVEN an authenticated User with no Onboarding Profile
- WHEN the client posts a complete onboarding payload with profile, preferences, and all three slot cooking times to `POST /api/onboarding/complete`
- THEN the system persists the three fields on the User
- AND the response includes the saved profile

#### Scenario: Missing required field is rejected

- GIVEN an authenticated User with no Onboarding Profile
- WHEN the client posts a complete onboarding payload except that profile omits `cookingSkill`
- THEN the system rejects with error code `onboarding_invalid`
- AND does NOT stamp `onboarding_completed_at`

### Requirement: Onboarding Completion Stamping

The system MUST atomically validate and persist the Onboarding Profile, User Preferences, and slot cooking times, then stamp `onboarding_completed_at` on the User through one `POST /api/onboarding/complete` call. The completion timestamp MUST be one-way: once set, it MUST NOT be cleared by any later preference edit, re-login, or reinstall.

#### Scenario: Completion atomically stamps the timestamp

- GIVEN an authenticated User with no Onboarding Profile
- WHEN the client posts a complete valid onboarding payload
- THEN the system persists the profile, preferences, and slot cooking times and sets `onboarding_completed_at` to current UTC time in the same transaction
- AND `GET /me` returns `onboarding.isComplete: true`

#### Scenario: Re-completing is idempotent

- GIVEN a User with `onboarding_completed_at` already set
- WHEN the client posts another `POST /api/onboarding/complete`
- THEN the system rejects with error code `onboarding_already_complete`
- AND the original timestamp is unchanged

### Requirement: One-Way Completion Semantics

The system MUST treat `onboarding.isComplete` as one-way true. The system MUST NOT expose any path that clears `onboarding_completed_at`. A re-login on any device, or a fresh install with a valid session, MUST return `onboarding.isComplete: true` when the flag is set.

#### Scenario: Re-login preserves completion

- GIVEN a User with `onboarding_completed_at` set
- WHEN the User completes login verification on a new device
- THEN `me.onboarding.isComplete` is `true`

#### Scenario: Edits never clear completion

- GIVEN a User with `onboarding_completed_at` set
- WHEN the client calls `PUT /api/me/preferences` with empty arrays
- THEN the system persists the update
- AND `GET /me` still returns `onboarding.isComplete: true`

### Requirement: Frontend Gate Order

The frontend gate in `app/index.tsx` MUST resolve in order: (1) unauthenticated → `AuthLanding`; (2) authenticated with `onboarding.isComplete = false` → `Onboarding`, even when `account.access.canUseApp = false`; (3) complete onboarding with `account.access.canUseApp = false` → `TrialExpired`; (4) complete onboarding with `account.access.canUseApp = true` → `Tabs`. Tabs MUST remain blocked when `account.access.canUseApp = false`.

#### Scenario: Incomplete onboarding routes to onboarding

- GIVEN `account.access.canUseApp: true` and `onboarding.isComplete: false`
- WHEN the gate evaluates
- THEN the User lands on `Onboarding`
- AND `Tabs` is not rendered

#### Scenario: Locked incomplete account routes to onboarding

- GIVEN `account.access.canUseApp: false` and `onboarding.isComplete: false`
- WHEN the gate evaluates
- THEN the User lands on `Onboarding`
- AND `TrialExpired` and `Tabs` are not rendered

#### Scenario: Complete onboarding routes to tabs

- GIVEN `account.access.canUseApp: true` and `onboarding.isComplete: true`
- WHEN the gate evaluates
- THEN the User lands on `Tabs`
- AND `Onboarding` is not rendered

#### Scenario: Locked complete account routes to trial expired

- GIVEN `account.access.canUseApp: false` and `onboarding.isComplete: true`
- WHEN the gate evaluates after onboarding completion
- THEN the User lands on `TrialExpired`
- AND `Tabs` is not rendered

### Requirement: Onboarding Endpoint Access

The system MUST accept `POST /api/onboarding/complete` for any authenticated User with a valid session, including Users whose Account is locked. The system MUST reject anonymous requests.

#### Scenario: Locked account can still complete onboarding

- GIVEN an authenticated User on a locked Account
- WHEN the client posts a complete valid onboarding payload
- THEN the system stamps completion
- AND the access-lock plug does not block the response

#### Scenario: Anonymous request is rejected

- GIVEN no valid access token
- WHEN the client posts to `POST /api/onboarding/complete`
- THEN the system rejects with an authentication error

### Requirement: Onboarding Requires Slot Cooking Times

The system MUST require valid slot cooking times (see `user-slot-cooking-times`) for the three MVP slots `breakfast`, `lunch`, and `dinner` as part of any `POST /api/onboarding/complete` submission. The system MUST reject submissions missing any slot or any required slot field with error code `onboarding_invalid` and MUST NOT stamp `onboarding_completed_at`.

#### Scenario: Missing slot blocks completion

- GIVEN an authenticated User with no Onboarding Profile
- WHEN the client posts a complete onboarding payload except that slot cooking times omit `dinner`
- THEN the system rejects with `onboarding_invalid`
- AND no `users.onboarding_completed_at` is stamped

#### Scenario: Valid slot data combined with profile and preferences completes onboarding

- GIVEN an authenticated User with no Onboarding Profile
- WHEN the client posts a payload containing profile, preferences, and the three slots
- THEN the system persists all groups in one transaction
- AND stamps `onboarding_completed_at`
