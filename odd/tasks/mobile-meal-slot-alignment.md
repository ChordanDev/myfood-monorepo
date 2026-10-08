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
- [ ] T2 — Derive `CookingTimeSlot` from `MealSlot` and move onboarding and
  settings onto it; remove the three-code `MealSlot` from auth types.
  Route: delegated.
- [ ] T3 — Migrate home domain, components, hooks, screens, mocks, the meal
  plan store (version bump) and every fixture and test to the English codes.
  Tests first (RED), then source (GREEN). Route: delegated.
- [ ] T4 — Contract: delete `MealType` and its re-exports; run every check.
  Route: delegated.

## Progress

Baseline on `f4b849d` (in `apps/mobile`): `npm run typecheck` clean, `npm test`
92 suites / 1471 tests passed, `npm run lint` 0 errors (4 pre-existing
warnings), prettier clean.

A commit cannot record its own SHA, so each task's SHA is filled in by the
next task's commit.

- T1 — `feat(mobile): add English meal slot type and labels`.
  `ORDERED_MEAL_SLOTS` and `MealSlot` in `src/types/domain.ts`;
  `MEAL_SLOT_LABEL` in `src/constants/mealSlots.ts`, next to
  `ingredientCategories.ts`. The list is not named `MEAL_SLOTS` because
  `features/preferences/constants/preferenceOptions.ts` already exports a
  three-code `MEAL_SLOTS`.
  RED: `npx jest src/constants/mealSlots.test.ts` failed with
  `Cannot find module './mealSlots'`. GREEN: 3 tests passed.
  Checks: typecheck clean, `npm test` 93 suites / 1474 tests passed, lint
  0 errors (same 4 warnings).
