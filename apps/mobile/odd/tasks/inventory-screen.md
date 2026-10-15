# inventory-screen

> Superseded on 2026-10-15 (ChordanDev/myfood-monorepo#116). This describes the first
> Inventory screen, not the current one. The screen now lists the lots read from
> `GET /api/inventory`, grouped by freshness (Vencidos, Por vencer, En buen estado), what to
> use first on top. Quantities are exact, so there is no "aprox." pill, and there are no
> category groups. The edit button of a row opens the sheet that sets the quantity and disposes of the
> lot; there is no trash button on the row. "Agregar producto" picks the Ingredient from
> the API catalogue (`GET /api/ingredients`), and the voice sheet takes a typed transcript.
> The subtitle reads "Revisá primero lo de arriba: lo vencido y lo que vence pronto.". The code and
> its tests in `src/features/inventory` are the reference.

Issue: ChordanDev/progra-3-front#45 — "Inventario: pantalla Lista con
categorías, cantidades aproximadas y voz".

## Objective

Replace the `PlaceholderScreen` in the **Lista** tab with the Inventario screen:
collapsible category groups with a counter, rows colored by category, an
"aprox." tag for estimated quantities, edit and delete, and a floating
microphone button.

## Problem and why

`app/(tabs)/list.tsx` renders a placeholder. `useInventoryStore` exists but its
model cannot express what the screen and the PRD need: items have no id, name,
notes or exact/estimated flag, units are `gramos | mililitros | unidades`,
`removeItem` drops the item instead of zeroing it, and `Ingredient.category`
has 6 values that do not match the 12 allowed by the PRD.

## Scope

- `src/types/domain.ts`, `src/mocks/domainMocks.ts`
- `src/store/useInventoryStore.ts` (+ test), `src/store/useMealPlanStore.ts`
  (call site of the consumption action, + its test if affected)
- `src/features/inventory/**` (new feature folder)
- `app/(tabs)/list.tsx`
- `docs/THEMING.md`, `CLAUDE.md` (allowed-literal entry for category colors)

Out of scope: recording / transcription and `POST /inventory/voice-adjustments`
(no audio dependency and no backend endpoint exist yet), the inventory
movement ledger (backend-owned), swipe-to-delete, adding items manually.

## Constraints

- `docs/THEMING.md`: no color literal outside the single category-color
  constant; every other color is a palette token chosen by role.
- No palette token added, renamed or removed.
- UI copy in Spanish (matches existing screens); code, comments and tests in
  English. Conventional commits, no AI attribution.
- Worktree `../my-expo-app-worktrees/inventory-screen`, branch
  `feat/inventory-screen` from `origin/Develop` (db05b87).
- RDD is off for this clone (`clone_local`); no native review is started.
  Verification follows `gentle-ai review assess` tiers.
- Delivery strategy: `ask-on-risk`. Forecast ~850 authored changed lines, over
  the ~400 budget. Slice boundaries follow the work units below
  (slice A = T1, slice B = T2 + T3). Chain strategy (`stacked-to-main` vs
  `feature-branch-chain`) is the user's choice and is asked at delivery, before
  any PR is prepared.

## Decisions

- **Categories follow the PRD** (`meal-app-docs/docs/PRD_INVENTORY_SHOPPING.md:40`):
  `verduras, frutas, carnes, pescados_mariscos, lacteos, panaderia, almacen,
  congelados, bebidas, condimentos, limpieza_otros, otros`. Mock remap:
  `proteinas → carnes`, `despensa → almacen`.
- **Units follow the PRD**: `g | ml | unit`. Confidence: `exact | estimated`.
- **Inventory items are self-contained** (`id, name, category, quantity, unit,
  confidence, notes?, ingredientId?, isLeftover?`) so name and notes can be
  edited without touching the ingredient catalog.
- **Delete zeroes the quantity** and keeps the record; the list hides items at
  zero. Recipe consumption clamps at zero (inventory never goes negative).
- **A manual quantity edit marks the item `exact`** (the user typed a number in
  the normalized unit). Assumption, flagged for the user.
- **Persist `inventory-storage` gets `version: 1` + `migrate`** from the
  unversioned shape.
- **Category label for `almacen` is "Despensa"**, as drawn in the mockup. The
  glossary's "avoid despensa" is about naming the Inventory itself. Flagged.
- **Colors for the 7 categories the mockup does not draw are proposed here**
  (muted, paper family) and flagged for the user to retune in the constant.
- **The microphone FAB is presentational** (same state as the Planner composer
  mic, which has no `onPress`). Voice wiring is a follow-up. Flagged.
- **Edit UI is a bottom sheet** modeled on `EatTodaySheet` (the mockup does not
  design it). Delete uses the mockup's trash button, not the PRD's swipe.

## Tasks

- [x] T1 Domain model and store. Route: delegated writer (4+ non-trivial files:
      types, mocks, store, meal-plan call site, tests). Test-first with jest.
      - PRD category union + ordered list, `g | ml | unit`, `exact | estimated`,
        self-contained `InventoryItem`.
      - Store: `addItem`, `consumeIngredient` (clamps at zero), `updateItem(id,
        patch)` for name / quantity / notes, `removeItem(id)` zeroes, persist
        `version: 1` + `migrate`.
      - Pure domain helpers in `src/features/inventory/domain/`:
        `formatQuantity`, `groupInventoryByCategory`, `parseQuantityInput`.
- [x] T2 Category presentation constants and theming docs. Route: delegated
      (bundled with the UI writer, own commit). Labels and the single
      `INVENTORY_CATEGORY_COLORS` constant; documented as an allowed literal in
      `docs/THEMING.md` and `CLAUDE.md`.
- [x] T3 Inventario screen. Route: delegated writer (6+ files). Test-first for
      `InventoryRow`. Screen, category group, row, edit sheet, voice FAB, route
      wiring in `app/(tabs)/list.tsx`.
- [x] T5 Feature-first layout (user request, 2026-10-06: "everything done as
      feature first, for readability and cleanliness"). Route: delegated writer
      (moves across 10+ files). No behavior change, so no new RED; the existing
      suites are the safety net.
      - Move into `src/features/inventory/`: the store and its test (`store/`),
        `InventoryItem`, `QuantityConfidence`, `InventoryItemPatch` (`types/`),
        `MOCK_INVENTORY` (`mocks/`).
      - Stay shared: `Ingredient`, `IngredientCategory`, `INGREDIENT_CATEGORIES`,
        `UnitType` (`src/types/domain.ts`), `MOCK_INGREDIENTS` (`src/mocks`).
      - Other code reaches inventory only through `@/features/inventory`.
      - In-feature cleanups: one shared unit-symbol map, rename the
        `InventoryCategoryGroup` type that clashes with the component.
- [x] T6 Integrate with Develop (user request, 2026-10-06: one PR to Develop).
      Develop gained 25 commits, including the shopping feature built on the
      old inventory model (`@/store`, `{ ingredientId, amount }`,
      `gramos | mililitros | unidades`, `proteinas` / `despensa`). Route: merge
      inline (2 textual conflicts), then a delegated writer adapts
      `src/features/shopping/**` to the PRD model (13 files with type errors).
      Existing shopping suites are the safety net.
- [x] T4 Closure checks. Route: inline. Full jest, `tsc --noEmit`, lint, parent
      spot check, visual check if a dev build is available.

## Acceptance criteria (from the issue)

- [x] Category colors live in one constant documented as an allowed literal in
      THEMING.md; everything else comes from the palette.
- [x] Edit quantity, name and notes; delete sets the quantity to zero.
- [x] Quantities normalized to g / ml / unit with an exact / estimated flag.
- [x] Tests for the store and for the row.

## Checks

- `npx jest <touched test files>` during iteration; `npx jest` at closure.
- `npx tsc --noEmit`
- `npx eslint <touched files>` and `npx prettier -c <touched files>`
- `rg` for color literals in `src/features/inventory` outside the constant.

## Progress and evidence

- 2026-10-06 Exploration done (read-only explorer). Worktree created, `npm ci`
  ok, CodeGraph index initialized. No source write yet.
- 2026-10-06 T1 done. Commits `4515f5a` (types, mocks, store, meal-plan call
  site, tests) and `27a0335` (domain helpers). 694 insertions, 27 deletions,
  mostly tests. RED observed per behavior group (missing actions, wrong
  fields); helpers went red only on the missing module.
  - `npx jest src/store src/features/inventory`: 5 suites, 65 tests passed
    (writer run and parent spot check).
  - `npx eslint` and `npx prettier -c` on touched paths: clean.
  - `npx tsc --noEmit`: 22 errors, all in 4 untouched auth/service test files
    that use Node globals; identical on base `db05b87`. Known environmental
    failure, not caused by this feature.
  - Store API: `addItem(ingredientId, amount)`, `consumeIngredient(ingredientId,
    amount)`, `updateItem(id, { name?, quantity?, notes? })`, `removeItem(id)`,
    `migrateInventoryState`. `partialize` added so `migrate` returns data only.
  - Running count: ~720 authored changed lines (slice A).
  - Assessment (`gentle-ai review assess --base-ref db05b87 --committed-only`):
    medium, `slice_budget_reached`. RDD off, so no review started; writer
    self-verification plus parent spot check.
- 2026-10-06 T2 done. Commit `65a90b0`: `INVENTORY_CATEGORY_LABELS` and
  `INVENTORY_CATEGORY_COLORS` in `src/features/inventory/constants/categories.ts`,
  one row in the "Literals that are allowed" table of `docs/THEMING.md`, the
  "Allowed literals" bullet of `CLAUDE.md`. +42 −6.
- 2026-10-06 T3 done. Commit `fb13f86`: `InventoryScreen`,
  `InventoryCategoryGroup`, `InventoryRow`, `InventoryEditSheet`,
  `InventoryVoiceButton`, `app/(tabs)/list.tsx` wrapper. +1459 −2 (about 685
  source, 775 tests). RED observed against stubs for row, group and sheet;
  voice button and screen tests went red only on the missing module.
  - `npx jest src/features/inventory src/store`: 10 suites, 100 tests passed
    (writer run and parent spot check).
  - `npx jest` (full): 43 of 44 suites, 474 of 476 tests. The 2 failures are in
    `src/services/__tests__/authErrorCodeContract.test.ts`, see below.
  - `npx tsc --noEmit`: the same 22 baseline errors, none outside the 4 files.
  - `npx eslint` and `npx prettier -c` on touched paths: clean.
  - Color-literal scan of `src/features/inventory`: only the constant, the
    black modal backdrop and mocked theme fixtures in tests.
  - Assessment (`--base-ref 4a6b1d1`): medium, `slice_budget_reached`. RDD
    off, no review started.
  - Running count: ~2300 changed lines on the branch (slice A ~720, slice B
    ~1500), roughly half of it tests.
- 2026-10-06 T4: automated checks observed as above. Visual check NOT run: the
  simulator app is bound to the main checkout's bundler and the worktree has
  no `.env`; copying it was declined.
- 2026-10-06 T5 done. Commit `36f92f2`: store (+ test), `InventoryItem` /
  `QuantityConfidence` / `InventoryItemPatch` and `MOCK_INVENTORY` moved into
  `src/features/inventory/{store,types,mocks}`; shared catalog types stay in
  `src/types/domain.ts`. 26 files, +136 −119, renames kept by `git mv`.
  - `useMealPlanStore` imports `@/features/inventory/store`, not the feature
    root: the root index pulls the screen and reanimated/worklets into the
    store test environment, which fails to load. Documented in `src/README.md`.
  - One `UNIT_LABEL` map in `domain/`; the grouping type is now
    `InventoryGroup`.
  - `npx jest src/features/inventory src/store`: 10 suites, 100 tests passed
    (writer run and parent spot check). Full jest and `tsc`: unchanged
    baseline failures only. eslint and prettier clean.
- 2026-10-06 T4 visual check done on iOS (iPhone 17 Pro simulator, existing
  debug build `com.myfood.e2e` from the main checkout, worktree bundler on
  8082). Observed: title "INVENTARIO" fits on one line with the shared title
  metrics; subtitle on one line; groups, rows, "aprox." pill, icons and voice
  FAB match the mockup; collapsing a group shows the peek strip; the edit
  sheet opens, lifts above the numeric keyboard, disables "Guardar" on an empty
  quantity, and saving a quantity updates the row and removes the "aprox."
  pill; a persisted v0 inventory was migrated on first load (3 items, all
  estimated). No bundler warnings or errors.
  - Not exercised in the simulator: delete (no UI to restore the item; covered
    by store and screen tests), Android, non-default palettes.
- 2026-10-06 T6 done. Merge `a815c66` (conflicts in `src/README.md` and
  `src/store/useMealPlanStore.test.ts`; Develop's meal-confirmation tests were
  ported to the new item shape). Then `356fc6c` (shared
  `INGREDIENT_CATEGORY_LABELS` in `src/constants/ingredientCategories.ts` and
  `formatQuantity` in `src/utils/formatQuantity.ts`, replacing the per-feature
  copies) and `be9ebc1` (shopping reads the inventory through
  `@/features/inventory/store`, uses `quantity`, `g | ml | unit` and the PRD
  categories; quantity 0 counts as no stock).
  - User-visible in Compras: the "Proteínas" group is now "Carnes", groups
    follow the PRD order, and categories that fell under "Otros" get their own
    group.
  - Open product rule: inventory items without `ingredientId` do not count as
    stock for the shopping list (matching is by ingredient id only).
  - `npx jest src/features/shopping src/features/inventory src/store
    src/utils`: 23 suites, 413 tests passed (parent spot check). Full jest:
    835 of 837, only the 2 known `authErrorCodeContract` failures. `tsc`: the
    22 baseline errors only. `npm run lint`: 0 errors, 7 warnings.
  - CI on `Develop` is already red (last two push runs failed), so a red check
    on the PR is not by itself caused by this branch.
- 2026-10-07 PR ChordanDev/progra-3-front#51 opened against `Develop`; CI
  failed at the "Checkout backend (sibling)" step ("Not Found"): the workflow
  clones the private `ChordanDev/progra-3-back` with the default token. Same
  failure on `Develop` since 2026-10-06; tests, lint and typecheck never run.
  Needs a repository secret with read access to the backend (user action).
  - The 22 baseline `tsc` errors are fixed in this PR by referencing the Node
    types in the 4 tests that use Node APIs (`/// <reference types="node" />`,
    same idiom as the existing jest references). `npx tsc --noEmit` exits 0.

## Known environmental failures

- `src/services/__tests__/authErrorCodeContract.test.ts` fails 2 tests in this
  worktree because it resolves the backend as a sibling directory
  (`../my_food_back`), which `my-expo-app-worktrees/` does not have. Not
  confirmed on the base commit from this worktree.
- `npx tsc --noEmit` fails on base with 22 errors in
  `src/features/auth/__tests__/maestroSelectors.contract.test.ts`,
  `src/services/__tests__/authErrorCodeContract.test.ts`,
  `src/services/__tests__/authService.test.ts` and
  `src/services/__tests__/onboardingService.test.ts`. The gate for this feature
  is "no new error outside those four files".

## Open points for the user

- Android visual check (edit sheet keyboard lift, row shadow weight).
- Seven provisional category colors; "Despensa" as the label for `almacen`.
- A manual quantity edit marks the item `exact`; saving 0 hides the row.
- Voice FAB has no behavior yet.
- Delivery: the user chose a single PR to `Develop` (2026-10-06), so no chain.

## Next step

Single PR to `Develop` opened; wait for review.
