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
- [x] T2 Domain: skipped state, pending predicates, selectable past days.
      Route: delegated writer (domain + store + two test files). Test-first
      with jest: `localMealPlan.test.ts`, `useMealPlanStore.test.ts`.
- [x] T3 Home UI: pending day cell and the confirmation row. Route: delegated
      writer (new components, `DayCell`, `Calendar`, `useHomeState`,
      `HomeScreen`). Test-first with jest + React Native Testing Library for
      the day cell colors, the confirmation card actions and the selection
      flow after confirming.

## Acceptance criteria

- [ ] `alert` exists in the shared contract (`meal-app-docs`) and in
      `RecipeThemeConfig` before it is used.
- [x] Pending day: `alert` fill at 70 % plus `alert` border; selected: 2px
      `colorMedium` border.
- [x] A past day whose meals are all confirmed is no longer shown as pending
      nor selectable.
- [x] Tests cover `isSelectableMealDate` and the new state.

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
- 2026-10-06: T2 done in 6c8a7fb (`feat(home): add the skipped meal state and
  pending past days`), 307 authored changed lines in `src` (running total 319).
  `MealPlanEntry.isSkipped?`, domain API in `localMealPlan.ts`
  (`isMealConfirmed`, `getPendingConfirmationEntries`,
  `getPendingHomeMealType`, `isPendingConfirmationDate`, and
  `isSelectableMealDate` now accepting pending past days), store action
  `markAsSkipped`, and `markAsCooked` ignoring a skipped entry. RED observed
  first: 17 of the 24 new tests failed (missing exports, `markAsSkipped` not a
  function, pending past day not selectable, skipped entry still cooked); the 7
  that passed pin behavior that must not change. GREEN: 34 / 34 in the two
  focused files. Observed checks: `npx tsc --noEmit` 22 errors, all in the four
  known baseline files; `npx jest` 34 suites / 401 tests passed, 1 suite /
  2 tests failed (`authErrorCodeContract.test.ts`, known baseline);
  `npm run lint` 0 errors, 7 warnings in files not touched, prettier clean.
  Left as is, for T3 to decide: the mocks have no past entry, so no pending day
  shows up yet; `eatToday` and `getDefaultHomeMealType` still read `isCooked`
  only.

- 2026-10-06: T3 done in two work units, 1163 changed lines (618 of them
  tests, about 70 a re-indent of the existing Home row); running total 1482,
  above the ~400 delivery budget, so the chain strategy has to be asked before
  any PR.
  - ef8819c (`feat(home): mark pending past days in the calendar`), 212 lines:
    `DayCell.isPendingConfirmation` (`alert` at 70 % plus `alert` border, 2px
    `colorMedium` ring when selected, `!` glyph, label `6, comida sin
    confirmar`), `isPendingDate` wrapper in `utils/calendarDate.ts`, `Calendar`
    passing the flag, and `MOCK_MEAL_PLAN` with a pending yesterday (mp7, mp8)
    and a confirmed day before (mp9, mp10). RED first: 3 of the 5 new `DayCell`
    tests failed (fill, selected ring, glyph and label); the 2 that passed pin
    behavior that must not change. The mock test was checked against the
    reverted mock and failed there.
  - 3d02838 (`feat(home): confirm a past meal from the Home screen`), 951
    lines: `getHomeMealSummaries` in the domain, `useHomeState` exposing
    `isPendingConfirmationDay` and `selectedDayMeals`, pending-only
    `availableMealTypes`, first pending meal on opening a pending day, and the
    return to the default date after the last confirmation; new
    `PendingDayCard` and `CookedConfirmationCard`; `HomeScreen` rendering both
    instead of the meal row on a pending day and calling `markAsCooked` /
    `markAsSkipped`. RED first: the 9 `useHomeState` tests and the 2
    `getHomeMealSummaries` tests failed, and both card suites could not import
    their component. GREEN: 69 / 69 in `src/features/home`.
  - Route: delegated writer. No testing library is installed, so the hook and
    the components are tested with `react-test-renderer` and a hook harness,
    as the rest of the repository does.
  - Decisions taken while implementing: the default date (app open and the
    fallback after the last confirmation) ignores past days, so it is today
    when today has a plan, otherwise the first planned upcoming day, otherwise
    today; the day card lists every Home meal of the day, confirmed ones
    included; the button border is `icon` at 30 %, the tint the other pills
    use.
  - Observed checks on 3d02838: `npx tsc --noEmit` 22 errors, all in the four
    known baseline files; `npx jest` 38 suites / 425 tests passed, 1 suite /
    2 tests failed (`authErrorCodeContract.test.ts`, known baseline);
    `npm run lint` 0 errors, 7 warnings in files not touched, prettier clean;
    `npx prettier -c docs/THEMING.md` clean.
  - Not verified: the screen was not run on a device or simulator, so sizes,
    spacing and the gradient of the two cards are unchecked against the
    reference. `HomeScreen` has no test; its wiring is covered by the
    typecheck only.
  - Left as is: after the selection returns to today the calendar keeps
    showing the month the user navigated to (`useCalendarState`, outside the
    T3 edit surface); `eatToday` and `getDefaultHomeMealType` still read
    `isCooked` only.

## Next step

Run Home on a device against `docs/design/screens/Home-Pendiente.reference.webp`,
update the shared contract in `meal-app-docs`, and ask for the chain strategy
before opening a PR.
