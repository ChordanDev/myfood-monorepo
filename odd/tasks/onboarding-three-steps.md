# onboarding-three-steps

Issue: ChordanDev/progra-3-front#48 "Onboarding: rehacerlo en tres pasos reales".

## Objective

Turn `OnboardingScreen` into a real three-step wizard (Tu hogar, Preferencias,
Tiempos por comida) with per-step validation, a progress bar, a fixed
CONTINUAR button and palette-only colors.

## Problem and why

The screen is a single scroll that advertises "3 pasos" without having steps.
Validation only covers the profile fields, an empty manual-minutes field is
silently sent as 0, and the onboarding components carry around 20 color
literals, which `docs/THEMING.md` forbids.

## Scope

- `src/features/preferences/screens/OnboardingScreen.tsx`
- `src/features/preferences/components/onboarding/**`
- `src/features/preferences/utils/onboardingSteps.ts` (new),
  `src/features/preferences/utils/onboardingSlot.ts`
- `src/features/preferences/__tests__/**` (onboarding tests only)
- `docs/THEMING.md` ("Open decisions" entry for onboarding)

## Constraints

- `OnboardingCompletionRequest` and `buildOnboardingPayload` keep their
  contract; `onboardingPayload.test.ts` is not edited and stays green.
- No color literal; default (sand) palette through `RecipeThemeConfig` tokens
  chosen by role, tints through `withOpacity`. No token added, renamed or
  removed.
- `testID="e2e-onboarding-screen"` stays as a literal in `OnboardingScreen.tsx`
  (`maestroSelectors.contract.test.ts` and two Maestro flows depend on it).
- `previewMode` behavior is preserved (no redirect, no submit, no sign-out).
- Tests use `react-test-renderer`; `@testing-library/react-native` is not
  installed and is not added.
- Conventional commits, no AI attribution.
- Worktree `my-expo-app-worktrees/onboarding-three-steps`, branch
  `feat/onboarding-three-steps` from `origin/Develop` (db05b87).
- RDD is off for this clone (`clone_local`); no native review is started.
- Delivery strategy: `ask-on-risk`. Forecast is above 400 authored changed
  lines (about 900), so the chain strategy is asked once before any pull
  request is planned. Commits already follow the slice boundaries below.

## Decisions taken without a mockup

The mockup (`docs/design/screens/Onboarding.dc.html`) covers step 1 only.

- Steps 2 and 3 reuse the step 1 visual language (field cards, labels, chips).
- Steps 2 and 3 get a back control (chevron at the left of the progress row);
  Android hardware back goes to the previous step. The mockup shows none
  because step 1 has no previous step.
- The fixed button reads CONTINUAR on steps 1 and 2 and FINALIZAR on step 3,
  where it submits.
- A failed attempt keeps the user on the step and shows an inline message
  above the button instead of an alert.
- Manual mode requires a whole number of minutes of at least 1.

## Tasks

- [x] T1 Pure step logic. `onboardingSteps.ts`: step order, next/previous,
      `validateOnboardingStep(step, draft)` returning a user-facing message or
      null; household size clamp 1-20; `slotFormToCookingTime` in
      `onboardingSlot.ts`. Route: delegated (util plus tests, prepares T2).
      Test-first: RED on the new unit tests, then GREEN.
- [x] T2 Wizard shell and step 1. Step state, progress bar with "Paso N de 3",
      fixed footer (primary button, inline error, "Cerrar sesión" text), back
      control, step 1 to the mockup with the diners stepper. Steps 2 and 3
      render the existing sections. Route: delegated (screen plus components
      plus tests). Test-first: step-navigation tests RED before the rewrite.
- [x] T3 Palette-only steps 2 and 3. Restyle preferences and meal-time
      components to the step 1 language, remove every color literal and the
      unused hero/section card, update `docs/THEMING.md`. Route: delegated
      (same writer). No behavioral RED: proof is a literal search over the
      onboarding folder plus the existing tests.

## Acceptance criteria

- [x] Final payload is still `OnboardingCompletionRequest`, no contract change.
- [x] Per-step validation; invalid data never advances.
- [x] Default palette, no color literal in onboarding files.
- [x] `onboardingPayload.test.ts` green and step-navigation tests added.

## Checks

