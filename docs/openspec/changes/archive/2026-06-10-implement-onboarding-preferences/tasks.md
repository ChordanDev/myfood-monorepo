# Tasks: Slice 2 — Onboarding + Preferences

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900-1,300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Backend API → Frontend onboarding/profile → E2E/verification; docs/spec PR only for glossary delta if not already covered |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Backend persistence/API | PR 1 | Base: backend `develop`; include ExUnit RED/GREEN and migrations. |
| 2 | Frontend onboarding/profile | PR 2 | Base: frontend `Develop`; depends on backend contract. |
| 3 | Cross-repo verification/docs | PR 3 | E2E/manual checks; docs glossary PR if needed, base docs `develop`. |

## Phase 1: Backend RED

- [x] 1.1 Add failing migration/schema tests for `users.household_size`, `users.cooking_skill`, `user_preferences`, and `user_slot_cooking_times` in `my_food_back/test/my_food_back/accounts_test.exs`.
- [x] 1.2 Add failing context tests for `MyFoodBack.Accounts.complete_onboarding/3`, preferences, slot cooking times, one-way completion, and atomic rollback.
- [x] 1.3 Add failing controller tests in `my_food_back/test/my_food_back_web/controllers/*_test.exs` for auth, locked-account setup access, `/api/me` shape, and stable error codes.

## Phase 2: Backend GREEN/REFACTOR

- [x] 2.1 Create migration `my_food_back/priv/repo/migrations/*_add_onboarding_preferences.exs` with columns, tables, unique indexes, and rollback.
- [x] 2.2 Update `my_food_back/lib/my_food_back/accounts/user.ex`; create `user_preferences.ex` and `user_slot_cooking_time.ex` changesets with catalog/slot validation.
- [x] 2.3 Implement `Accounts.complete_onboarding/3`, read/update preferences, and read/update slot cooking times in `my_food_back/lib/my_food_back/accounts.ex` using `Ecto.Multi`.
- [x] 2.4 Add authenticated setup routes in `my_food_back/lib/my_food_back_web/router.ex` outside `RequireUnlockedAccount`; create thin JSON controllers.
- [x] 2.5 Run `cd ../my_food_back && mix test`; refactor; then run `mix precommit`.

## Phase 3: Frontend RED

- [x] 3.1 Add failing Jest tests for `app/index.tsx` gate order: unauth, incomplete locked, complete locked, and complete usable.
- [x] 3.2 Add failing service tests for `src/services/authService.ts` setup endpoints, bearer token use, payload shape, and typed error mapping.

## Phase 4: Frontend GREEN/REFACTOR

- [x] 4.1 Update `src/features/auth/types/auth.ts`, `AuthContext.tsx`, and `src/services/authService.ts` with onboarding, preferences, and slot API types/functions.
- [x] 4.2 Modify `app/index.tsx`; create `app/onboarding.tsx` to submit profile, preferences, and all three slot cooking times, then refresh `/me`.
- [x] 4.3 Create/update `app/(tabs)/profile.tsx` to load/edit preferences and slot cooking times only when tabs are reachable.
- [x] 4.4 Run `cd ../my-expo-app && npm test`; refactor; then run `npm run lint`.

## Phase 5: Verification / Docs

- [x] 5.1 Verify onboarding completion routes locked incomplete users to `TrialExpired` when `canUseApp=false`, and usable completed users to tabs.
- [x] 5.2 Update `meal-app-docs/CONTEXT.md` glossary if the Onboarding Profile/User Preferences semantic split is not already merged.
