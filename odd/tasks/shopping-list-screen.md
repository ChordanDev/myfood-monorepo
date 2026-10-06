# shopping-list-screen

Issue: ChordanDev/progra-3-front#44. Branch: `feat/shopping-list-screen` (from `origin/Develop`).

## Objective

Replace the placeholder behind the **Carrito** tab with the real shopping list screen: items derived from the plan, grouped by category or by supermarket, with purchase state that feeds the inventory.

## Problem and why

`app/(tabs)/cart.tsx` renders `PlaceholderScreen`. There is no shopping store, service or derivation; only an unused `ShoppingListItem` type. The planner and inventory already exist, so the list is the missing link between "what I planned" and "what I have".

## Scope

- Header: date pill ("Hasta 12 Oct") and a two-option switcher **Por categoría / Por súper**.
- `colorLight` cards per group with "Marcar todos"; each row shows quantity, name, supermarket and best price; purchased rows are struck through and dimmed.
- "Agregados a mano" section with manual add.
- Marking an item purchased moves it into the inventory; unmarking reverts it.
- States `needed` / `purchased` / `removed` visible in the UI.

Out of scope: estimated total, integrated cart, a real price backend, a date picker for the pill, refactoring `FoodTypeSwitcher` onto the new shared switcher.

## Constraints

- No color literals. Colors come from `useRecipeTheme()`; tints from `withOpacity`; palette transitions from `useAnimatedThemeStyle`. No token is added, renamed or removed. See `docs/THEMING.md`.
- Do not copy the known violations (`PlaceholderScreen`, `src/constants/theme.ts` `COLORS`, `src/features/recipe/*`).
- Feature layout mirrors `src/features/home` (`components/`, `domain/`, `hooks/`, `screens/`, `types/`, barrels).
- Tests use `react-test-renderer` with `jest.mock` of the theme context, as the rest of the repo does. `@testing-library/react-native` is not installed and is not added.
- UI copy is Spanish and inline, matching the mockup `docs/design/screens/Compras.dc.html`.
- RDD is off for this clone (`clone_local`); no native review is started. Verification tier comes from `gentle-ai review assess` per work unit.

## Assumptions taken where the issue, mockup and PRD are silent

Each is a default, reversible in its own task. The owner may overrule any of them.

1. **Confirmed plan** = `useMealPlanStore.entries` that are not cooked. No `MealPlan` status exists in code.
2. **"Hasta" date** = the last date in the plan. The pill is display-only; no picker is designed.
3. **Shortfall only** (PRD_INVENTORY_SHOPPING): amount to buy = planned amount minus inventory. Ingredients fully in stock are not listed.
4. **Purchased rows stay visible** with their original quantity until their recipes are cooked. Unmarking removes the same amount from the inventory, clamped to what is left.
5. **Category enum is not changed.** The screen maps the existing `Ingredient.category` values to display labels and a fixed order. The PRD enum differs; aligning it is a separate decision.
6. **Prices and supermarkets are mocked** in `src/mocks`, behind one lookup, because no backend contract exists. Best price = cheapest offer for the listed quantity. No offer shows "Sin precio".
7. **"Por súper"** (not drawn in the mockup) reuses the same card, grouped by the supermarket holding the best price; items without an offer go under "Sin súper".
8. **"Marcar todos"** marks every visible `needed` row of its group. When all are already purchased it shows checked and a tap unmarks them.
9. **Manual add** (not drawn): a plus button in the "Agregados a mano" header opens a sheet with a name field. Manual items have no quantity or price and never merge with planned ones. Marking them purchased does not touch the inventory, which is keyed by `ingredientId`.
10. **Removed** (not drawn): a long press removes a row; it leaves the list and the counter. A footer line "N quitados · Restaurar" brings them back.
11. **Palette**: the screen inherits the globally active palette.
12. **Units**: `gramos` -> g (kg from 1000), `mililitros` -> ml (L from 1000), `unidades` -> u. Prices use the es-AR thousands dot and no decimals.

## Delivery

- Strategy: `ask-on-risk`. Forecast is about 1500 authored lines, over the 400 budget; the owner was asked on 2026-10-06.
- Owner decision (2026-10-06): one branch, no pull requests. Work-unit commits land on `feat/shopping-list-screen`; the owner merges it into `Develop` at the end.
- First review boundary: branch point `origin/Develop`.

## Tasks

