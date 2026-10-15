# Feature: Inventory follow-ups to #42 (issue #116)

Objective: close the follow-ups of the inventory read and manual edits (#42). Branch `feat/116-inventory-follow-ups` from `main` at `e7b6f673`. Delivery: `single-pr` (the request asked for one pull request). Test runners: `mix test` in `apps/api`, `npm test` (Jest) in `apps/mobile`.

## Specs

- S1 (item 1, decided 2026-10-14): "Sign-out clears every persisted store that holds Account data (Inventory and Shopping today), from one place called by `signOut`." "No per-Account key scoping." Test: "sign out, sign in as another Account, and no screen shows a lot or a Shopping item of the previous one."
- S2 (item 2, decided 2026-10-14): "Add `GET /api/ingredients?query=` to the mobile scope: a case-insensitive name search over the Ingredient catalogue, returning `id` and `name` with a bounded result count." "Document the route in the frontend integration guide."
- S3 (item 2): "`InventoryAddSheet` sends the chosen `ingredientId`, and `MOCK_INGREDIENTS` is replaced by this catalogue so recipe stock matches lots read from the API."
- S4 (item 3): "finishing a Cooking session consumes Inventory through the API and the shim is removed."
- S5 (item 4): "one limit is chosen and both sides use it." Chosen: 1000 characters, the API bound.
- S6 (item 5): "the subtitle matches what the screen does and both documents describe the current screen, or are marked as superseded."
- S7 (smaller items): "the controller catch-all drops the failure reason and its reason list can drift from the service; zero-quantity lots are filtered in memory instead of in the query; `acquired_at` and the price are not validated on add-extra; one controller test can flake at a date boundary."

Assumptions: the search needs a non-blank `query` of at most 100 characters and answers at most 20 Ingredients, names that start with the query first. A blank, missing or longer `query` is `validation_error`.

## Tasks

| Task | Specs | Route | Status | Commit |
| ---- | ----- | ----- | ------ | ------ |
| T1 API Ingredient search route and guide | S2 | inline | pending | |
| T2 API advisory fixes | S7 | inline | pending | |
| T3 Mobile add sheet picks from the catalogue, notes 1000 | S3, S5 | inline | pending | |
| T4 Mobile sign-out clears Inventory and Shopping | S1 | inline | pending | |
| T5 Subtitle and design docs | S6 | inline | pending | |

S4 needs no task: see L2.

## Log

- L1 (2026-10-15, user request): "Implement issue #116 of ChordanDev/myfood-monorepo: \"Inventory read and manual edits: follow-ups to #42\"." Open one pull request with the label `jorge:required`; do not merge.
- L2: on `main` at `e7b6f673`, S4 and the catalogue half of S3 are already done. `consumeIngredient` and `MOCK_INGREDIENTS` no longer exist in `apps/mobile/src`; `useMarkAsCooked` starts and finishes a Cooking session, whose finish consumes Inventory on the server; `resolveRecipeIngredients` matches recipe lines to lots by the API Ingredient id. `markAsCooked` in `useMealPlanStore` only marks the entry. No change to `useMealPlanStore.ts`.
- L3: a reset registry already exists (`features/auth/utils/accountDataReset.ts`); `applySession(null)`, called by `signOut`, runs it, and only the meal plan store registers. T4 registers the Inventory and Shopping stores there.
