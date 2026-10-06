# Home screen improvements

- **Branch:** `feat/home-screen-improvements` (from `Develop` @ `7521791`)
- **Locator:** `odd/tasks/home-screen-improvements.md`
- **Engram mirror:** `odd/home-screen-improvements/tasks` — saved via the Engram CLI as observation #3536 (the MCP save was refused: multiple active runtime sessions)

## Objective

Apply the findings of the Home screen review one at a time, without rewriting the screen.

## Problem

The Home feature has a sound domain/hook/screen layering, but some business rules live in UI
files, a few interactions are incomplete (favorite, empty day, opening the recipe), and the
layout relies on implicit shrinking.

## Scope

In: `src/features/home/**`, the meal-plan store where a task needs it, tests next to the code.
Out: backend/API integration, Recipe screen, planner, visual redesign.

## Constraints

- Test-first where a runnable deterministic test exists (Jest, `npx jest <path>`).
- UI copy stays in Spanish (existing project language); code and comments in English.
- No new dependencies without asking.
- RDD is off for this clone (`clone_local`); ordinary checks only.

## Delivery

- Strategy: `ask-on-risk`. Forecast ~600 authored lines across all tasks (> 400), so the chain
  strategy must be chosen by the user before any PR is prepared. No push/PR without request.

## Tasks

- [x] **T1 — Eat-today rules in the domain + cooked-aware default meal** (review items 2 and 5)
  - Route: delegated writer (new domain module, tests, screen, hook).
  - Commit: `9d07b72`. RED observed (missing module / missing export), then 19 tests green.
  - Risk tier: `high` (RDD off) -> writer self-verification + independent verifier: no defects.
- [x] **T2 — Favorite tied to the recipe and persisted** (item 1)
  - Route: inline (small mechanical edits in store, card, screen).
  - Commit: `7d604f9`. `favoriteRecipeIds` + `toggleFavoriteRecipe` in `useMealPlanStore`;
    persist version not bumped (new key falls back to its default on merge).
  - RED observed (`toggleFavoriteRecipe is not a function`), then 3 store tests green.
- [ ] **T3 — Empty state when the selected day has no meal** (item 3) — DEFERRED (user,
  2026-10-06). Days without a plan are not selectable (`DayCell` `disabled={!isSelectable}`,
  guard in `useCalendarState.ts:75`), so the state is only reachable when the whole plan is
  empty, which cannot happen with the current mock data. Revisit when the plan comes from the API.
- [x] **T4 — Whole food card opens the recipe** (item 4)
  - Route: inline. Commit: `5be8e5c`. Prop renamed to `onOpenRecipe`, used by card and sparkles.
  - Checks: tsc/eslint/prettier clean for the feature. NOT verified on a device.
- [ ] **T5 — Explicit flex proportions instead of 50% + 50% heights** (item 6) — DOWNGRADED.
  The month grid lives in a `ScrollView` (`Calendar.tsx:88`), so the half-visible last row is
  scrollable by design, not clipped content. Optional polish only; needs a design decision.
- [x] **T6 — Themed sheet instead of native `Alert` for the eat-today slot** (item 7)
  - Route: delegated writer (new component + test + screen wiring). Commit: `f9b83ff`.
  - `EatTodaySheet` on RN `Modal`, colours from the recipe theme, same Spanish copy.
  - RED observed (`Cannot find module './EatTodaySheet'`), then 6 render tests green
    (28 total with `--testPathIgnorePatterns '/.claude/'`).
  - Device check: sheet opens from "Comerlo hoy" on Wed 7 with Mediodía/Cena/Cancelar; choosing
    Cena moved that lunch to today's dinner and selected it. Backdrop/cancel and the
    no-slots variant were not exercised on device (render tests only).
- [ ] **T7 — Minors**
  - [x] Store selectors in `useHomeState` — commit `dfa2813`.
  - [ ] Refresh `todayKey` on foreground/midnight. Open design point: when the day rolls over
    the selected date becomes a past (non-selectable) date, so the selection must be reset and
    `useHomeRecipeTheme` must receive today's key instead of computing it inside its effect.

## Progress

- Baseline: `npx jest src/features/home` -> 1 suite, 1 test passing.
- After `dfa2813`: `npx jest src/store src/features/home` -> 3 suites, 22 tests passing;
  `npx eslint src/store src/features/home` -> 0 errors, 3 pre-existing warnings;
  `npx tsc --noEmit` -> no errors under `src/features/home` or `src/store` (22 pre-existing
  errors in test files under `src/services/__tests__` and `src/features/auth/__tests__`).
- Running authored size vs `Develop`: 271 insertions, 59 deletions (330). The next task crosses
  ~400, so the chain strategy must be chosen before preparing any PR.
- Device check (iPhone 17 Pro simulator, iOS 26.2, existing Debug build from 2026-09-23 +
  Metro with `EXPO_PUBLIC_START_HOME=true`):
  - T2: favorite toggles per recipe (lunch marked, dinner not) and survives an app restart.
  - T2 follow-up: the star fills were swapped (favorite looked hollow) -> fixed in `0b615d3`.
  - T4: tapping the card body opens the recipe screen.
  - T1: lunch selected by default at 12:21. The cooked-meal skip was NOT exercised on device
    (unit tests only).
  - T5: the last calendar row (25-31) is half visible on this device but reachable by
    scrolling the grid; the earlier "clipped" reading was wrong.
- `npx expo run:ios` fails under Xcode 27.0 / Swift 6.4: `expo-modules-jsi` 57.1.0
  `JavaScriptRuntime.swift:314` (bare-slash regex literal not parsed). Unrelated to this work.
- The `expo-modules-jsi` 57.1.0 -> 57.1.1 lockfile bump (fixes the Xcode 27 iOS build) is
  committed as `0e81009` (branch `fix/expo-modules-jsi-xcode27`), fast-forwarded into local
  `Develop` and merged into this branch as `3c1c2bb` on 2026-10-06 (nothing pushed). `node_modules` already has 57.1.1.
- This file is untracked on purpose; commit it only if the user wants it in the repo.

## Next step

Closed by the user on 2026-10-06. Branch fast-forwarded into local `Develop` (`3c1c2bb`) and `Develop` pushed to `origin` (`e591797..3c1c2bb`) the same day. Only the midnight refresh (T7) is left; T3 deferred, T5 optional. Chain strategy still undecided (branch is past ~400 authored lines).
