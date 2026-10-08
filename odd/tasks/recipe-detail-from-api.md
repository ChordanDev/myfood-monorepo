# Feature: recipe detail from the API (R1)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/32 (label `ready-for-agent`, part of spec #4, blocker #11 closed).
Branch: `claude/issue-32-e3aa6a` (from `main` at `f4b849d`).

## Objective

Opening a meal shows the frozen Recipe snapshot served by `GET /api/recipes/:id` in one camelCase shape that every screen uses, cached on the phone by `recipeVersionId`.

## Problem

The route answers the raw decoded snapshot (`recipeSteps`, `recipeIngredients[].ingredient.name`, `prepTimeMinutes`, `cookTimeMinutes`, macros, `accountId`, `version`) and flat errors (`{"error":"not_found"}`, `{"error":"subscription_required"}`). The app never calls it: the recipe screen reads a flat mock recipe (`MasterRecipe`, float `amount`, `estimatedCost` number) from the persisted plan store.

## Scope and constraints

- Expand only. The flat mobile type `MasterRecipe` and the plan store stay; R7 (#38) deletes them and the converter added here. No migration, no new column.
- Access rules unchanged: `RecipeAccess.authorize/1` and `RecipeRepo.get_visible_recipe/2` are not edited.
- `RecipeVersions.decode/1` is not changed; cooking and the calendar read it. The route gets its own projection.
- `theme` is `null` until R2 (#33). No favorites or cooking calls (R3, R4).
- Home and the calendar still run on mock entries (X6, #16), whose recipe ids do not exist on the server.
- RDD is on (global). Review candidate is each work-unit commit, assessed with `--base-ref <last reviewed boundary> --committed-only`. First boundary: `f4b849d`.

## Design

### Decisions taken without the user (ticket is `ready-for-agent`)

1. **Projection is exactly the ticket's list.** `id`, `recipeVersionId`, `successorRecipeId`, `source`, `name`, `description`, `servings`, `durationMinutes`, `ingredients[{ ingredientId, name, category, quantityMilli, unit }]`, `steps[{ order, text, durationMinutes }]`, `estimatedCostCents`, `tags`, `imageUrl`, `theme`. The former keys (`version`, `accountId`, macros, `prepTimeMinutes`, `cookTimeMinutes`, `suitableForSlots`, `recipeSteps`, `recipeIngredients`) leave this route. No client in the repo reads them.
2. **Success wrapper stays** `{ "data": <projection> }`; the mobile API module unwraps it.
3. **`durationMinutes`** is prep plus cook from the snapshot; `null` when both are missing.
4. **`tags` is `[]` and `imageUrl` is `null`**: the Recipe has no such columns and the spec leaves image pipelines out of scope. `theme` is `null`.
5. **`ingredients[].category`** is not in the frozen snapshot and versions are immutable, so it is read live from the Ingredient at request time (one query for all lines). It is an Ingredient attribute, not Recipe version content. An Ingredient that no longer exists yields `null`.
6. **Quantities are not scaled**: the route serves the recipe for its own `servings` (quantity 1), as today.
7. **Errors.** Missing recipe, malformed id and a recipe of another Account answer `recipe_not_found` (404), so existence is not revealed, as today. A failed `RecipeAccess.authorize/1` answers `forbidden` (403) in place of the flat `subscription_required`. `recipe_not_found` is a new allowlisted code in `ApiError` and in the mobile allowlist, kept in lockstep.
8. **Cache.** A Recipe row has exactly one immutable Recipe version (unique index on `recipe_versions.recipe_id`; a correction creates a successor Recipe row), so `recipeId -> recipeVersionId` never changes. The mobile cache stores snapshots by `recipeVersionId` and keeps that index, so a recipe opened by id is fetched once. Known limit: a cached snapshot keeps the `successorRecipeId` it was fetched with.
9. **Mock entries.** A recipe id owned by the local plan store is converted to the new shape by a converter (deleted by R7) and never hits the network; any other id is fetched. The screen renders only the new shape.
10. **Frozen payload fixture** lives in the mobile recipe feature. The API route test asserts that its response has exactly the fixture's key sets (top level, ingredient, step), so the fixture cannot drift from the route.

### API

- New projection function for the route (in `RecipeService` or a small module next to it), fed by `RecipeVersions.freeze/1` + the stored snapshot + the Recipe row (`source`, `superseded_by_id`).
- `RecipeController.show/2` renders errors through `conn |> ApiError.error(:code)`.

### Mobile

- `Recipe` type (`RecipeSnapshot` shape) in the recipe feature; `recipeApi.getRecipe(id)`; a persisted cache store keyed by `recipeVersionId` with the id index and in-flight de-duplication.
- `formatQuantityMilli(quantityMilli, unit)` and a cents formatter, client side.
- `useRecipeScreen` resolves the recipe through the cache (loading and error states), the screen and its cards read the new shape.

## Tasks

- [x] **T1 API: snapshot projection and envelope on `GET /api/recipes/:id`.** Projection, `recipe_not_found` code (API and mobile allowlists), `forbidden` on failed access, frozen payload fixture, route tests (catalog and `ai_generated`), integration guide. Route: delegated (2+ non-trivial files).
- [x] **T2 Mobile: recipe type, API module and version cache.** `Recipe` type, `recipeApi`, cache store, cache test proving the same version is not refetched. Route: delegated.
- [x] **T3 Mobile: recipe screen renders the snapshot.** Converter from the flat type, quantity and cost formatting, hook and components on the new shape, screen test against the fixture (catalog and `ai_generated`). Route: delegated.

## Acceptance criteria (from the ticket)

1. Route responds with the snapshot projection, access rules unchanged; `recipe_not_found` / `forbidden` in the envelope. (T1)
2. A new mobile recipe type matches that shape and the recipe screen renders it with client-side quantity formatting. (T2, T3)
3. An `ai_generated` recipe from a Scheduled meal opens identically to a catalog one. (T1, T3)
4. Recipe screen tested against the frozen payload fixture; a cache test proves the same version is not refetched. (T2, T3)

## Checks

- API, from `apps/api`: `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix test`. Isolated database: `MYFOOD_TEST_DATABASE=myfood_test_issue32 MYFOOD_TEST_DB_USERNAME=<local role> MYFOOD_TEST_DB_PASSWORD=`.
- Mobile, from `apps/mobile`: `npm run lint`, `npm run typecheck`, `npx jest --ci`.

## Delivery

Forecast: about 700 authored changed lines over three work-unit commits (T1 about 250, T2 about 200, T3 about 250), above the 400-line budget. Strategy `ask-on-risk`; chain strategy `stacked-to-main`, chosen by the user at delivery (see the delivery record). The real count was about 2,400: the test matrices dominate and nothing was compressed to fit. Push and pull requests are the user's decision.

## Progress

| Task | Commit | Evidence | Review |
| ---- | ------ | -------- | ------ |
| T1   | `04da8ea` | RED: 11 failures before implementation (flat error bodies, missing `durationMinutes`, `FunctionClauseError` for `:recipe_not_found`); no RED for the two successor tests. `mix format --check-formatted` ok, `mix compile --warnings-as-errors` ok, `mix test` 1215 passed / 20 skipped / 0 failures, mobile `typecheck` ok, `lint` 0 errors, `jest --ci` 1471 passed. Parent re-ran the two recipe test files: 27 passed. | high (`hot_path` auth types); consent granted; four lenses approved and acknowledged (`review-e19d0945a73eec46`), 8 non-blocking advisories |
| T2   | `b983e77` | RED: suites failed on missing modules, then 8 of 11 failed against no-cache stubs; no real RED for "fetches when the known version is not cached". `typecheck` ok, `lint` 0 errors, `jest --ci` 94 suites / 1482 passed. Parent re-ran the two new suites: 11 passed. | medium (`slice_budget_reached`); consent granted; reliability lens approved and acknowledged (`review-a6e74ce6273773fd`), 7 non-blocking advisories |
| T1b  | `546cb99` | Follow-up of two T1 review warnings, tests only: `estimatedCostCents` 0 without a daily cost; an inactive member answers `account_not_found` (401) from the auth pipeline, so `forbidden` is reachable only through an ineligible Account. Route test file: 10 passed. | reviewed with T3 |
| T3   | `0cd25b0` | RED: 6 failures for the T2 follow-ups, 17 of 21 for the row resolver, 1 for the palette, 11 for servings/duration/mock cost; screen tests were written after the hook and mutation-checked instead. `typecheck` ok, `lint` 0 errors, `jest --ci` 96 suites / 1520 passed. Parent re-ran the recipe feature suites: 14 suites, 203 passed. | medium (`slice_budget_reached`); consent granted; reliability lens approved and acknowledged (`review-8e97bc3f6a6913cf`), 2 non-blocking advisories |

T1 to T3 done; the four acceptance criteria are covered by tests. Next step: delivery, on the user's instruction.

## Notes and follow-ups

- The API CI job does not run when only the mobile fixture changes; the key-set assertion catches drift on the next API change.
- The recipe cache is not cleared on sign-out. No persisted store is today (`AuthContext.signOut` only clears the session), and wiring it means editing the auth context. Cached Account-scoped snapshots stay on the device, reachable only by recipe id. `useRecipeCacheStore.clear()` exists for the ticket that adds a sign-out reset (candidate: X6, #16).
- T1 review advisories (non-blocking, receipt stands): no route test for `estimatedCostCents` 0 without a daily cost; no route test for `forbidden` on a non-member (only the expired trial is covered); a `nil` from `RecipeVersions.freeze/1` is reported as `recipe_not_found`; the catch-all clause comment in `RecipeController.show/2`; `recipe_not_found` lives under auth-named mobile types (`AuthErrorCode`), as every code does since #11.

### Decisions added during T3

11. **Recipe facts.** Servings ("Rinde"), duration ("Tiempo", plain minutes) and cost ("Costo estimado", pesos without decimals) are drawn as rows at the foot of the ingredients card, each only when known. The screen showed none of them before.
12. **Local recipes show no cost.** The flat `estimatedCost` has no stated currency unit (the mocks hold `15.5` and `10.0`), so the converter answers `estimatedCostCents: 0`. A mock recipe looks exactly as it did before this ticket.
13. **Ingredient rows of an API recipe.** Stock and Shopping list state come from the local mock inventory, which does not know server ingredient ids, so every row of an API recipe reads "Falta" and cannot be pressed until Inventory comes from the API. A catalog ingredient counted in another unit than the line is treated the same way.
14. **Themeless recipes** (`theme: null`, every API recipe until R2) draw in the default palette.
15. **T2 review follow-ups applied in T3:** `getRecipe` rejects a 2xx body without `id`, `recipeVersionId`, `ingredients[]` and `steps[]`, so a partial payload is never cached; a load in flight when `clear()` runs does not repopulate the cache.

### Open review advisories (non-blocking, all three receipts stand)

- `useRecipeCacheStore`: the guard that keeps a load started before `clear()` from repopulating the cache is tested through its effect, not through the identity check itself.
- `recipeApi`: the response guard checks `id`, `recipeVersionId`, `ingredients[]` and `steps[]` only; it is not a schema validator, so a payload with a wrong field type inside a line would still be cached.
- Earlier ones are listed under "Notes and follow-ups".

## Delivery record

- Work branch `claude/issue-32-e3aa6a`, on `f4b849d`: `04da8ea` (T1, API), `b983e77` (T2, mobile type, API module, cache), `546cb99` (T1b, API tests), `0cd25b0` (T3, recipe screen), `450c579` (this document). The native reviews recorded above ran on these commits; a fourth one, over the whole branch (`review-70b71303242f0a1d`, four lenses), was approved and acknowledged on `450c579`.
- 2026-10-08: chain strategy `stacked-to-main`, chosen by the user ("as #11"). The commits were cherry-picked onto `main` at `f4b849d` so that T1b sits with T1. Commit identities changed: T1 `04da8ea` is now `24db770`, T1b `546cb99` is `cf99c05`, T2 `b983e77` is `1119985`, T3 `0cd25b0` is `1c767b9`. The tree is the reviewed one plus one sentence of the integration guide.
- Slices, stacked to main, each pull request based on the previous branch: S1 `feat/recipe-detail-api` (T1, T1b, `c674096`), S2 `feat/recipe-detail-cache` (T2), S3 `feat/recipe-detail-screen` (T3, this document).
- `c674096` `docs(api)`: follow-up of a whole-branch review warning. The guide said `forbidden` also covers a User without an active Membership; the auth pipeline answers `account_not_found` (401) first, as the T1b route test shows.
- Review budget: S1 683, S2 434, S3 about 1,400 changed lines, against 400. One slicing pass, one work unit per slice; tests are most of each diff (S3: about 700 lines of tests). Recommended as `size:exception`.
- Whole-branch review advisories still open, none blocking: the recipe cache is not scoped to the Account, is never evicted and never refreshes a cached snapshot (`category` and `successorRecipeId` can go stale); the response guard of `recipeApi` is shallow; `forbidden` is shown on the screen as a retryable failure; the `nil` branches of `RecipeService.get_recipe/2` have no test of their own.
