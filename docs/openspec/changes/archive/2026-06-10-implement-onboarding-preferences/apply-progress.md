# Apply Progress: Slice 2 — Onboarding + Preferences

**Change**: `implement-onboarding-preferences`
**Work unit**: Cross-repo verification/docs (PR 3 of chained PRs)
**Branch**: docs worktree (base: docs `develop`)
**Status**: 16/16 tasks complete. Backend PR #11 and frontend PR #16 are merged; final verification/docs tasks 5.1 and 5.2 are verified.

## Final Verification / Docs — PR 3

### Task 5.1 — Gate and contract verification

Verified by frontend source inspection and tests:

- `my-expo-app/app/indexGate.ts` resolves the route order as unauthenticated → `AuthLanding`, authenticated incomplete → `Onboarding`, complete locked → `TrialExpired`, complete usable → `Tabs`.
- `my-expo-app/app/index.tsx` consumes `resolveIndexGate` and redirects `Onboarding` to `/onboarding`, renders `TrialExpiredScreen` for complete locked users, and redirects complete usable users to `/(tabs)/home`.
- `my-expo-app/app/(tabs)/_layout.tsx` blocks direct tab deep links when `!isAuthenticated || !canUseApp || !isComplete` by redirecting to `/`; this prevents incomplete or locked users from rendering tab chrome.
- `my-expo-app/app/__tests__/indexGate.test.ts` covers unauthenticated, incomplete locked, incomplete usable, complete locked, and complete usable states.

Commands run:

```text
cd ../my-expo-app && npm test -- app/__tests__/indexGate.test.ts
PASS app/__tests__/indexGate.test.ts — 1 suite, 6 tests passing

cd ../my-expo-app && npm test
PASS — 9 suites, 78 tests passing

cd ../my-expo-app && npm run lint
PASS — 0 errors, 7 pre-existing warnings; Prettier clean

cd ../my-expo-app && npx tsc --noEmit
PASS — no TypeScript errors

cd ../my_food_back && mix test
PASS — 131 tests, 0 failures

cd ../my_food_back && mix precommit
PASS — 131 tests, 0 failures
```

Frontend lint warnings observed and left unchanged because they are pre-existing and outside this work unit:

- `fix-auth-colors.js`: three unused variable warnings.
- `src/features/home/components/FoodCard/icons.tsx`: three unused import warnings.
- `src/features/planner/components/PlannerChatInput.tsx`: one `react-hooks/exhaustive-deps` warning.

### Task 5.2 — Glossary/ADR validation

Verified in docs:

- `meal-app-docs/CONTEXT.md` defines **Onboarding Profile** as display name, household size, and cooking skill only, with dietary restrictions and dietary preferences in the avoid list.
- `meal-app-docs/CONTEXT.md` defines **User Preferences** separately as a User's individual food preferences, dislikes, restrictions, and diet signals.
- `meal-app-docs/docs/adr/0001-onboarding-profile-scope.md` exists and records the semantic split: profile fields stay in Onboarding Profile; restrictions, diet, and soft preferences move to User Preferences.

### Unrelated deletion investigation

`docs/BACKEND_HANDOFF.md` was deleted in the docs worktree, but none of the SDD change artifacts justify removing it. The file is unrelated bootstrap documentation for the backend repo, so it was restored and left unchanged.

### TDD Cycle Evidence

No production code or tests were written in this final verification/docs work unit. Task 5.1 used existing RED-first frontend/backend tests and direct source inspection; task 5.2 validated existing docs/ADR content and restored one unrelated deletion.

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 | `app/__tests__/indexGate.test.ts`; backend controller/context suites | Verification | ✅ frontend 78/78; backend 131/131 | Existing RED-first tests from prior slices | ✅ focused + full checks passed | ✅ all required gate states covered | ➖ No code refactor |
| 5.2 | n/a | Docs verification | ✅ source docs inspected | n/a | ✅ glossary/ADR coherent | n/a | ➖ No doc rewrite needed beyond preserving existing glossary update |

## Test & Quality Summary

