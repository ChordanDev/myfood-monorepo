## Exploration: Slice 2 — Onboarding + Preferences

### Current State

Slice 1 is archived and the canonical spec is `openspec/specs/auth-account-trial/spec.md`. It defines `/api/me` as the frontend gate and explicitly returns `onboarding: { isComplete: false }` while omitting the full preferences collection.

Backend (`../my_food_back`) has a Phoenix JSON API with `MyFoodBack.Accounts` and `MyFoodBack.Auth`. The `users` table already has `display_name` and `onboarding_completed_at`, but there is no persisted User Preferences model, no onboarding update function, and no onboarding/preferences routes. `/api/me` derives onboarding completion from `user.onboarding_completed_at` and `RequireUnlockedAccount` is available for future protected app-data endpoints.

Frontend (`../my-expo-app`) has Slice 1 auth flow, token storage via `expo-secure-store`, `/api/me` refresh/restore logic in `authService.ts`, and app gating in `app/index.tsx` plus `app/(tabs)/_layout.tsx`. It already stores `me.onboarding.isComplete` in types, but routing does not yet branch on incomplete onboarding. Existing domain types include a local `UserPreferences` shape (`budgetMode`, `budgetLevel`, `totalBudget`, `restrictions`, `preferences`) that is not wired to the backend contract.

### Affected Areas

- `openspec/specs/auth-account-trial/spec.md` — existing `/me` contract must stay compatible; Slice 2 should add a new domain spec instead of returning full preferences from `/me`.
- `openspec/changes/implement-onboarding-preferences/specs/.../spec.md` — new delta spec should define Onboarding Profile and User Preferences contracts.
- `../my_food_back/lib/my_food_back/accounts.ex` — likely owner of onboarding completion and current User Preferences operations.
- `../my_food_back/lib/my_food_back/accounts/user.ex` — already has `display_name` and `onboarding_completed_at`; may need a focused onboarding changeset.
- `../my_food_back/priv/repo/migrations/*` — needs schema for User Preferences data unless the product narrows Slice 2 to display name only.
- `../my_food_back/lib/my_food_back_web/router.ex` — add authenticated/unlocked onboarding/preferences endpoints under `/api`.
- `../my_food_back/lib/my_food_back_web/controllers/*` and `*_json.ex` — add Phoenix 1.8 JSON controllers/serializers for onboarding/preferences.
- `../my_food_back/test/my_food_back/accounts_test.exs` and controller tests — strict TDD coverage for persistence, validation, `/me` onboarding state, and access gating.
- `../my-expo-app/src/features/auth/context/AuthContext.tsx` — route decisions should consider authenticated + canUseApp + onboarding incomplete.
- `../my-expo-app/app/index.tsx` — should route incomplete onboarding users to onboarding before tabs.
- `../my-expo-app/src/services/authService.ts` — existing authenticated fetch pattern can be extended with onboarding/preferences requests.
- `../my-expo-app/src/features/auth/types/auth.ts` — may need enriched onboarding status only if `/me` adds stable step metadata; full preferences should remain separate.
- `../my-expo-app/src/types/domain.ts` — existing local preferences shape may need replacement/alignment with canonical Slice 2 terms.
- `../my-expo-app/app/(tabs)/profile.tsx` — likely future edit surface for User Preferences after onboarding completion.

### Approaches

1. **Backend contract first, frontend consumes after** — Define a dedicated User Preferences resource and onboarding completion endpoint, keep `/me` limited to onboarding status, then wire frontend routing/forms.
   - Pros: Preserves Slice 1 `/me` boundary, enables backend-first TDD, creates reusable data for future Planning Context, supports E2E validation cleanly.
   - Cons: Requires product decisions on fields and validation before implementation; more backend work than a frontend-only onboarding screen.
   - Effort: Medium

2. **Single onboarding submit endpoint** — Add one endpoint that accepts display name plus all preferences and marks onboarding complete transactionally.
   - Pros: Simple frontend flow, fewer API calls, strong atomic completion semantics.
   - Cons: Less flexible for later editing preferences; may conflate Onboarding Profile completion with ongoing User Preferences management.
   - Effort: Medium

3. **Frontend-only onboarding with local state** — Route incomplete users through local onboarding UI and persist preferences on device only.
   - Pros: Fastest UI iteration and no backend migration.
   - Cons: Violates source-of-truth needs for Planning Context, breaks cross-device behavior, cannot reliably drive `/me.onboarding.isComplete`, and is weak for E2E validation.
   - Effort: Low initially, High cleanup later

### Recommendation

Use Approach 1 with a small transactional completion path from Approach 2: backend-first contract for `GET/PUT /api/me/preferences` (or equivalent) plus `POST /api/onboarding/complete`, with the completion call validating required Onboarding Profile fields and marking `users.onboarding_completed_at`. The frontend should route authenticated, unlocked, incomplete users to onboarding before tabs, submit through the authenticated API client, then refresh `/api/me` so `onboarding.isComplete` becomes the single navigation source of truth.

Keep `/api/me` limited to identity, account access, membership, and onboarding status. Do not return full User Preferences from `/api/me`; that boundary is already explicit in Slice 1.

### Risks

- Product scope is not fully specified: required vs optional preferences, controlled vocabularies, cooking skill, household size, budget, allergies, and dietary labels need decisions before spec.
- Existing frontend UI copy and comments are Spanish, while generated SDD artifacts must remain English; implementation should follow project UI language intentionally, not persona style.
- The current frontend uses NativeWind/className patterns even though the loaded Expo UI skill prefers inline styles; proposal/design should decide whether to preserve current project style for consistency.
- If `RequireUnlockedAccount` guards onboarding endpoints, expired-trial users may be unable to complete onboarding after returning; product must decide whether onboarding is allowed for locked Accounts.
- A large combined docs + backend + frontend slice could exceed the 400-line review budget; likely split into docs/backend contract PR and frontend consumption PR.

### Open Product Questions

- Which Onboarding Profile fields are required for completion: display name, Hard Restrictions, Soft Preferences, cooking skill, household size, budget, goals?
- Should Hard Restrictions and Soft Preferences be free text, controlled option IDs, or both?
- Are User Preferences editable after onboarding in the MVP, and should edits unset onboarding completion if required fields become empty?
- Should onboarding be allowed when `account.access.canUseApp` is false due to Trial Period expiry?
- Should household size live on the User's Onboarding Profile in the individual-first MVP, or on the Account for future Family Account support?

### Ready for Proposal

Yes — with the caveat that the proposal should explicitly surface the product questions above and select a small MVP contract before spec/design. Recommended next phase: `sdd-propose` for `implement-onboarding-preferences`, followed by backend-first `sdd-spec`/`sdd-design` and then frontend consumption planning.
