# recipe-shopping-link

- **Issue:** ChordanDev/progra-3-front#56
- **Branch:** `feat/recipe-shopping-link` (from `origin/Develop` @ c5661f2)
- **Worktree:** `../my-expo-app-worktrees/recipe-shopping-link`
- **Engram mirror:** `odd/recipe-shopping-link/tasks`
- **Delivery strategy:** `ask-on-risk`. Forecast is about 600 authored lines, mostly tests, above the ~400 budget. Work-unit commits are kept per task. The owner's practice in this repository is a direct `--no-ff` merge into `Develop` on confirmation, without a pull request; nothing is pushed or merged without that confirmation.

## Objective

Make the recipe screen and the shopping list agree: an ingredient the recipe is missing reads its state from the derived shopping list, and "agregar" (on the row or from the chat) changes that list.

## Problem and why

Issue #49 shipped "Falta · agregar" and the chat's "Sí, agregalo" writing to a store owned by the recipe (`src/features/recipe/store/useShoppingRequestsStore.ts`), a seam left while the shopping list was being built. The Carrito never reads it, so the row flips to "En la lista" and nothing changes on the list. The shopping list of #44 is derived: one planned item per ingredient (`planned:<ingredientId>`), with the amount the uncooked plan needs minus the linked stock. A missing ingredient of a planned meal is therefore already on the list.

## Scope

- Ingredient rows take their list state from the derived shopping list.
- "Falta · agregar" and the chat's confirm action put the ingredient on the shopping list.
- The shopping feature exposes the minimum public surface the recipe needs, including a per-item restore.
- `useShoppingRequestsStore` is deleted.
- Local only: no backend call. The sync queue of `PRD_INVENTORY_SHOPPING.md` §4.1 is a later layer.

Out of scope: backend sync, real assistant replies, quantities on manual items, any change to the Carrito screen.

## Constraints

- Feature-first: the recipe imports shopping only through `@/features/shopping`. Shopping never imports the recipe.
- Colors only from the active palette (`docs/THEMING.md`). No copy change beyond what the states below need.
- The Carrito's behavior and its tests stay as they are; only additions to the shopping store and barrel.

## Design decisions

1. **Row states.** `in_stock` → "En stock". Missing and listed → "En la lista", not pressable. Missing and not listed → "Falta · agregar".
2. **Listed** means: the ingredient's planned item is `needed` or `in_cart`, or a listed manual item carries the ingredient's name (compared trimmed and case-insensitively).
3. **"agregar" has one meaning**, on the row and from the chat: if the ingredient's planned item is `removed`, restore that item; otherwise add a manual item with the ingredient's name, unless a listed manual item already has it. A manual item is a name only (`PRD_INVENTORY_SHOPPING`), so no quantity travels.
4. **Chat offer.** The mock keeps offering the first missing ingredient that is not listed and is in the catalog. A listed ingredient is never offered.
5. **"Hasta" range.** Not applicable today: `useShoppingList` shows the range as a label but derives the list from the whole plan, so the recipe derives it the same way.
6. **Cooked or skipped meals.** Their ingredients are not in the derived list, so their missing rows read "Falta · agregar" and add a manual item. Not specialised here.
7. **Per-item restore** is a new store action; `restoreRemovedItems` (all at once) is untouched.
8. **Legacy storage key** `shopping-requests-storage`: removed only if the app already has a startup place for storage clean-up; otherwise left and reported, since no cleanup hook should be invented for it.

## Tasks

- [x] **T1 — Shopping public surface.** Per-item restore in `useShoppingListStore`; a pure resolver for an ingredient's list state; one action that puts an ingredient on the list (restore or manual add); a hook exposing the derived items; all exported from `@/features/shopping`. Store and domain tests, RED first. Route: delegated writer (with T2). Commit `3ec8549`.
- [x] **T2 — Recipe reads the list.** Rows and chat use the shopping surface; `useShoppingRequestsStore` and its tests deleted; recipe tests updated. RED first. Commit `7faa86c`.
- [x] **T3 — Docs.** Record progress and evidence here.

## Acceptance criteria

- [x] A missing ingredient of a planned recipe reads "En la lista" on opening the recipe, with no interaction.
- [x] An ingredient removed from the Carrito reads "Falta · agregar" and comes back to the Carrito when pressed.
- [x] "Sí, agregalo" for an ingredient the plan does not cover leaves it visible under "Agregados a mano".
- [x] No use of `useShoppingRequestsStore` remains.
- [x] The recipe imports shopping only through `@/features/shopping`.
- [x] Tests for the row state against the derived list and for both actions.

## Checks

- `npx jest src/features/recipe src/features/shopping` — green.
- `npm test` — no new failures (in a sibling worktree `src/services/__tests__/authErrorCodeContract.test.ts` fails by location: it resolves the backend as a sibling folder).
- `npx tsc --noEmit` — 0 errors, as on `Develop`.
- `npm run lint` — 0 errors.
- `rg` for color literals in touched feature code — only the allowed ones.

## Progress and evidence

- 2026-10-07: worktree created from `origin/Develop` c5661f2. Exploration by the parent (one CodeGraph call): the planned id scheme, the derivation without `untilDate`, the store's all-at-once restore and the screen-only barrel.

- 2026-10-07: T1–T2 done by one delegated writer, RED observed before each GREEN. Public surface added to `@/features/shopping`: `getIngredientListState`, `useShoppingListItems`, `addIngredientToShoppingList`, types `IngredientListState`, `ListedIngredient`, `ShoppingListItem`. The store gained `restoreItem`; the derivation shared by the Carrito and the recipe is `deriveFullShoppingList`. `useShoppingRequestsStore` and its test are deleted.
- Checks: `npx jest src/features/recipe src/features/shopping`: 25 suites, 484 tests passed (re-run by the parent; 456 before). `npm test`: 1239 passed, 2 failed, both the known by-location failures in `authErrorCodeContract.test.ts`. `npx tsc --noEmit`: 0 errors. `npm run lint`: 0 errors. No color literal added. Existing Carrito assertions untouched. `gentle-ai review assess` on `fef51a5..7faa86c`: `medium`, `slice_budget_reached`; no native review because RDD is off for this clone.
- Simulator (iPhone 17 Pro, Metro 8085): a planned meal opens with "Tomate · En la lista" and the Carrito lists it; after removing it in the Carrito the recipe reads "Falta · agregar". The press on "agregar", the manual-item path and the chat path were **not** checked on the simulator, which was being used at the same time; they are covered by screen tests against the real stores.

## Known limits

- An ingredient outside the catalog reads a plain "Falta" and cannot be added (it has no name to list).
- The acceptance criteria are checked from tests; only the first one and half of the second were also seen on the simulator.
- The persisted key `shopping-requests-storage` stays orphaned on devices that already have it: the app has no startup place for storage clean-up and none was invented.
- A planned id left in `removedIds` after its row disappeared (the plan changed) is treated as absent: "agregar" adds a manual item and the stale id stays.
- `RecipeChatOffer.amount` and `unit` are still produced but no longer consumed, since manual items are names only.
- The name written to the list is the catalog name ("Pollo (Pechuga)"), not the sentence-cased one the recipe displays.

## Next step

Owner confirms the merge into `Develop`.
