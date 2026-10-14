# Feature: Recipe screen reads ingredient stock from the Inventory lots (issue #236)

Ticket: ChordanDev/myfood-monorepo#236, a follow-up of #38 (PR #224). It blocks #48.
Base: `main` at `63427df`. Branch: `fix/recipe-stock-from-lots`.

## Objective

The Recipe screen decides whether a recipe line is in stock by comparing it with the Inventory lots of the same Ingredient and unit, so a Recipe served by the API shows its real stock.

## Problem

`resolveRecipeIngredients` (`apps/mobile/src/features/recipe/domain/recipeIngredients.ts`) counts a line as in stock, or as listed, only when a catalog has its `ingredientId` with the same unit. `useRecipeScreen` feeds it `useInventoryStore`'s `ingredients`, which is always `MOCK_INGREDIENTS` (ids `i1` to `i7`). A Recipe from `GET /api/recipes/:id` names its Ingredients by server id, so every line reads as "Falta" whatever the Inventory holds. The tests pass because they seed recipes with ids `i1` to `i3`.

## Scope and constraints

- In scope: the recipe feature of `apps/mobile` (domain, hook, ingredient row, their tests) and one lot added to `inventory/mocks/inventoryApiFixtures.ts`.
- Out of scope, they belong to #48: `inventory/store/useInventoryStore.ts`, its test, and `src/mocks/domainMocks.ts`. The store keeps its `ingredients` field; the recipe feature only stops reading it.
- Other lanes run in parallel (#183, #205, #208, #209, #210, #211, #214, and PRs #243 and #244 on the planner feature). Their paths are not touched.

## Tasks

- [x] **T1 Stock from lots.** Route: delegated direct (four non-trivial files, and reading the tests prepares the write). Test-first with `npx jest --ci src/features/recipe` in `apps/mobile`. Commit: the work-unit commit that adds this document, `fix(mobile): read the recipe ingredient stock from the Inventory lots`.
  - `resolveRecipeIngredients` drops `catalog`. A line's stock is the sum of the lots with its `ingredientId` and its `unit`.
  - `useRecipeScreen` stops reading `state.ingredients`.
  - A test builds the screen from the API fixtures: `recipeDetail.json` and a lot with the same Ingredient id.
  - A test covers an Ingredient whose lots are all in another unit.
  - `POTATO` in `inventoryApiFixtures.ts` is a lot of the first Ingredient of `recipeDetail.json`. It is in no aggregate of that file.
  - The lot type has a required `ingredientId`, so the two tests about an Inventory item without a catalog link were removed with the case.

## Decisions

- **D1 A row always carries the unit of its recipe line.** `RecipeIngredientRow.unit` was `UnitType | null`, with `null` meaning "the local catalog does not know this Ingredient". There is no local catalog any more: every line of an API Recipe names a server Ingredient. So `unit` is `UnitType`, and `RecipeIngredientItem` offers a missing row to the Shopping list whenever it is given a handler. Nothing visible changes today, because `RecipeScreen` passes no handler.
- **D2 Lots in another unit count as no stock.** They are not converted. The available amount of such a line is 0 and its status is `missing`.
- **D3 `listed` no longer depends on a catalog.** A short line is `listed` when its Ingredient id is in `listedIngredientIds`.

## Acceptance criteria

- [x] With an Inventory lot of the same Ingredient and unit that covers the recipe quantity, the Recipe screen shows the line as in stock, for a recipe and an Inventory that both come from the API fixtures.
- [x] A line whose Ingredient has lots only in another unit is not shown as in stock.
- [x] `resolveRecipeIngredients` does not read the mock catalog.
- [x] `npm run typecheck`, `npm run lint` and `npx jest --ci` pass in `apps/mobile`.

## Verification evidence

Observed on 2026-10-13 in `apps/mobile`.

- RED, tests first: `npx jest --ci src/features/recipe` failed 24 of 205. The API fixture test read "Falta" for Papa where it expected "En stock". The other-unit test read "En stock" where it expected "Falta": the old code summed lots without looking at their unit.
- `npx jest --ci src/features/recipe`: 14 suites, 205 tests, all passed. Run by the writer and again by the parent.
- `npm run typecheck`: no errors. Run by the writer and again by the parent.
- `npm run lint`: 0 errors, 4 warnings for unused imports in files this change does not touch. Prettier check passed.
- `npx jest --ci`: 151 suites, 2357 tests, all passed.

## Found and left out

- The Inventory store starts with no lots and only `InventoryScreen` and `ShoppingScreen` call its `refresh`. A Recipe opened before either of them still shows every line as missing. The Recipe screen loading the Inventory is not part of #236.

## Progress

- 2026-10-13: document created.
- 2026-10-13: T1 done and verified.

## Next step

Open the pull request. Merging is the User's decision.