- [x] **T1 — Domain model and derivation.** Commit `b2dc984`. Shopping types, pure derivation from plan + recipes + inventory + purchase records (aggregate repeated ingredients, shortfall, "Hasta" filter), grouping by category and by supermarket, quantity / price / date formatters. Colocated unit tests, RED first. Route: delegated writer (2+ non-trivial files).
- [x] **T2 — Store and mock offers.** Commit `495a39e`. Route: delegated writer. `useShoppingListStore` (persisted purchase records, removed ids, manual items), mock supermarket offers, purchase and unmark side effects on `useInventoryStore`, bulk mark. Store tests, RED first.
- [x] **T3 — Shared `SegmentedSwitcher`.** Commit `ff620ec`. Generic two-or-more option switcher in `src/components` mirroring the `FoodTypeSwitcher` recipe. Component test. Route: delegated writer (component + test + Reanimated mocking research).
- [x] **T4 — Carrito screen.** Commits `12c102e` and `76fb617` (correction). Route: delegated writer. Header (date pill + switcher), title and counter, group cards with "Marcar todos", item rows with checkbox and purchased look, both grouping modes, empty state, route wiring. Component tests for the item row and "Marcar todos".
- [x] **T6 — Feature-first relocation.** Commit `9c21ee2`. Route: delegated writer. Added on 2026-10-06 at the owner's request ("todo hecho como feature first"): the store, the mock offers and the shopping types moved from `src/store`, `src/mocks` and `src/types/domain.ts` into `src/features/shopping`; the root barrel exports only `ShoppingScreen`; `src/README.md` states the convention. No behavior change (44 suites / 539 tests before and after).
- [x] **T5 — Manual items and removal.** Commits `23a8691` and `c40931f` (correction). Route: delegated writer. "Agregados a mano" card, add sheet, long-press removal, restore footer. Component tests. Empty state must also consider manual items.

## Checks

- `npx jest <touched paths>` during a task; `npm test` at task close.
- `npx tsc --noEmit`.
- `npm run lint`.
- `rg` for color literals in `src/features/shopping` and the new shared component: none allowed.
- Visual check in the iOS simulator against `Compras.dc.html` once T4 lands.

## Progress and evidence

Baseline: `npx tsc --noEmit` fails on `Develop` with 22 errors in four auth/services test files (missing Node globals). A check passes when no error is reported outside them.

### T1 — `b2dc984`

- RED observed per slice (module missing, then 14 failing assertions on derivation), GREEN at 43 tests; 52 after the correction.
- Risk tier `high` (RDD off) -> writer self-verification plus an independent verifier.
- Verifier: one should-fix and three minors, all corrected in one round, RED first (7 failing):
  - a purchase record hid a real shortfall when the plan grew or the record was stale. Now the shortfall is computed first; a row is `purchased` only while a record exists and the stock covers the plan;
  - an unknown category fell out of "Por categoría"; it now lands in "Otros";
  - rows are sorted by name inside every group, so cooking a meal does not reorder them;
  - one rounding precision (two decimals) for derivation and display, so nothing lists as "0 ml".
- Checks: `npx jest src/features/shopping` 52 passed (re-run by the parent); `tsc` 0 errors outside the baseline; `eslint` and `prettier` clean; no color literal.
- Consequence for the store: a re-mark overwrites the purchase record instead of accumulating, so one unmark undoes one mark.

### T2 — `495a39e`

- RED observed per behavior; the tests that passed without new code were checked with 9 mutants of the store (all killed).
- Offers live in store state but are left out of the persisted slice (`partialize`), so replacing the mock file never needs a version bump. This is the only store using `partialize`.
- Manual ids are `manual:<n>`; uniqueness relies on manual items being flagged `removed`, never hard-deleted.
- Risk tier `high` (RDD off) -> independent verifier: no blocking defect (300 random walks of mark / unmark / cook / remove / restore, no inventory drift). Two minors corrected in one round: a removed planned item is now a no-op for mark and unmark (RED first), and reference assertions guard against in-place mutation (proven with 8 mutants).
- Known limit, handled at the call site in T4: the store trusts the derived row it receives, so the same stale `needed` row marked twice would stock twice. The screen hook re-derives the row from fresh store state at action time.
- Known limit, not reachable from today's UI: purchase records are not pruned when an ingredient leaves the plan.
- Checks: `npx jest src/store src/features/shopping` 113 passed; `tsc` 0 errors outside the baseline; `eslint` and `prettier` clean.

### T3 — `ff620ec`

- RED observed test by test for labels, selected state, `onChange` and the selected-option guard.
- Risk tier `high` (RDD off) -> independent verifier: no blocking defect, one should-fix and one minor, both corrected in one round:
  - the indicator had no test (the suite stayed green with it deleted). Six tests now assert its geometry, tints and slide config; each was proven by a mutation of the component;
  - a resized selected option made the pill slide from stale geometry. It now slides only when the selection changes (RED first).
- Verifier confirmed from source that leaving `overflow: 'hidden'` off the container is correct: on iOS it would clip the shadow `ShadowSurface` draws. `FoodTypeSwitcher` sets it and probably loses its own iOS shadow; not touched, out of scope.
- Checks: 12 tests passed (re-run by the parent); `tsc` 0 errors outside the baseline; `eslint` and `prettier` clean; no color literal.
- NOT verified on a device: the rendered look and the animation.

