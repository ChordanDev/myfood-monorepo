# mobile-meal-slot-alignment

Issue: ChordanDev/myfood-monorepo#23 — "P1: Meal slot alignment on mobile".
Parent spec: ChordanDev/myfood-monorepo#3 (AI planner, draft, refine and confirm).

## Objective

The app's Meal slot is the API's `breakfast | lunch | snack | dinner` end to
end. Spanish text exists only as display labels.

## Problem and why

`apps/mobile/src/types/domain.ts` declares
`MealType = 'desayuno' | 'almuerzo' | 'cena' | 'snack'`, values the API has
never heard of. The planner slices that follow (#3) read Scheduled meals from
the API, so the app must speak the contract enum before it can consume them.

A second, three-code `MealSlot` already lives in
`apps/mobile/src/features/auth/types/auth.ts` for Slot cooking times. Two
types with the glossary name and different members is the ambiguity this
ticket removes.

## Scope

Mobile only (`apps/mobile`), expand–contract:

- Expand: one `MealSlot` type with the four English codes plus a display
  mapping for the Spanish labels.
- Migrate: every screen, store entry, fixture and test to the English codes.
- Contract: delete the Spanish `MealType` and its re-exports.

## Decisions

- `MealSlot` (four codes) lives in `src/types/domain.ts`; it is the only type
  with that name.
- The three slots the User cooks are derived, never redeclared:
  `CookingTimeSlot = Exclude<MealSlot, 'snack'>` in auth types (onboarding,
  settings) and `HomeMealSlot = Exclude<MealSlot, 'snack'>` in the home domain
  (replaces `HomeMealType`).
- The app has no i18n library. "Localization" here is a label module:
  `MEAL_SLOT_LABEL: Record<MealSlot, string>`. `snack` is labelled `Snack`
  (no screen renders it yet).
- "Eat today" keeps its own `Mediodía` label for lunch; labels shown to the
  User do not change.
- Value identifiers such as `selectedMealType` or `getAvailableHomeMealTypes`
  keep their names. Only type names and slot values change; the home mock
  store is replaced by the live-plan cache in a later slice of #3.
- The persisted meal plan store bumps its `version` so entries saved with
  Spanish codes are discarded and the fixtures reload, the convention the
  store already documents. No Spanish-to-English migration: it would keep the
  Spanish values alive in code.

## Constraints

- No API change. No new dependency.
- Conventional commits, no AI attribution. No push, no PR without the user.
- Branch `claude/issue-23-7a0dfc`, branched from `main` at `f4b849d`.

## Acceptance criteria

- A single mobile Meal slot type with the four English codes; the Spanish
  `MealType` and its values no longer exist.
- All screens, store entries, fixtures and tests use the English codes;
  labels shown to the User are unchanged.
- Type check and app test suite green.

## Checks

Run in `apps/mobile`:

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `rg -n "MealType\b|desayuno|almuerzo|'cena'" src` returns no type named
  `MealType` and no Spanish slot value.

## Tasks

Delivery strategy: `ask-on-risk`. Forecast: about 350–400 authored changed
lines, almost all one-token value replacements in fixtures and tests; a single
PR.

- [x] T1 — Expand: add `MealSlot`, its ordered list and `MEAL_SLOT_LABEL`,
  with a test for the mapping. Route: delegated (writer trigger: 2+ files).
- [x] T2 — Derive `CookingTimeSlot` from `MealSlot` and move onboarding and
  settings onto it; remove the three-code `MealSlot` from auth types.
  Route: delegated.
- [x] T3 — Migrate home domain, components, hooks, screens, mocks, the meal
  plan store (version bump) and every fixture and test to the English codes.
  Tests first (RED), then source (GREEN). Route: delegated.
- [x] T4 — Contract: delete `MealType` and its re-exports; run every check.
  Route: delegated.
- [ ] T5 — Keep `favoriteRecipeIds` when the stored plan is discarded: a
  `migrate` replaces only the stored entries. Tests first (RED), then the
  store (GREEN). Route: delegated.

## Progress

Baseline on `f4b849d` (in `apps/mobile`): `npm run typecheck` clean, `npm test`
92 suites / 1471 tests passed, `npm run lint` 0 errors (4 pre-existing
warnings), prettier clean.

A commit cannot record its own SHA, so each task's SHA is filled in by the
next task's commit.

- T1 — `4ab1ba3` `feat(mobile): add English meal slot type and labels`.
  `ORDERED_MEAL_SLOTS` and `MealSlot` in `src/types/domain.ts`;
  `MEAL_SLOT_LABEL` in `src/constants/mealSlots.ts`, next to
  `ingredientCategories.ts`. The list is not named `MEAL_SLOTS` because
  `features/preferences/constants/preferenceOptions.ts` already exports a
  three-code `MEAL_SLOTS`.
  RED: `npx jest src/constants/mealSlots.test.ts` failed with
  `Cannot find module './mealSlots'`. GREEN: 3 tests passed.
  Checks: typecheck clean, `npm test` 93 suites / 1474 tests passed, lint
  0 errors (same 4 warnings).
- T3 — `9268be0` `refactor(mobile): use English meal slot codes`.
  `MealPlanEntry.type` is `MealSlot`; `HomeMealType` became `HomeMealSlot`;
  `FoodTypeSwitcher` reads `MEAL_SLOT_LABEL`; the meal plan store persists
  under version 2.
  RED (tests and fixtures moved first, source untouched): `npx jest` 7 suites
  / 40 tests failed — `eatToday`, `localMealPlan`, `useHomeState`,
  `EatTodaySheet`, `Calendar`, the new `mocks/mealPlanFixtures.test.ts` and
  the two new persistence tests in `useMealPlanStore.test.ts`. The planner,
  recipe, shopping and `PendingDayCard` tests never went RED: the slot value
  is an opaque fixture field there, so the rename cannot fail them.
  GREEN: `npm test` 94 suites / 1478 tests passed, typecheck clean, lint
  0 errors (same 4 warnings).
  The version bump discards the whole persisted meal plan state, which
  includes `favoriteRecipeIds`: the store has no `partialize`.
  No other persisted store holds Meal slot values: the shopping store keeps
  ids, manual items, the grouping mode and a date; the inventory store keeps
  items and ingredients.
- T4 — `5559a81` `refactor(mobile): remove Spanish MealType`. `MealType` and its re-exports in
  `src/mocks/mealPlans.ts` and `src/mocks/index.ts` are gone. Pure type
  removal, no meaningful RED.
  Checks: typecheck clean, `npm test` 94 suites / 1478 tests passed, lint
  0 errors (same 4 warnings), prettier clean.
  `rg -n "MealType\b|desayuno|almuerzo|'cena'" src` only matches value
  identifiers kept by decision (`selectedMealType`,
  `getDefaultHomeMealType`, `getPendingHomeMealType`,
  `getClosestHomeMealType`, `nextMealType`); with a leading word boundary
  (`\bMealType\b`) it matches nothing.
- T2 — `refactor(mobile): derive cooking time slots from MealSlot`, done
  after T4: it was blocked until `features/preferences/**` joined the edit
  surfaces, because `preferences/constants/catalog.ts` and
  `preferenceOptions.ts` import the auth slot type.
  `CookingTimeSlot = Exclude<MealSlot, 'snack'>` in
  `src/features/auth/types/auth.ts` replaces the three-code `MealSlot`;
  onboarding, settings and preferences use it. `SLOT_LABELS` is deleted from
  `preferenceOptions.ts` and its four users read `MEAL_SLOT_LABEL`; the three
  labels were compared byte for byte first and are identical.
  Type-level refactor with no behavior change, so no meaningful RED.
  Checks: typecheck clean, `npm test` 94 suites / 1478 tests passed, lint
  0 errors (same 4 warnings), prettier clean.
  `rg -n "type MealSlot\b|SLOT_LABELS" src` matches only the definition in
  `src/types/domain.ts`.

Next step: T5.
