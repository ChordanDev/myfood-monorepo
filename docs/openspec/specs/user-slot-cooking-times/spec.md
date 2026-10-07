# User Slot Cooking Times Specification

## Purpose

Per-User cooking-time budget and hunger level for each `Meal Slot` used by the Individual-First MVP. Captured in the onboarding flow alongside Onboarding Profile and User Preferences; stored and edited as an independent resource.

## Requirements

### Requirement: Slot Cooking Time Resource Shape

The system MUST persist one User Slot Cooking Time record per `(User, meal_slot)`, where `meal_slot` is one of `breakfast`, `lunch`, `dinner` (snack is out of MVP scope). Each record MUST contain `cooking_time_minutes` (non-negative integer; `0` means the user does not cook that slot) and `hunger_level` (one of `light`, `normal`, `strong`). UX may present no-cook, preset minute buckets, and custom input, but storage MUST serialize no-cook as `0`, a preset bucket as that integer minute value, and custom input as a non-negative integer minute value within the validation range.

#### Scenario: All three slots persisted on first submit

- GIVEN an authenticated User with no Slot Cooking Time rows
- WHEN the client posts valid values for `breakfast`, `lunch`, and `dinner`
- THEN the system creates one record per slot for that User
- AND `GET /api/me/slot-cooking-times` returns all three

#### Scenario: Zero minutes means no cook for that slot

- GIVEN a User with no `breakfast` row
- WHEN the client submits `breakfast: { cookingTimeMinutes: 0, hungerLevel: "light" }`
- THEN the system persists `0` and the response keeps `0`

### Requirement: Read Endpoint

The system MUST expose `GET /api/me/slot-cooking-times` returning the canonical shape for every supported slot:

```json
{
  "breakfast": { "cookingTimeMinutes": 0, "hungerLevel": "normal" },
  "lunch": { "cookingTimeMinutes": 0, "hungerLevel": "normal" },
  "dinner": { "cookingTimeMinutes": 0, "hungerLevel": "normal" }
}
```

If a slot has no row, the system MUST return `cookingTimeMinutes: 0` and `hungerLevel: "normal"` (defaults), MUST NOT omit the key, and MUST respond `200`.

#### Scenario: Missing rows return defaults

- GIVEN a User with no Slot Cooking Time rows
- WHEN the client calls `GET /api/me/slot-cooking-times`
- THEN the response is `200` and includes the three slots with defaults

### Requirement: Update Endpoint

The system MUST expose `PUT /api/me/slot-cooking-times` for the authenticated User. The body MUST include the three supported slots; unknown slots MUST be rejected. `cookingTimeMinutes` MUST be a non-negative integer within the validation range. A successful update MUST upsert each slot row, return the canonical shape, and MUST NOT modify `onboarding.isComplete`.

#### Scenario: Edit round-trips

- GIVEN a User with breakfast `{ cookingTimeMinutes: 10, hungerLevel: "light" }`
- WHEN the client puts `{ breakfast: { cookingTimeMinutes: 20, hungerLevel: "normal" }, lunch: { cookingTimeMinutes: 30, hungerLevel: "normal" }, dinner: { cookingTimeMinutes: 40, hungerLevel: "strong" } }`
- THEN the response is `200` and reflects the new values
- AND a subsequent `GET` returns the new values

#### Scenario: Unknown slot is rejected

- GIVEN a payload containing `snack`
- WHEN the client submits it
- THEN the system rejects with error code `slot_cooking_times_invalid`
- AND no row is written

#### Scenario: Invalid hunger level is rejected

- GIVEN a payload with `hungerLevel: "huge"`
- WHEN the client submits it
- THEN the system rejects with `slot_cooking_times_invalid`

#### Scenario: Negative minutes is rejected

- GIVEN a payload with `cookingTimeMinutes: -1`
- WHEN the client submits it
- THEN the system rejects with `slot_cooking_times_invalid`

### Requirement: Onboarding Capture

The onboarding flow MUST collect slot cooking times alongside the Onboarding Profile and User Preferences. The system MUST persist slot cooking times as part of the same onboarding submission sequence; the completion endpoint MUST require all three slots to be provided and valid before stamping `onboarding_completed_at`.

#### Scenario: Incomplete slot data blocks completion

- GIVEN an authenticated User with no Onboarding Profile
- WHEN the client posts a complete onboarding payload except that slot cooking times omit `dinner`
- THEN the system rejects with `onboarding_invalid`
- AND does NOT stamp `onboarding_completed_at`

#### Scenario: Valid onboarding submission persists all three slots

- GIVEN an authenticated User with no Onboarding Profile
- WHEN the client posts profile + preferences + slot cooking times
- THEN the system persists all three groups in one transaction
- AND stamps `onboarding_completed_at`

### Requirement: Profile Tab Editing

The frontend MUST expose slot cooking times editing from the dedicated Profile tab only when `onboarding.isComplete` is `true` and `account.access.canUseApp` is `true`. Edits MUST go through `PUT /api/me/slot-cooking-times`; the tab MUST NOT re-call `POST /api/onboarding/complete` to edit slot data.

#### Scenario: Profile tab pre-populates current values

- GIVEN `onboarding.isComplete: true`, `account.access.canUseApp: true`, and saved slot cooking times
- WHEN the User opens the Profile tab
- THEN the slot sections are pre-populated from `GET /api/me/slot-cooking-times`

#### Scenario: Locked complete account cannot reach Profile tab editing

- GIVEN `onboarding.isComplete: true` and `account.access.canUseApp: false`
- WHEN the frontend gate evaluates
- THEN the User lands on `TrialExpired`
- AND the Profile tab is not available

#### Scenario: Edits survive app restart

- GIVEN a User that saved slot cooking times via the Profile tab
- WHEN the User reopens the app
- THEN the Profile tab shows the updated values from the next `GET`

### Requirement: Slot Cooking Times Endpoint Access

The system MUST accept `GET` and `PUT /api/me/slot-cooking-times` for any authenticated User, including locked Accounts, so onboarding setup can persist slot cooking times before app access is available. The frontend MUST only expose post-onboarding Profile tab editing while Tabs are accessible. Every read and write MUST be scoped to the session's User.

#### Scenario: Locked account can still edit slot cooking times

- GIVEN an authenticated User on a locked Account
- WHEN the client calls `PUT /api/me/slot-cooking-times`
- THEN the system accepts the request and updates the rows

#### Scenario: Cross-user access is rejected

- GIVEN an authenticated User A
- WHEN the client calls `GET /api/me/slot-cooking-times`
- THEN the response is scoped to User A only
