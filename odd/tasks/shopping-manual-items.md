# Feature: manual Shopping items and removed or restored planned items (S2)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/40 (parent #5, blocked-by #39 closed, blocks #48).
Branch: `feat/shopping-manual-items` from `origin/main` at `7b684c7`. Worktree `.claude/worktrees/issue-40`.

## Objective

A User adds "dish soap" as a manual Shopping item shown apart, removes a planned item they will not buy and restores it later. Manual items survive re-planning.

## Scope and constraints

- Shopping items gain `source` (`planned_meal | manual`) and manual fields: name, optional ingredient, quantity, unit (default 1 unit).
- `POST /api/shopping-items/manual` creates one. `DELETE /api/shopping-items/:itemId` deletes manual only (`shopping_item_not_manual` otherwise, `shopping_item_not_found` for unknown ids).
- `POST /api/shopping-items/set-status` with `removed | needed` excludes or re-includes a planned item from Shortage computation. A rebuild preserves `removed` while the meal still needs the Ingredient.
- Manual items are never merged and untouched by a rebuild (confirmed re-plan or range replace).
- New error codes join the `ApiError` type, `@codes`, moduledoc and the mobile allowlist in the same commit. `frontend_integration_guide.md` is updated.
- Mobile: add, remove and restore wired and tested against fixtures.
- Out of scope: Cart behaviour for manual rows beyond not crashing (#48), inventory.
- Use glossary terms: Shopping item, Shortage, Allocation, Cart.
- Migration version: 14 digits, later than `20261009120000`.
- RDD on. Review candidate per work-unit commit, first boundary `7b684c7`. Test DB: per-worktree name, `MYFOOD_TEST_DB_USERNAME` override.

## Design notes

- Manual rows: `scheduled_meal_id`, `planned_date`, `ingredient_id` nullable; `name` required for manual; open-planned unique index stays scoped to planned rows.
- `removed` status added to the enum. `list_status/1`, `planned_row`, `list_open_items_with_context`, totals and counters handle it.
- A re-plan replaces meals (new ids, FK cascade), so `removed` is carried by a snapshot of `{planned_date, ingredient_id, unit}` taken before the delete and reapplied after re-derivation. Keys no longer needed are dropped.
- `delete_pending_for_window` and `delete_open_items_for_meal` are scoped to `source = planned_meal`.

## Tasks

- [x] T1 API persistence: migration, schema, status/source, manual create and delete endpoints, error codes, guide. Tests first. Commit `91b89f1`.
- [x] T2 API set-status and Shortage exclusion, list read serializes manual and removed. Commit `9161a85`.
- [x] T3 API rebuild: manual untouched and removed preserved across confirmed re-plan and range replace. Commit `657ec05`.
- [x] T4 Mobile API client, types, store mutations, hook wiring, tests against fixtures. Commit `02b6dde`.
- [x] T5 Mobile screen: add sheet (name, quantity, unit), remove, restore wired in `ShoppingScreen`. Commit `d0d135d`.

## Progress and evidence

Created after exploration. Route per task: T1-T3 delegated writer (multi-file, preparation reading), T4-T5 delegated writer.

### API half (T1-T3), observed 2026-10-09

- Route: delegated writer (multi-file). Tests per task: `shopping_manual_items_test.exs` (controller, T1-T3 range replace), `server_test.exs` (confirm), `shopping_test.exs` (changesets, DB shape check), `shopping_repo_delete_pending_test.exs`, `api_error_test.exs`.
- Checks from `apps/api`: `mix test` 1497 passed, 20 skipped; `mix format --check-formatted` clean; `mix compile --force --warnings-as-errors` clean. From `apps/mobile`: `authErrorCodeContract.test.ts` 9 passed.
- Design deviations: removed items are keyed by `{planned_date, slot, ingredient_id, unit}` (slot added so removing lunch does not remove dinner); extra codes `shopping_item_not_planned` (422) and `shopping_item_in_cart` (409); `Cart.purchase` closes a manual item without an Ingredient as bought, with no Inventory movement (full manual checkout stays #48); the range replace is orchestrated by `ShoppingService.replace_scheduled_meals_for_range/4`, which `CalendarController.replace_range` now calls.
- Known limits: a single-slot recipe swap (`delete_open_items_for_meal`) drops the meal's removals; the removal snapshot of a range replace is read just before the replace, not in its transaction.

### Mobile half (T4-T5), observed 2026-10-09

- Route: delegated writer. Checks from `apps/mobile`: `npx jest` 1767 passed (109 suites); `npm run typecheck` clean; `npm run lint` 0 errors (4 warnings that predate this work, in `AddCircleButton.test.tsx` and `FoodCard/icons.tsx`) and Prettier clean.
- T4 tests: `shoppingApi.test.ts` (requests and parsers of add, delete, set-status), `useShoppingListStore.test.ts` (change then re-read, refusal, stale list re-read, read race, owner change), `useShoppingList.test.tsx` (manual items, removed count, remove, restore, error message). Fixtures gained `MANUAL_DISH_SOAP`, `SHOPPING_LIST_WITH_MANUAL_AND_REMOVED` and response builders.
- T5 tests: `ShoppingScreen.test.tsx` (add, delete, remove, restore, refused change, saving indicator), sheet, row, manual card and load error tests.
- Design: a change goes to the server and, once accepted, the list is read again (the server owns the list; nothing is derived on the device). A refusal that says the list is stale (`shopping_item_not_found`, `_not_manual`, `_not_planned`) also re-reads. Writes are never retried by the transport (an add whose answer was lost must not repeat).
- Deviations: UI copy stays in Spanish like the rest of the screen. The add sheet is name, quantity and unit (u, g, ml) with no Ingredient picker, so manual items are created without `ingredientId`. `ShoppingItemRow` is now removable without a toggle (long press only, no checkbox), because marking a row is #48; manual lines share the `ShoppingListLine` type (`ingredientId` is nullable) and the legacy `ManualShoppingListItem` is gone, so manual rows read "1 u · Name".
- Known limit: a planned line read per ingredient is `removed` only when every allocation is; removing by meal and then switching to per ingredient can leave a partly removed line that the restore line (which restores removed lines) does not reach.