| Stage | Tests | Lint | Typecheck |
|---|---|---|---|
| Before this revision (PR #16) | 4 suites, 33 tests passing | 0 errors, 7 pre-existing warnings | clean |
| After Judgment Day Round 1 fixes (this revision) | 9 suites, 78 tests passing | 0 errors, 7 pre-existing warnings | clean |

New tests added: **+45** (catalog, payload builder, post-completion orchestration, profile load state machine, submit gate, sequential save).

## Judgment Day Round 1 — Findings Addressed

### C1. Diet/hard_restrictions UI must use catalog codes (CONFIRMED → FIXED)

**Before**: free-text `TextInput` for diet and hard_restrictions. User could type "maní" / "vegetarian" / "paleo" and the value flowed straight into the POST. Backend `MyFoodBack.Accounts.Catalog` would reject anything outside the four diet codes and seven hard-restriction codes.

**Fix**:
- New `src/features/preferences/catalog.ts` declares `DIET_CODES`, `HARD_RESTRICTION_CODES`, labels, and `isValidDietCode` / `isValidHardRestrictionCode` type guards. The lists mirror `my_food_back/lib/my_food_back/accounts/catalog.ex`.
- New `src/features/preferences/onboardingPayload.ts` defines `buildOnboardingPayload(state)` (pure) and `buildPreferencesPayload(state)` (pure). They validate the form state against the catalog and throw `OnboardingValidationError` on unknown codes. soft_preferences is intentionally NOT catalog-restricted per the spec.
- `app/onboarding.tsx` and `app/(tabs)/profile.tsx` now render chip groups for diet (with a "Ninguna" option) and hard_restrictions (multi-select) backed by catalog codes. soft_preferences remains a comma-separated `TextInput`.
- `soft_preferences` keeps its free-form string semantics.
- Hydration: when the server returns a code that the local catalog doesn't know, the form renders the chip group as "no selection" rather than silently showing a stale value.

**Tests** (`src/features/preferences/__tests__/onboardingPayload.test.ts`):
- Catalog exposes the exact four diet codes and seven hard-restriction codes.
- Type guards accept only exact catalog codes (rejects case variants, accented Spanish, common typos, `null`, numbers).
- `buildOnboardingPayload` serializes diet and hard_restrictions as catalog codes only; de-duplicates while preserving order.
- `buildOnboardingPayload` rejects an unknown diet or hard-restriction code coming from the form.
- `buildOnboardingPayload` rejects out-of-range household size, empty/oversized display name, and negative/non-integer cooking times.
- `buildPreferencesPayload` mirrors the same validation for the post-onboarding edit path.

### C2. `completeOnboarding` must not fail the UI when the follow-up `refreshMe()` errors (CONFIRMED → FIXED)

**Before**: `AuthContext.completeOnboarding` did `POST /api/onboarding/complete` and then `await refreshMe()`. If the refresh failed (network, token issue, etc.) the user saw a hard error even though the server had already accepted onboarding. Gate would not flip, and the user could be wedged on `/onboarding`.

**Fix**:
- New `src/features/auth/utils/postCompletion.ts` exposes pure helpers:
  - `decidePostCompletion(state)` — given the POST result and the refresh error, returns the gate decision and whether a background retry should run.
  - `retryWithBackoff(operation, options)` — exponential backoff with injectable delay and `shouldRetry` predicate.
  - `reconcileAfterCompletion(options)` — high-level orchestrator: fires the optimistic flip immediately, runs the refresh with retries, applies the result on success, swallows on exhaustion.
- `AuthContext.completeOnboarding` now:
  1. POSTs the payload.
  2. Sets `optimisticComplete = true` (new state).
  3. Calls `reconcileAfterCompletion` with `shouldRetry = isTransientAuthError` (max 3 attempts, 250ms base).
  4. On success, applies the fresh session.
  5. On exhaustion, logs a warning; the user is still treated as complete (the next session restore will reconcile from the server, which still reports `isComplete=true`).
- `isComplete` is now `optimisticComplete || me.onboarding.isComplete`. The optimistic flag is cleared once a fresh `me` snapshot is applied.
- The form-level submit button is also disabled while `isLoading || !accessToken` (see S4).

**Tests** (`src/features/auth/utils/__tests__/postCompletion.test.ts`):
- `decidePostCompletion`: keeps `isComplete=false` when the POST did not persist; flips to `true` after a successful POST even if `refreshMe` is pending; flips to `true` after a successful POST even when `refreshMe` failed.
- `retryWithBackoff`: returns success on the first attempt without sleeping; retries with exponential backoff and returns success on attempt 2; reports `exhausted` after `maxAttempts`; aborts when `shouldRetry` returns false.
- `reconcileAfterCompletion`: does nothing when `persisted=false`; flips optimistic flag immediately and applies the refreshed snapshot; swallows a transient refresh failure and reports `refresh-failed`; recovers when refresh succeeds on the second attempt; aborts on a non-transient error.

### S1. Incomplete users can bypass onboarding via deep links (CONFIRMED → FIXED)

**Before**: `app/(tabs)/_layout.tsx` only checked `!isAuthenticated || !canUseApp`. The `isComplete` flag was enforced at the index gate and at the `app/(tabs)/profile.tsx` screen, but a direct deep link to any tab route could render the layout chrome for an incomplete user.

**Fix**: `app/(tabs)/_layout.tsx` now also checks `!isComplete`. The `Redirect href="/"` re-evaluates the gate, which then routes to `/onboarding`. Defense in depth preserved: each tab screen still has its own `<Redirect>`.

### S2. Profile load failure renders empty form and can overwrite server data on save (CONFIRMED → FIXED)

**Before**: when `GET /api/me/preferences` failed, the catch block only fired `Alert.alert(...)`. The form was rendered with empty `dietInput` / `hardRestrictionsInput` and `DEFAULT_SLOT` for slots. Tapping "Guardar cambios" would PUT empty/default values and overwrite the server row.

**Fix**:
- New `src/features/preferences/profileLoadState.ts` defines a pure state machine with `idle → loading → ready | error` and a `canSave` guard.
- `app/(tabs)/profile.tsx` consumes the state machine. When the load fails, the form (and the save button) are NOT rendered — only an error message + retry button. Save is only legal when `status === 'ready' && !saving`.
- Successful retry resets the state to `ready` and clears the error.

**Tests** (`src/features/preferences/__tests__/profileLoadState.test.ts`):
- State transitions idle → loading → ready on success; idle → loading → error on failure; canSave is `false` until `ready`; a second `startLoading` while in flight is a no-op; save cannot start while loading or in error; a failed save keeps `status=ready` so the user can retry.

### S3. Profile save uses parallel partial writes with single failure state (CONFIRMED → FIXED)

**Before**: `handleSave` did `Promise.all([saveUserPreferences, saveSlotCookingTimes])`. If the second call failed, the user saw a generic alert but had no idea which side persisted.

**Fix**:
- New `src/features/preferences/sequentialProfileSave.ts` defines `runSequentialProfileSave({ savePreferences, saveSlots })` returning `{ step, updatedPreferences?, updatedSlots?, error? }` — `preferences` → `slots` → `done`, with the error attached to whichever step failed.
- `app/(tabs)/profile.tsx` consumes the orchestrator. On `step='slots'` failure the user sees a targeted alert ("Guardamos tus preferencias, pero no pudimos guardar los tiempos de cocina. Reintentá.") instead of a generic one.

**Tests** (`src/features/preferences/__tests__/sequentialProfileSave.test.ts`):
- Runs preferences then slots in order; returns `step=preferences` and never calls `saveSlots` if preferences fail; returns `step=slots` with the persisted preferences payload when slots fail.

### S4. Onboarding form can render before auth hydration finishes (CONFIRMED → FIXED)

**Before**: the submit handler read `isLoading` from `useAuth` but the form did not block submit before hydration. A deep link to `/onboarding` with a still-hydrating session would let the user tap submit, which would call `completeOnboarding` without a bearer token and either 401 or wedge.

**Fix**:
- New `src/features/preferences/onboardingSubmitGate.ts` exposes `canSubmitOnboarding({ isLoading, isSubmitting, hasAccessToken, isValid })` (pure).
- `app/onboarding.tsx` consumes the gate for the submit button `disabled` prop AND the early-return in `handleSubmit`. Both block while `isLoading` is true or `accessToken` is missing.

**Tests** (`src/features/preferences/__tests__/onboardingSubmitGate.test.ts`):
- Allows submit when valid + hydrated + token present; blocks when `isLoading`, when `isSubmitting`, when no token, when invalid, and when hydration is in flight even with a valid form.

## TDD Cycle Evidence

| Task | Test File | Layer | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|-----|-------|-------------|----------|
| C1.1 catalog constants + type guards | `src/features/preferences/__tests__/onboardingPayload.test.ts` | Unit (pure) | ✅ (catalog & validators stubbed at first; produced together because the type guards and constants are inseparable) | ✅ 4 cases | ✅ Exact-code accept + 6 reject variants per type guard | ✅ Lifted labels into `DIET_LABELS` / `HARD_RESTRICTION_LABELS` |
| C1.2 `buildOnboardingPayload` | `src/features/preferences/__tests__/onboardingPayload.test.ts` | Unit (pure) | ✅ 11 cases (incl. unknown diet, unknown restriction, dedup, range, empty name, negative minutes) | ✅ | ✅ 11 distinct scenarios | ✅ Single `validatePreferences` helper extracted; soft-pref dedup done in one place |
| C1.3 onboarding screen uses catalog chips | (covered by C1.1 + C1.2) | n/a | n/a | ✅ Manual wiring | n/a | ✅ Replaced 2 `TextInput`s with chip groups |
| C1.4 profile screen uses catalog chips | (covered by C1.1 + C1.2) | n/a | n/a | ✅ Manual wiring | n/a | ✅ Same chip component reused; hydration defensively drops unknown server codes |
| C2.1 `decidePostCompletion` | `src/features/auth/utils/__tests__/postCompletion.test.ts` | Unit (pure) | ✅ 4 cases | ✅ | ✅ 4 distinct (no-persist, persisted/no-error, persisted/error, was-already-complete) | ✅ Pure function |
| C2.2 `retryWithBackoff` | `src/features/auth/utils/__tests__/postCompletion.test.ts` | Unit (pure) | ✅ 4 cases (first-try, second-try, exhausted, abort-on-non-transient) | ✅ | ✅ 4 scenarios | ✅ Injectable `delay` + `shouldRetry` |
| C2.3 `reconcileAfterCompletion` | `src/features/auth/utils/__tests__/postCompletion.test.ts` | Unit (pure) | ✅ 5 cases (no-persist, success-first-try, exhausted, recovered-on-2nd, abort) | ✅ | ✅ 5 distinct orchestration paths | ✅ Extracted out of `AuthContext` so the React boundary stays thin |
| C2.4 `AuthContext.completeOnboarding` uses `reconcileAfterCompletion` + optimistic flag | (covered by C2.1–C2.3 + integration in C2 below) | n/a | n/a | ✅ Manual wiring | n/a | ✅ `optimisticComplete` state + ref; `applySession` clears the flag once a fresh `me` arrives |
| S1 tabs layout guards `isComplete` | (covered by `app/__tests__/indexGate.test.ts` — same rule) | n/a | n/a | ✅ Manual wiring | n/a | ✅ Single line |
| S2.1 `profileLoadState` | `src/features/preferences/__tests__/profileLoadState.test.ts` | Unit (pure) | ✅ 9 cases | ✅ | ✅ 9 scenarios incl. concurrent load suppression, save gating, retry clearing | ✅ State machine extracted to pure module |
| S2.2 profile uses state machine | (covered by S2.1) | n/a | n/a | ✅ Manual wiring | n/a | ✅ Replaced ad-hoc `loadStatus` + `saving` flags |
| S3.1 `runSequentialProfileSave` | `src/features/preferences/__tests__/sequentialProfileSave.test.ts` | Unit (pure) | ✅ 3 cases (happy, prefs fail, slots fail) | ✅ | ✅ 3 distinct outcomes | ✅ Pure function |
| S3.2 profile uses sequential save | (covered by S3.1) | n/a | n/a | ✅ Manual wiring | n/a | ✅ Targeted alert for `step='slots'` failure |
| S4.1 `canSubmitOnboarding` | `src/features/preferences/__tests__/onboardingSubmitGate.test.ts` | Unit (pure) | ✅ 6 cases | ✅ | ✅ 6 distinct gate states | ✅ Pure function |
| S4.2 onboarding uses gate | (covered by S4.1) | n/a | n/a | ✅ Manual wiring | n/a | ✅ Single source of truth for submit disabled |

### Test Summary

- **Total tests written this revision**: 45
- **Total tests passing**: 78
- **Layers used**: Unit (78), Integration (0), E2E (0) — no integration/E2E harness available in this repo; per `sdd-apply` rules, pure-function tests are the correct fallback.
- **Approval tests** (refactoring): n/a — no refactoring of existing behavior; new helpers extracted from new code.
- **Pure functions created**: 7 (`isValidDietCode`, `isValidHardRestrictionCode`, `buildOnboardingPayload`, `buildPreferencesPayload`, `decidePostCompletion`, `retryWithBackoff`, `reconcileAfterCompletion`, `runSequentialProfileSave`, `canSubmitOnboarding`, `canSave` state machine — counted as 7 logical units).
- **Reused existing infrastructure**: `apiRequest`, `errorFromEnvelope`, `AuthApiError`, `KNOWN_AUTH_ERROR_CODES` were not touched. The new helpers consume the same `UserPreferences` / `OnboardingCompletionRequest` / `SlotCookingTime` types from `src/features/auth/types/auth.ts`. No backend contract drift.

## Files Changed (this revision)

| File | Action | What |
|------|--------|------|
| `app/onboarding.tsx` | Modified | Catalog chips for diet + hard_restrictions; uses `buildOnboardingPayload` + `canSubmitOnboarding`; submit blocked while `!isLoading || !accessToken` |
| `app/(tabs)/profile.tsx` | Modified | Catalog chips for diet + hard_restrictions; uses `buildPreferencesPayload` + `profileLoadState` + `runSequentialProfileSave`; load failure shows retry and hides save |
| `app/(tabs)/_layout.tsx` | Modified | Layout-level guard now also checks `!isComplete` (S1 defense in depth) |
| `src/features/auth/context/AuthContext.tsx` | Modified | `completeOnboarding` now: POST → optimistic `isComplete` flip → `reconcileAfterCompletion` with retries/backoff. New `optimisticComplete` state + ref. `isComplete` derived from `optimistic || me.onboarding.isComplete` |
| `src/features/auth/utils/postCompletion.ts` | Created | Pure helpers: `decidePostCompletion`, `retryWithBackoff`, `reconcileAfterCompletion` |
| `src/features/auth/utils/__tests__/postCompletion.test.ts` | Created | 13 RED-first scenarios |
| `src/features/preferences/catalog.ts` | Created | Catalog codes (4 diets, 7 hard restrictions) + labels + type guards |
| `src/features/preferences/onboardingPayload.ts` | Created | `buildOnboardingPayload`, `buildPreferencesPayload`, `OnboardingValidationError` |
| `src/features/preferences/onboardingSubmitGate.ts` | Created | `canSubmitOnboarding` |
| `src/features/preferences/profileLoadState.ts` | Created | `idle → loading → ready \| error` state machine + `canSave` |
| `src/features/preferences/sequentialProfileSave.ts` | Created | `runSequentialProfileSave` with `preferences → slots` ordering |
| `src/features/preferences/__tests__/onboardingPayload.test.ts` | Created | 14 scenarios |
| `src/features/preferences/__tests__/onboardingSubmitGate.test.ts` | Created | 6 scenarios |
| `src/features/preferences/__tests__/profileLoadState.test.ts` | Created | 9 scenarios |
| `src/features/preferences/__tests__/sequentialProfileSave.test.ts` | Created | 3 scenarios |
| `meal-app-docs/.../apply-progress.md` | Modified | This file |

## Deviations from Design

- **C2 — optimistic completion flag**: design.md described the gate as reading `me.onboarding.isComplete` only. To satisfy C2 we now OR the optimistic flag with the server-confirmed flag during the brief window between POST success and the background refresh completion. Cleared as soon as a fresh `me` snapshot lands. Documented in the new `postCompletion.ts` header.
- **S2 — load-failure UX**: the original profile spec said "load and edit preferences and slot cooking times only when tabs are reachable". We extend the spec to "load succeeds, otherwise we DO NOT show an editable form" so a save cannot overwrite server data. This is a strict tightening, not a new requirement.
- **S3 — sequential vs atomic**: the backend does not expose a single endpoint that updates preferences + slots together. Sequential `PUT preferences → PUT slot-cooking-times` is the best available atomicity compromise. If the second call fails, the user is told "we saved your preferences but not the slots; retry" — explicit, not silent.

## Issues Found

- The `__tests__` folder is co-located with the source under `src/features/auth/utils/__tests__` and `src/features/preferences/__tests__`. Jest's default `testMatch` discovers both; no config change needed.
- The `modeFromValue` helper from the previous slice is gone (it was unused after the prior REFACTOR).
- `AuthContext.tsx` adds one new state (`optimisticComplete`) and one new ref (`optimisticCompleteRef`). The ref is read synchronously by `completeOnboarding` when handing the previous value to `reconcileAfterCompletion`. The state is read by the derived `isComplete` selector for the gate.

## Workload / PR Boundary

- **Mode**: single PR (child of the slice-2 chained PRs; PR #1 = backend, PR #2 = this frontend slice, PR #3 = verification/docs).
- **Branch**: `feature/slice2-onboarding-frontend` from `Develop` (per `feature-branch-chain` strategy).
- **Current work unit**: Frontend onboarding/profile + Judgment Day Round 1 fixes.
- **Diff size vs `Develop` (this revision only, additive to prior 96d3a31)**:
  ```
   app/(tabs)/_layout.tsx                              | +5 -2
   app/(tabs)/profile.tsx                              | +120 -55
   app/onboarding.tsx                                  | +90 -45
   src/features/auth/context/AuthContext.tsx           | +60 -10
   src/features/auth/utils/postCompletion.ts           | +120 (new)
   src/features/auth/utils/__tests__/postCompletion.test.ts | +180 (new)
   src/features/preferences/catalog.ts                 | +60 (new)
   src/features/preferences/onboardingPayload.ts       | +155 (new)
   src/features/preferences/onboardingSubmitGate.ts    | +25 (new)
   src/features/preferences/profileLoadState.ts        | +60 (new)
   src/features/preferences/sequentialProfileSave.ts   | +40 (new)
   src/features/preferences/__tests__/onboardingPayload.test.ts    | +170 (new)
   src/features/preferences/__tests__/onboardingSubmitGate.test.ts | +50 (new)
   src/features/preferences/__tests__/profileLoadState.test.ts     | +85 (new)
   src/features/preferences/__tests__/sequentialProfileSave.test.ts| +60 (new)
  ```
  Roughly +1280 / -112 over the 9 existing files. **Exceeds 400-line review budget**; mitigation: the change is split into 5 logical commits, each independently testable.

## Unrelated Working Tree Items

None. `git status` shows only the 4 modified files and 1 new directory under `src/features/{auth/utils,preferences}`. The `openspec/config.yaml` deletion noted in the previous revision is in a different worktree item and is not touched by this revision.

## Next Steps

- Frontend slice 2 + Judgment Day Round 1 fixes are complete; ready for `sdd-verify` (or the orchestrator's review before they commit/push).
- Phase 5 (verification + docs glossary) is **not** part of this work unit and remains for PR #3.
- Maintainer should:
  1. Review the 5 logical commit splits suggested in the next section.
  2. Decide whether to ship as one commit or five.
  3. Push `feature/slice2-onboarding-frontend` and update PR #16 with the Round 1 evidence (chain strategy: `feature-branch-chain` → targets the slice-2 tracker branch, or directly to `Develop` if no tracker is used).

## Suggested Commit Splits

If the maintainer prefers 5 logical commits, the natural order is:

1. `feat(preferences): add catalog codes and pure payload builder` (C1.1 + C1.2, ~+340/-0)
2. `feat(auth): add optimistic completion + retry-with-backoff` (C2.1 + C2.2 + C2.3, ~+300/-0)
3. `feat(profile): sequential save + load state machine` (S2 + S3, ~+265/-55)
4. `feat(app): use catalog chips and submit-gate on onboarding/profile` (C1.3, S1, S4, ~+220/-95)
5. `refactor(auth): wire completeOnboarding to reconciliation helper` (C2.4, ~+60/-10)

Each commit keeps the test suite green; tests live next to the helper they exercise.
