# Feature: Shopping removals kept per meal and Ingredient, and a read that corrects pending quantities (issues #334, #277)

Branches: `feat/334-shopping-removals` from `main` at `1f80a59f`, then `fix/277-read-reconciles-pending` stacked on it. One PR per issue.
Delivery: stacked PRs, not merged by the agent. Test runner: `mix test` in `apps/api`.

## Specs

Quoted from the owner's comments of 2026-10-15.

- **S1 (#334)** "A new table (for example `shopping_removals`) holds one row per (Scheduled meal, Ingredient), with a foreign key to the Scheduled meal and `on_delete: :delete_all`, unique on that pair. Migration version is 14 digits (`YYYYMMDDHHMMSS`, see #315)."
- **S2 (#334)** "Removing a Shopping item writes the removal row; the item is shown as `removed` as today."
- **S3 (#334)** "Deriving Shopping items (read and plan-confirm rebuild) marks as `removed` any derived item whose (Scheduled meal, Ingredient) has a removal row. When stock covers the Ingredient and no item is derived, the removal row stays."
- **S4 (#334)** "`restore_removed_items/4` is replaced by reading the removal rows; no removal depends on a `pending` item existing."
- **S5 (#334)** "Restoring an item deletes its removal row; it comes back as `needed` when there is a Shortage, and nothing is shown when there is none."
- **S6 (#334)** "A swap of the meal and a finished Cooking session drop the removal rows together with the meal's items."
- **S7 (#334)** "Tests via the public interface: remove → stock covers the Ingredient → stock used up → item still `removed`; restore → `needed`; swap drops the removal; finished Cooking session drops it."
- **S8 (#334)** "`docs/GLOSSARY.md` mentions that a removal is kept per Scheduled meal and Ingredient."
- **S9 (#277)** "On a read, a `pending` planned item whose computed Shortage quantity differs gets the computed `quantity_milli`."
- **S10 (#277)** "On a read, a `pending` planned item whose Shortage is now zero is deleted (it is not marked `removed`; a later Shortage derives it again as `needed`)."
- **S11 (#277)** "`in_cart`, `removed`, bought and manual items are never changed by a read."
- **S12 (#277)** "The update runs under the same locks on the meals' dates that the derivation already takes; a read concurrent with a plan confirm rebuild leaves one consistent set of items (test with real connections)."
- **S13 (#277)** "When #334 lands, an Ingredient removed by the User stays removed: the read never re-creates or updates an item for a (Scheduled meal, Ingredient) with a removal."
- **S14 (#277)** "Tests via the public interface: inventory grows after derivation → the pending quantity shrinks; inventory covers it → the pending item is gone; an `in_cart` item keeps its quantity."

## Tasks

- [x] **T1** S1-S8. `shopping_removals` table and `ShoppingRemoval` schema; set-status writes and deletes rows; read and rebuild mark items from the rows; range replace carries rows to the new meals that still use the Ingredient; `delete_open_items_for_meal/2` drops them. Route: inline (no writer reason). Commit `c661be82`.
- [x] **T2** S9-S14. Read reconciles `pending` planned items under the meal-date locks. Route: inline. Commit: the `fix(api)` commit of #277.

## Log

- **L1** (2026-10-18, user) "Implement these issues of ChordanDev/myfood-monorepo in this order, one pull request per issue, each stacked on the previous one: 1. #334 "Shopping: keep a removed item removed when stock covers its Ingredient" 2. #277 "Shopping list read never corrects the quantity of a stored open item" … Open the pull requests and report the links. Do not merge."
- **L2** T1 decisions. Rows carry `account_id` too, so every query scopes by Account like the items. A removal marks the item of every unit of its pair (the old key held the unit). A range replace gives meals new ids, so the cascade deletes their rows; the service reads the keys (date, slot, Ingredient) first and stores rows again for the new meal whose recipe still uses the Ingredient, whatever the stock covers. The plan confirm inserts new meals and keeps the ids of the others, so the rebuild only marks items. A derivation marks after its insert, inside the lock transaction; it does not mark on reads that store nothing.
- **L3** T1 checks: `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix test` 2165 passed, 34 skipped; `test/support/issue38_concurrency_runner.exs` 32 passed. The new removal-versus-move test failed first with `deadlock_detected` (set-status locked the items, then the removal's foreign key check waited for the meal); set-status now locks the items' meals `FOR KEY SHARE` before the items.
- **L4** T2 decisions. The read takes the slow path when a line is missing or a `pending` item differs from its line. Under the lock transaction it locks every meal it read `FOR KEY SHARE`, keeps the meals still on the date it loaded, locks their `pending` items `FOR UPDATE` in id order (items of a removed pair excluded), updates or deletes them, then inserts the missing lines and marks removals. The plan confirm wipe (`ShoppingRepo.delete_pending_for_window/3`) now locks its items in id order before deleting, so it cannot deadlock with a read that holds one item and waits for another.
- **L5** T2 fixtures. Tests that stored `pending` items for an Ingredient the meal's recipe does not use, or with another quantity, now give the recipe that need (`CartFixtures`: 500 g a serving, today's dinner two servings), because a read deletes or corrects those items. `ShoppingPurchasedTest` keeps its intent with stock used up after the purchase and an Ingredient of its own for the manual rice; the partial-purchase-versus-finish test now expects the finish to use the bought 300 g.
- **L6** T2 checks: `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix test` 2171 passed, 34 skipped; `issue38_concurrency_runner.exs` 32 passed. The six new derivation tests failed first (stale quantities kept, covered items kept, the read never waited on the rebuild's wipe).
- **L7** Advisory, not changed: a planned key with a `pending_delivery` twin (online partial purchase not yet stocked) is reconciled to the whole Shortage, the same quantity the plan confirm rebuild writes for it.