### T4 — `12c102e`

- RED observed per behavior; batches that went green together were checked with 34 mutants (all killed). The stale double toggle went RED against a naive hook (stocked 400 instead of 200), GREEN after re-deriving from `getState()`.
- Checks: `npx jest` 44 suites / 539 tests; `tsc` 0 errors outside the baseline; `eslint` and `prettier` clean; no color literal in the feature.
- Risk tier `high` (RDD off) -> independent verifier: no blocking defect; hook, selectors, tab-bar clearance, color rules and mockup metrics traced and correct. Findings corrected in one round (`76fb617`, RED first or mutant-proven, 44 suites / 551 tests): the row's accessibility label hid the supermarket and price; the tests could not see a missing `immediateKey`; "Por categoría" wraps on screens of 360 pt or narrower (computed from font metrics); the "Marcar todos" hit slop overlapped the first row; two test gaps.
- Run on web (`expo start --port 8082`, 390x844, DOM inspected, no screenshot): the screen renders the mock plan ("Hasta 9 Oct", 4 ítems, Verduras / Proteínas / Despensa), tokens resolve to the palette, a row toggle strikes the name and updates the counter with the right singular, "Marcar todos" marks and unmarks a group, "Por súper" regroups as Carrefour / Coto / Día / Sin súper, no console error.
- Web-only limitation, not a defect of this feature: on web the dimmed text and the checked fill do not repaint after a toggle, because `useAnimatedThemeStyle` applies an `immediateKey` change only through React state. Home's `DayCell` uses the same pattern. On iOS they repaint (see below).

### T6 — `9c21ee2`

- Behavior-preserving move; totals identical before and after (44 suites / 539 tests). `rg` confirms nothing outside `src/features/shopping` references the feature's internals and no internal module imports through the root barrel.
- Follow-up for the owner, not done here: older shared stores (`useMealPlanStore`, `useInventoryStore`) and `src/mocks/domainMocks.ts` still live in the global folders. The Inventario work (issue #45, worktree `inventory-screen`) may move `useInventoryStore` into its own feature; this feature imports it from `@/store`, so the merge of both branches must reconcile that import.

### T5 — `23a8691`

- RED observed per behavior; 55 mutants (53 killed, 2 explained). Checks: 46 suites / 602 tests; `tsc` 0 errors outside the baseline; `eslint` and `prettier` clean; the only literal is the modal backdrop copied from `EatTodaySheet`, which `docs/THEMING.md` allows.
- Risk tier `high` (RDD off) -> independent verifier: no blocking defect. One should-fix (a second submit could add the item twice while the sheet closes) and one minor (a purchased manual item restored as `needed`), both corrected in one round (`c40931f`, RED first or mutant-proven; 46 suites / 614 tests, `npm run lint` 0 errors). A removed manual item now persists an optional `statusBeforeRemoval`; the persist version stays at 1.
- Open product decision, not implemented: removed manual items are kept forever so their ids stay unique, and "Restaurar" brings all of them back. A purge rule (and a persisted id counter) needs the owner's call.

### iOS simulator check (2026-10-06, iPhone 17, iOS 26.2, debug build pointed at this branch's Metro on port 8082)

Observed in screenshots:

- The screen matches the mockup recipe: date pill "Hasta 9 Oct", switcher with the pill on "Por categoría", "COMPRAS" with the counter on the same baseline, `colorLight` cards with shadows, the tab bar clear of the content.
- Purchased look repaints on iOS: struck-through and dimmed name, filled `primaryAccent` checkbox, "Marcar todos" checked when the whole group is purchased, counter "4 ítems · 2 comprados". Purchases survive a reload (persisted).
- The add sheet opens with the input focused and "Agregar" dimmed; typing enables it; adding lists the item under "Agregados a mano" with "Sin precio" and the counter goes to 5.
- A long press removes the row without toggling it and shows "1 quitado · Restaurar".

NOT verified on any device:

- "Por súper" on iOS (verified on web only), and the restore press.
- The panel lift over the software keyboard (the simulator had a hardware keyboard attached, so none was shown), on iOS and above all on Android inside a `Modal`; Android autofocus inside the dialog.
- Android as a whole, VoiceOver / TalkBack, haptics, and the switcher label on a 360 pt wide screen.

## Next step

Owner: try the screen on Android (keyboard over the add sheet first), decide the purge rule for removed manual items, and merge `feat/shopping-list-screen` into `Develop`. The price-per-supermarket contract is still undefined in `meal-app-docs`; `src/features/shopping/mocks/shoppingMocks.ts` is the single file to replace when it exists.