- `npx jest src/features/preferences src/features/auth/__tests__/maestroSelectors.contract.test.ts`
- `npx jest` (full suite at closure)
- `npm run lint`
- `npx tsc --noEmit`
- `rg -n "#[0-9A-Fa-f]{3,8}\b|rgba?\(" src/features/preferences/components/onboarding src/features/preferences/screens/OnboardingScreen.tsx`
  returns only allowed `#000000` shadow colors.

## Progress and evidence

A commit cannot contain its own hash, so each task's hash is recorded by the
commit that follows it.

- Baseline on 3c3f359 (db05b87 plus this document), before the first edit:
  - `npx jest`: 1 suite failed, 34 passed; 2 tests failed, 377 passed. Both
    failures are in `src/services/__tests__/authErrorCodeContract.test.ts`
    ("resolveBackLibPath() returns a non-null string when a sibling back
    exists" and "every error code emitted by the back is in the front
    allowlist"): the backend checkout is not a sibling of this worktree.
  - `npm run lint`: 0 errors, 7 warnings (`fix-auth-colors.js` 3,
    `AddCircleButton.test.tsx` 1, `FoodCard/icons.tsx` 3); Prettier clean.
  - `npx tsc --noEmit`: 22 errors, all missing node types, in
    `maestroSelectors.contract.test.ts` (12), `authErrorCodeContract.test.ts`
    (8), `authService.test.ts` (1) and `onboardingService.test.ts` (1).
- T1 done in 2fbf0af. RED: `npx jest` on the two new files failed 2 suites,
  5 tests (`slotFormToCookingTime is not a function`; the `onboardingSteps`
  suite ran no test because the module it imports did not exist yet). GREEN:
  2 suites, 28 tests passed. Focused check: 10 suites, 80 tests passed. Lint
  and tsc unchanged from the baseline.
- T2 done in 73db74c. RED: the 9 cases of `onboardingScreen.steps.test.tsx`
  failed against the single-scroll screen (no "Paso 1 de 3", no CONTINUAR, no
  "Nombre para mostrar" input). GREEN: 9 passed. The integration test keeps
  its five cases: its mocks gained `ShadowSurface`, the two catalog guards and
  the two palette tokens the screen now reads, and the preview case walks
  CONTINUAR, CONTINUAR, FINALIZAR and asserts the "Modo preview" alert.
  Focused check: 11 suites, 89 tests passed. Lint and tsc unchanged from the
  baseline. Steps 2 and 3 still render the old section cards, with their
  literals, until T3.
  - Route: delegated writer. Not verified on a simulator.
  - Choices inside the brief: chips are `radio`/`checkbox` with a `checked`
    state, as the mockup's `role="radio"`; the progress bar reports
    `min 0, max 3, now N`; "1 comensal" is singular; the name card is a touch
    target that focuses its input; the scroll view remounts per step so each
    step starts at the top; `ShadowSurface` supplies the mockup's card and
    button shadow.
- T3 done. Proof: the literal search (hex, `rgb()`/`rgba()`, `'transparent'`)
  over the onboarding folder and `OnboardingScreen.tsx` returns nothing, not
  even a shadow color, because the shadow comes from the shared
  `ShadowSurface`. Removed `OnboardingChip`, `OnboardingSegmentChip` and
  `OnboardingSectionCard` (the hero and `HouseholdSection` left in T2);
  nothing outside the onboarding folder imported them. `docs/THEMING.md`
  records onboarding as decided and keeps auth open.
  - One behavior change, test-first: the "0 min" quick preset is no longer
    offered, since step 3 rejects it and "No cocino" already means zero. RED
    observed by disabling the filter (the list came back with "0 min"), GREEN
    with it restored.
  - Closure checks: `npx jest` 38 suites, 37 passed, 1 failed; 417 tests, 415
    passed, 2 failed, the same two baseline failures in
    `authErrorCodeContract.test.ts`. Focused check: 11 suites, 90 tests
    passed. `npm run lint`: 0 errors, the 7 baseline warnings, Prettier clean.
    `npx tsc --noEmit`: the 22 baseline errors, none new.
  - Not verified on a simulator: layout, keyboard behavior and the look of
    steps 2 and 3 (which have no mockup) need a visual pass.

## Next step

Visual pass on a device, then decide the chain strategy and open the pull
request. No task is left open.
