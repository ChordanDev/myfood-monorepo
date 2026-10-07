# Delta for Auth Account Trial

## MODIFIED Requirements

### Requirement: Protected App Data Gate

The system MUST require a valid authenticated session for protected MVP app data endpoints and SHOULD deny internal app-data access when `account.access.canUseApp` is false. Authentication, session management, `/me`, billing/paywall-support endpoints, and pre-app setup endpoints required to complete onboarding MAY remain available to locked Accounts. Pre-app setup endpoints for this slice include `POST /api/onboarding/complete`, `GET/PUT /api/me/preferences`, and `GET/PUT /api/me/slot-cooking-times`. Tabs, planner, recipe, shopping, inventory, and other protected internal app data MUST remain unavailable when `account.access.canUseApp` is false.
(Previously: Locked Accounts could authenticate and use `/me`/billing support while protected app data was denied; onboarding setup endpoints were not explicitly exempted.)

#### Scenario: Frontend gates internal app loading

- GIVEN `/me` returns `account.access.canUseApp: false`
- WHEN the frontend receives the response for a User with completed onboarding
- THEN the frontend MUST route the User to a locked/paywall state
- AND the frontend MUST NOT load internal planner, recipe, shopping, or inventory data

#### Scenario: Backend denies protected app data for locked account

- GIVEN an authenticated User belongs to a locked Account
- WHEN the User requests a protected internal app data endpoint
- THEN the system SHOULD reject access with a stable authorization error indicating the Account is locked

#### Scenario: Locked incomplete account may complete pre-app setup

- GIVEN an authenticated User belongs to a locked Account
- AND `onboarding.isComplete` is `false`
- WHEN the User submits valid onboarding setup data
- THEN the system MAY accept the setup endpoint request
- AND the frontend MUST route to `TrialExpired` after completion if `account.access.canUseApp` remains false
