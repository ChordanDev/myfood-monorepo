# home-confirm-past-meal

Issue: ChordanDev/progra-3-front#46 — "Home: confirmar si se cocinó una comida de un día pasado".

## Objective

Let the user confirm, from Home, whether a planned meal of a past day was
cooked. Past days with an unconfirmed meal become selectable and are marked
with the new `alert` palette token.

## Problem and why

`MealPlanEntry` only has `isCooked: boolean`, and `isSelectableMealDate` blocks
every day before today. A meal that passed without being marked stays
unconfirmed forever, so inventory never reflects what was actually cooked.

## Scope

- Token `alert` in the token contract: `RecipeThemeConfig`, `DEFAULT_THEME`,
  provider back-fill, mock palettes, `docs/THEMING.md`, and the shared docs
  repository `meal-app-docs`.
- Domain: a "skipped" state for a meal plan entry, pending-confirmation
  predicates, `isSelectableMealDate`, and the store action `markAsSkipped`.
- Home UI: pending day cell, and a top row with the day's meals card plus the
  "¿Hiciste esta receta?" card (✓ / ✗) when a pending past day is selected.

Design reference: `docs/design/screens/Home-Pendiente.reference.webp`, token
proposal in `docs/design/screens/Main.dc.html` (sand `#B9553B`, olive `#C94F3D`).

## Constraints

- Colors only from the active palette (`docs/THEMING.md`). `alert` is the only
  token added; the issue authorizes it. No other token changes.
- Only days strictly before today are "pending". Today's and future behavior
  stays as it is.
- The meal plan is local state (zustand + mocks); no backend call exists for
  cooked/skipped yet, so nothing is sent to the API.
- Conventional commits, no AI attribution. No push, no PR without the user.
- Worktree `../my-expo-app-worktrees/home-confirm-past-meal`, branch
  `feat/home-confirm-past-meal` from `origin/Develop` (db05b87).
- RDD is off for this clone (`clone_local`); no native review is started.
- Delivery strategy: `ask-on-risk`. Forecast ~600 authored changed lines
  (T1 ~80, T2 ~200, T3 ~350), above the ~400 budget. Commits are sliced per
  task so either chain strategy can be formed; the chain strategy is asked
  before any PR is created.

## Decisions

- **Skipped state is additive:** `MealPlanEntry.isSkipped?: boolean`, with
  `isCooked` kept. A status union would be the cleaner model, but it rewrites
  every `isCooked` reader and needs a persisted-store migration while the
  backend meal-plan contract is still undefined (issue #42). The invariant
  "cooked and skipped never both true" is enforced in the store and hidden
  behind domain predicates, so the representation can change later in one place.
- **A confirmation is final:** `markAsCooked` and `markAsSkipped` are no-ops on
  an entry that is already cooked or skipped.
- **✗ does not touch inventory.**
- **Pending considers Home meal types only** (`desayuno`, `almuerzo`, `cena`),
  the ones the switcher can show.
- **Pending day cell shows `!`** instead of the day number, as in the reference.

## Tasks

- [x] T1 `alert` token in the contract. Route: delegated writer (several files:
      type, provider, mocks, fixtures, docs). No meaningful RED: a required
      field on a type; proof is typecheck plus the full suite. Shared docs
      (`meal-app-docs`) edited by the parent on a separate branch of that
      repository.
- [ ] T2 Domain: skipped state, pending predicates, selectable past days.
      Route: delegated writer (domain + store + two test files). Test-first
      with jest: `localMealPlan.test.ts`, `useMealPlanStore.test.ts`.
- [ ] T3 Home UI: pending day cell and the confirmation row. Route: delegated
      writer (new components, `DayCell`, `Calendar`, `useHomeState`,
      `HomeScreen`). Test-first with jest + React Native Testing Library for
      the day cell colors, the confirmation card actions and the selection
      flow after confirming.

## Acceptance criteria

- [ ] `alert` exists in the shared contract (`meal-app-docs`) and in
      `RecipeThemeConfig` before it is used.
- [ ] Pending day: `alert` fill at 70 % plus `alert` border; selected: 2px
      `colorMedium` border.
- [ ] A past day whose meals are all confirmed is no longer shown as pending
      nor selectable.
- [ ] Tests cover `isSelectableMealDate` and the new state.

## Checks

- `npx tsc --noEmit`
- `npx jest`
- `npm run lint`

## Progress

- 2026-10-06: document created; baseline checks running on db05b87.
- 2026-10-06: T1 done in bafe98e (`feat(theme): add the alert token to the
  palette contract`), 12 authored changed lines. `alert` added to
  `RecipeThemeConfig`, `DEFAULT_THEME` (`#B9553B`), the provider back-fill, both
  Olive mock palettes (`#C94F3D`) and `docs/THEMING.md`. No test fixture needed
  the value: they mock `useRecipeTheme` with partial untyped objects. Observed
  checks: `npx tsc --noEmit` 22 errors, all in the four known baseline files;
  `npx jest` 34 suites / 377 tests passed, 1 suite / 2 tests failed
  (`authErrorCodeContract.test.ts`, known baseline); `npm run lint` 0 errors,
  7 warnings in files not touched, prettier clean. The `meal-app-docs` update
  is still pending on the parent.

## Next step

T2.
