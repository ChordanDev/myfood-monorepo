# Feature: Recipes sweep (issue #38, R7)

Ticket: ChordanDev/myfood-monorepo#38, part of spec #4 (recipes, favorites and cooking).
Base: `main` at `bacab02`.

## Objective

The app has one recipe shape and no fixture recipes in the recipe feature. The API recipe service has no function without a route or a caller.

## Problem

- The mobile app still carries the flat recipe type of the fixtures (`MasterRecipe`, float amounts, a cost number) next to the Recipe snapshot shape, with a converter between them. Nothing in production writes a flat recipe any more, so every reader of it is dead pass-through code.
- `RecipeService` still exports recipe list, create and search, two ingredient lookups and a favorite check that no route and no caller reaches.

## Scope and constraints

- In scope: the unreferenced `RecipeService` functions and the `RecipeRepo` functions they alone called; the flat mobile recipe type, its converter, the flat recipe fixtures and the readers that only pass them through.
- Out of scope: routing recipe list or search (spec #4 keeps them unrouted), #16, #208 (Slot favorites), engine modules.
- Boundaries with parallel work: no edit in the mobile cooking, planner or shopping features, in `CookingService`, or in auth code.
- The planner's favorites read (`GET /api/planning/favorites`) keeps working, proven by a test.
- An API function is unused only when nothing in the API routes to it or calls it. The mobile app not using a route is not evidence.

## Delivery

Forecast: about 250 changed lines on the API and about 700 on mobile, so two independent PRs from `main`, one per side, as the brief asks. Observed: 223 on the API and 639 on mobile.

- API: branch `refactor/recipes-sweep-api`, PR #220.
- Mobile: branch `refactor/recipes-sweep-mobile`. It carries this document and closes #38.

## Decisions

- **D1 Delete, do not route.** Spec #4 lists recipe search and listing beyond favorites as out of scope, so the unreferenced functions are deleted.
- **D2 Repo functions orphaned by the deletion go with it.** A `RecipeRepo` function whose only caller was a deleted service function is deleted in the same change. `RecipeRepo` functions that were already unreferenced before this change are not touched; they are listed in the PR for a follow-up.
- **D3 The local chat store is already gone.** Commit `8898161` (#36) removed the scripted recipe chat; `useRecipeChat` reads the Cooking session API. Nothing to delete.
- **D4 `recipeDetail.json` stays.** It is the frozen contract payload in the new shape, read by the API controller test and watched by CI. It is not a mock recipe.
- **D5 The store keeps an empty `recipes` key.** Two shopping tests seed `useMealPlanStore` with `recipes: []` and tests are type-checked. The shopping feature belongs to a parallel session, so the key stays, typed as an always-empty array, until those two lines can drop it.
- **D6 The inventory mock catalog stays.** `MOCK_INGREDIENTS` seeds the persisted Inventory catalog in production code. It is not a recipe fixture and removing it reaches the same shopping tests.

- **D7 The Home selection keeps its `imageUrl` and `theme` fields.** After the sweep nothing produces them, as before it nothing did in production (the flat recipes were never written). Removing them would also remove `useHomeRecipeTheme`, the hook behind "today's meal recolors Home". Whether Home gets a palette from the calendar read or loses the hook is a product decision, left open.

## Tasks

- [x] **T1 API: remove the unreferenced recipe service functions.** Route: direct inline (mechanical deletions in files already mapped by a read-only explorer; the mapping exceeded the inline evidence budget, so it was delegated). Deleted `RecipeService.list_recipes/1`, `create_recipe/2`, `search_recipes/2`, `favorite?/2`, `list_ingredients/0`, `find_ingredients_by_names/1`, their two private serializers, the six `RecipeRepo` functions they alone called and six `is_function` stub tests. The tenancy sweep test of `favorite?/2` now covers `list_favorites/1`. New test: a favorite added and removed through `/api/me/favorites` is followed by `GET /api/planning/favorites`. Commit `2e40dd3` on `refactor/recipes-sweep-api`, `refactor(api): remove the recipe service functions nothing calls (#38)`. Review assessment: medium, `under_budget`, no review due.
- [x] **T2 Mobile: delete the flat recipe type, its converter and the flat recipe fixtures.** Route: delegated direct (one writer; fifteen files, several non-trivial). Deleted `MasterRecipe`, `CustomizedRecipe`, `RecipeIngredient`, `RecipeStep`, `recipeFromMasterRecipe` with its test, `MOCK_MASTER_RECIPES`, the fixture image lookup, `getRecipeById`, and the `recipes` pass-through in `useRecipe`, the home feature and the plan store. The Recipe screen tests are seeded through the recipe cache with the same content; one test whose subject was the local flat path is gone. Commit on this branch: `refactor(mobile): remove the flat recipe type and its converter (#38)`.

## Acceptance criteria

- The old flat mobile recipe type and its converters are deleted.
- The mobile local chat store and the mock recipe fixtures used by the recipe feature are deleted.
- Recipe service functions with no route and no caller are deleted; the planner's favorites read keeps working.
- API and app suites green.

## Checks

- API: `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo`, `mix test`, `mix dialyzer` compared against the local baseline of `main`.
- Mobile: `npm run lint`, `npm run typecheck`, `npm test`.

## Progress

Both tasks are done. Checks observed on 2026-10-11:

- API (`refactor/recipes-sweep-api`): `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict` and `mix sobelow --config` clean; `mix test` 1814 passed, 22 skipped (`main`: 1819 passed; six stub tests removed, one added); `mix dialyzer` reports the same 9 `call_without_opaque` warnings as `main` on the local OTP 29, in the same files.
- Mobile (this branch): `npm run typecheck` clean; `npm run lint` 0 errors and the 4 warnings of `main`; `npx jest --ci` 148 suites and 2249 tests passed (`main`: 149 and 2260; the converter suite of 10 tests and one Recipe screen test removed).

What the engine calls of the recipe context, with the engine taken as `generation/*`, `optimization/*` and the services `Generation.Server` aliases: `RecipeVersions.freeze_many/1`, `RecipeVersions.decode/1` and `RecipeVersions.recipe_for_meal/1`. Nothing of `RecipeService` or `RecipeRepo`.

## Left for later

- The `recipes` key of `useMealPlanStore` (D5), once `useShoppingListStore.test.ts` and `ShoppingScreen.test.tsx` stop seeding it.
- Thirteen `RecipeRepo` functions that had no caller in `lib` before this change (D2).
- The Home palette (D7).
- The Inventory mock catalog `MOCK_INGREDIENTS` and `useInventoryStore.consumeIngredient`, which no production code calls (D6). The Recipe screen resolves stock against that catalog.
- `MOCK_MEAL_PLAN` and `src/mocks/mealPlans.ts`, imported only by tests. They are meal plan mocks, not recipe fixtures.
- `apps/mobile/CLAUDE.md` still says palette values live in mocks.
