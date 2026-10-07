# User Preferences Specification

## Purpose

Per-User diet, hard restrictions, and soft preferences. Captured with the Onboarding Profile but stored and edited as an independent resource. Profile lifecycle lives in `user-onboarding`; this spec covers only preferences read/write semantics.

## Requirements

### Requirement: Preferences Resource Shape

The system MUST persist one User Preferences record per User with `diet` (catalog code — exact MVP seed list TBD, Open Q1), `hard_restrictions` (catalog code array — exact MVP seed list TBD, Open Q1), and `soft_preferences` (free-form string array; richer shape TBD, Open Q2). All MAY be empty. Catalog validation MUST use the currently configured server-side catalog. Codes absent from that configured catalog MUST be rejected.

#### Scenario: Valid preferences are persisted

- GIVEN an authenticated User with no User Preferences yet
- WHEN the client submits `{ "diet": "omnivore", "hardRestrictions": ["peanut"], "softPreferences": ["mushrooms"] }`
- THEN the system creates a User Preferences row with those values
- AND `GET /api/me/preferences` returns the same values

#### Scenario: Unknown diet code is rejected

- GIVEN the configured server-side diet catalog does not contain `made-up-diet`
- WHEN the client submits it
- THEN the system rejects with error code `preferences_invalid`
- AND no record is written

### Requirement: Preferences Read Endpoint

The system MUST expose `GET /api/me/preferences` returning:

```json
{ "diet": "string", "hardRestrictions": ["string"], "softPreferences": ["string"] }
```

It MUST return `200` with `diet: null` and empty arrays when no row exists.

#### Scenario: Read existing preferences

- GIVEN preferences `{ diet: "vegetarian", hardRestrictions: ["gluten"], softPreferences: [] }`
- WHEN the client calls `GET /api/me/preferences`
- THEN the response is `200` and matches the canonical shape

#### Scenario: Read with no preferences row

- GIVEN a User with no User Preferences row
- WHEN the client calls `GET /api/me/preferences`
- THEN the response is `200` with `diet: null`, empty arrays

### Requirement: Preferences Update Endpoint

The system MUST expose `PUT /api/me/preferences` for the authenticated User. A successful update MUST replace the User's preferences, return the canonical shape, and MUST NOT modify `onboarding.isComplete` (see `user-onboarding`).

#### Scenario: Edit round-trips

- GIVEN preferences `{ diet: "omnivore", hardRestrictions: [], softPreferences: [] }`
- WHEN the client puts `{ diet: "pescatarian", "hardRestrictions": ["shellfish"], "softPreferences": ["cilantro"] }`
- THEN the response is `200` with the new shape
- AND a subsequent `GET` returns the new values

#### Scenario: Invalid update is rejected

- GIVEN a User with saved preferences
- WHEN the client puts `{ diet: "made-up-diet" }`
- THEN the system rejects with `preferences_invalid`
- AND stored preferences are unchanged

### Requirement: Preferences Editing Surface

The frontend MUST expose preferences editing from a dedicated Profile tab only when `onboarding.isComplete` is `true` and `account.access.canUseApp` is `true`. Edits MUST go through `PUT /api/me/preferences`; the tab MUST NOT call `POST /api/onboarding/complete`.

#### Scenario: Profile tab loads current values

- GIVEN `onboarding.isComplete: true`, `account.access.canUseApp: true`, and saved preferences
- WHEN the User opens the Profile tab
- THEN the form is pre-populated from `GET /api/me/preferences`

#### Scenario: Locked complete account cannot reach Profile tab editing

- GIVEN `onboarding.isComplete: true` and `account.access.canUseApp: false`
- WHEN the frontend gate evaluates
- THEN the User lands on `TrialExpired`
- AND the Profile tab is not available

#### Scenario: Edits survive app restart

- GIVEN a User that saved preferences via the Profile tab
- WHEN the User reopens the app
- THEN the Profile tab shows the updated values from the next `GET`

### Requirement: Preferences Endpoint Access

The system MUST accept `GET` and `PUT /api/me/preferences` for any authenticated User, including locked Accounts, so onboarding setup can persist preferences before app access is available. The frontend MUST only expose post-onboarding Profile tab editing while Tabs are accessible. Every read and write MUST be scoped to the session's User.

#### Scenario: Locked account can still edit

- GIVEN an authenticated User on a locked Account
- WHEN the client calls `PUT /api/me/preferences`
- THEN the system accepts the request and updates the row

#### Scenario: Cross-user access is rejected

- GIVEN an authenticated User A
- WHEN the client calls `GET /api/me/preferences`
- THEN the response is scoped to User A only

### Requirement: Audit Log (Deferred)

The system SHOULD NOT introduce a preferences audit log in this slice. Open Question 3 defers the decision; if adopted, it MUST be specified in a later delta.

#### Scenario: No audit row is written

- GIVEN a successful preferences update
- THEN no audit row is created
