# Leftover prompt after cooking (issue #46, S8)

## Objective
After a successful cooking finish the app asks about leftovers: raw Ingredient leftovers go back into Inventory flagged as leftover, cooked portions become a Prepared leftover whose source is the Scheduled meal.

## Problem
`POST /api/leftovers/prepared` ignores the source meal, so `sourceMealId` is always `null`, and the app has no caller for `createPreparedLeftover` nor a prompt after finish.

## Scope
- API: `POST /api/leftovers/prepared` accepts an optional `scheduledMealId` and rejects one that is not a Scheduled meal of the Account.
- Mobile: prompt once after a successful finish (none / ingredients / prepared food); ingredients go through add-extra with `isLeftover: true`; prepared food through `createPreparedLeftover` with the recipe name as title and the Scheduled meal as source.
- Out of scope: #48, #162 (other than the source meal item), `CookingService`, the cooking controller, auth code.

## Decisions (user, 2026-10-11)
- Request field is `scheduledMealId` (spec #5); the response keeps `sourceMealId`.
- The API change ships inside #46 as the first PR of a stack, the mobile prompt on top.
- `title` stays required by the endpoint; the app always sends the recipe name.

## Constraints
- A missing, malformed or other-Account `scheduledMealId` answers 404 `scheduled_meal_not_found`, the calendar precedent, so existence is not revealed. The call is piped (`conn |> ApiError.error(...)`) for the mobile contract scan.
- No new error code; `scheduled_meal_not_found` is already in the mobile allowlist.
- No local leftover state in the app: Inventory writes go through `useInventoryStore.addExtra`, Prepared leftovers are read from the API on focus.
- Planning heuristic: about 400 authored changed lines per task; advisory only.

## Delivery
Strategy `auto-chain`, `feature-branch-chain`: PR 1 `feat/leftover-prompt-1-api` (base `main`, "Part of #46"), PR 2 `feat/leftover-prompt-2-mobile` (base PR 1, "Closes #46"). Forecast: about 150 lines API, about 500 lines mobile.

## Tasks
- [x] T1 API (first commit of `feat/leftover-prompt-1-api`; RED observed on 4 new tests; focused 27 passed; full API suite 1845 passed, 23 skipped; `compile --warnings-as-errors`, `format --check-formatted`, `credo --strict` clean; dialyzer not run locally): ownership check in `Leftovers.create/3` (field validation first, then the meal lookup, then the insert; the foreign key race answers the same not found), `scheduledMealId` in `PreparedLeftoverController` (non-string type answers 422 naming `scheduledMealId`), tests (own meal, other Account, unknown id, malformed id, omitted, wrong type). The route is not documented in any Markdown file, so no docs change. Route: delegated writer (2+ non-trivial files).
- [ ] T2 Mobile: `scheduledMealId` in `CreatePreparedLeftoverInput`, leftover prompt after finish in Home and Recipe, flow tested against fixtures. Route: delegated writer. Prompt design pending user confirmation.

## Acceptance criteria
See issue #46.

## Progress / evidence
- Exploration done: ownership precedent `calendar_controller.ex:150`, `meal_move.ex:51`; finish flow `useMarkAsCooked.ts:12`; inventory write `useInventoryStore.ts:93`.

## Next step
T2, once the user confirms the prompt design.
