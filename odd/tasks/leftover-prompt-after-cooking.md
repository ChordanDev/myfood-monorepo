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

## Prompt design (confirmed by the user, 2026-10-11)
- Appears once, when the result sheet of a successful finish is closed, from Home and from Recipe, also when there were shortages. An error-only result never opens it.
- Choices: "No sobró nada", "Ingredientes", "Comida preparada". Dismissing the prompt counts as none.
- Ingredients: lists the Ingredients deducted in that cooking (the consumed lines, one per Ingredient and unit), each with an empty quantity field. The filled ones go back to Inventory through add-extra with `isLeftover: true`. Ingredients outside the recipe are not offered. With nothing deducted the choice is not shown.
- Prepared food: title prefilled with the recipe name (editable), portions starting at 1, source the Scheduled meal. The consume-by date is the server default; no field.
- Partial failure: lines already saved leave the list and the sheet stays open with the error, so a retry does not duplicate.

## Delivery
Strategy `auto-chain`, stacked PRs, each targeting its parent branch (the user's brief asked for stacked PRs once the issue went well past about 400 authored lines; the mobile part came to about 1900 with its tests).

| PR | Branch | Base | Holds |
|---|---|---|---|
| #238 | `feat/leftover-prompt-1-api` | `main` | `8cf6667` API: `scheduledMealId` on create |
| 2 | `feat/leftover-prompt-2-prompt-state` | PR 1 | `90eea5c` summary carries the meal id, prompt stage in `useMarkAsCooked`, form model, client input |
| 3 | `feat/leftover-prompt-3-prompt-flow` | PR 2 | `0032ebf` `useLeftoverPrompt` and its flow tests against fixtures |
| 4 | `feat/leftover-prompt-4-mobile-sheet` | PR 3 | the sheet and the Home and Recipe wiring; closes #46 |

PRs 3 and 4 stay above the budget after one slicing pass (540 and about 1050 changed lines, most of them tests): the flow tests belong with the hook, and the sheet's new props are required, so the components cannot land without the screens that pass them.

## Tasks
- [x] T1 API (commit on `feat/leftover-prompt-1-api`, PR #238; native assessment medium, under budget, review pending with the stack; RED observed on 4 new tests; focused 27 passed; full API suite 1845 passed, 23 skipped; `compile --warnings-as-errors`, `format --check-formatted`, `credo --strict` clean; dialyzer not run locally): ownership check in `Leftovers.create/3` (field validation first, then the meal lookup, then the insert; the foreign key race answers the same not found), `scheduledMealId` in `PreparedLeftoverController` (non-string type answers 422 naming `scheduledMealId`), tests (own meal, other Account, unknown id, malformed id, omitted, wrong type). The route is not documented in any Markdown file, so no docs change. Route: delegated writer (2+ non-trivial files).
- [x] T2 Mobile (commits `90eea5c`, `0032ebf` and the sheet commit; RED observed per behaviour, see the PR bodies; each slice green on its own; final tree: full mobile suite 151 suites, 2356 tests passed, `tsc --noEmit` exit 0, lint 0 errors): `scheduledMealId` in `CreatePreparedLeftoverInput`, prompt stage in `useMarkAsCooked`, `useLeftoverPrompt`, the prompt as a second stage of `CookingResultSheet`, Home and Recipe wiring (on Recipe the back navigation moved to the close of the prompt). Route: delegated writer (2+ non-trivial files).

## Acceptance criteria
See issue #46.

## Progress / evidence
- Exploration done: ownership precedent `calendar_controller.ex:150`, `meal_move.ex:51`; finish flow `useMarkAsCooked.ts:12`; inventory write `useInventoryStore.ts:93`.
- Accepted changes to the plan, with their reason:
  - The cooking feature does not import the inventory or leftovers features: their indexes export screens that load `react-native-reanimated`, which bare Jest cannot load, and `useRecipeChat.test.tsx` loads the cooking index unmocked. The screens inject the two writes (`useInventoryStore`'s `addExtra`, `createPreparedLeftover`). Cost: the form UI and a small quantity parser are duplicated inside cooking instead of reusing the inventory sheet kit.
  - The prompt is a second stage of the `CookingResultSheet` modal, not a sheet of its own: iOS presents a modal at once without waiting for another one's dismissal (read from `RCTModalHostViewComponentView.mm`, not confirmed on a simulator), so two sequential modals risked the prompt never showing.
- Not verified: the prompt was not exercised in a running app (simulator or web). Keyboard handling with a long Ingredient list is the part to look at.
- Native review of the whole stack (`83d63db`): approved; one advisory finding, the untested foreign key race branch in `leftovers.ex` (the constraint is declared in `PreparedLeftover.create_changeset`, so the branch answers not found as intended).
- Jorge review of the stack (2026-10-11): approved; one confirmed low finding, the prompt fields stayed editable during a save so text typed then was dropped silently. Fixed on top of the sheet PR: the fields are read-only while a save is on its way.

## Next step
User: review and merge the stack in order; Jorge review recommended by the triage comment on #46.
