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

Forecast: about 250 changed lines on the API and about 700 on mobile, so two independent PRs from `main`, one per side, as the brief asks.

- API: branch `refactor/recipes-sweep-api`.
- Mobile: branch `refactor/recipes-sweep-mobile`. It carries this document and closes #38.

## Decisions

- **D1 Delete, do not route.** Spec #4 lists recipe search and listing beyond favorites as out of scope, so the unreferenced functions are deleted.
- **D2 Repo functions orphaned by the deletion go with it.** A `RecipeRepo` function whose only caller was a deleted service function is deleted in the same change. `RecipeRepo` functions that were already unreferenced before this change are not touched; they are listed in the PR for a follow-up.
- **D3 The local chat store is already gone.** Commit `8898161` (#36) removed the scripted recipe chat; `useRecipeChat` reads the Cooking session API. Nothing to delete.
- **D4 `recipeDetail.json` stays.** It is the frozen contract payload in the new shape, read by the API controller test and watched by CI. It is not a mock recipe.
- **D5 The store keeps an empty `recipes` key.** Two shopping tests seed `useMealPlanStore` with `recipes: []` and tests are type-checked. The shopping feature belongs to a parallel session, so the key stays, typed as an always-empty array, until those two lines can drop it.
- **D6 The inventory mock catalog stays.** `MOCK_INGREDIENTS` seeds the persisted Inventory catalog in production code. It is not a recipe fixture and removing it reaches the same shopping tests.

## Tasks

- [ ] **T1 API: remove the unreferenced recipe service functions.** Route: direct inline (mechanical deletions in files already mapped by a read-only explorer). Delete `RecipeService.list_recipes/1`, `create_recipe/2`, `search_recipes/2`, `favorite?/2`, `list_ingredients/0`, `find_ingredients_by_names/1`, their two private serializers, the six `RecipeRepo` functions they alone called and the tests that only named them. Add a test that a favorite added through `POST /api/me/favorites` is served by `GET /api/planning/favorites`.
- [ ] **T2 Mobile: delete the flat recipe type, its converter and the flat recipe fixtures.** Route: delegated direct (one writer; several non-trivial files). Delete `MasterRecipe`, `CustomizedRecipe`, `RecipeIngredient`, `RecipeStep`, `recipeFromMasterRecipe` and its test, `MOCK_MASTER_RECIPES`, the fixture image lookup, and the `recipes` pass-through in the recipe hook, the home feature and the plan store.

## Acceptance criteria

- The old flat mobile recipe type and its converters are deleted.
- The mobile local chat store and the mock recipe fixtures used by the recipe feature are deleted.
- Recipe service functions with no route and no caller are deleted; the planner's favorites read keeps working.
- API and app suites green.

## Checks

- API: `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo`, `mix test`, `mix dialyzer` compared against the local baseline of `main`.
- Mobile: `npm run lint`, `npm run typecheck`, `npm test`.

## Progress

Nothing landed yet.
