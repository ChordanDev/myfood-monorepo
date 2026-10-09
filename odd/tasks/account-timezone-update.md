# Account timezone update (issue #62, X7)

## Objective
After onboarding, the app keeps the Account timezone in sync with the device so the Account's "today" follows the User when they travel.

## Scope
- API: `PUT /api/account/timezone`, `timezone` in `GET /api/me`, docs.
- Mobile: send the device timezone on launch and on foreground only when it differs from the reported one.
- Out of scope: #20 onboarding completion (not in this branch), retroactive date changes.

## Constraints
- Mirror `PUT /api/me/profile` (`profile_controller.ex`), camelCase scope with `:mobile_casing`; errors via `ApiError.validation_error` piped (`conn |> ApiError.validation_error("timezone")`), no new error code.
- `Account.changeset/2` already validates IANA ids; coerce missing/blank/non-string to a validation error in the controller (blank would clear the zone).
- Last write wins; any member may update.
- Planning heuristic: about 400 authored changed lines per task; advisory only.

## Tasks
- [ ] T1 API: `Accounts.update_account_timezone/2`, `AccountTimezoneController`, route, `timezone` in `CurrentMe`, tests (incl. "today" at an instant where zones differ), frontend_integration_guide.md. Route: delegated writer (2+ non-trivial files).
- [ ] T2 Mobile: `timezone` in `AuthAccount`/`normalizeCurrentMe` (default null), `updateAccountTimezone` API + service, sync hook on launch/foreground, fixture tests (no request when equal, one when different). Route: delegated writer.

## Acceptance criteria
See issue #62.

## Progress / evidence
- Exploration done: no onboarding route in API yet; no timezone on mobile; `Intl.DateTimeFormat().resolvedOptions().timeZone` needs no new dependency.

## Next step
T1.
