# Proposal: Slice 2 — Onboarding + Preferences

## Intent

Slice 1 ships auth, accounts, trial gate, and `/api/me` onboarding status. After login users hit tabs with no identity or preferences. Slice 2 captures an **Onboarding Profile** and minimum **User Preferences** once, gates the app on completion, and keeps both editable from a Profile tab when app access is available.

## Scope

- Backend: `user_preferences` schema, `Accounts` context, `GET/PUT /api/me/preferences`, transactional `POST /api/onboarding/complete`, strict-TDD.
- `/api/me` stays limited to `onboarding.isComplete`; full preferences on the dedicated endpoint.
- Frontend: Onboarding screen + route, Profile tab, gate order in `app/index.tsx`, `/me` refresh.

**Out of scope**: family accounts, billing, AI planning, recipes, shopping, inventory, audit log, catalog codes, soft-preference schema beyond a free-form string.

## Glossary Delta

The product glossary currently defines `Onboarding Profile` as including `restrictions` and `preferences` alongside display name, cooking skill, and household size. This slice intentionally narrows the captured `Onboarding Profile` to `display_name`, `household_size`, and `cooking_skill`. Restrictions, diet, and soft preferences move into the new `User Preferences` capability, which is captured in the same onboarding flow but stored and edited as a separate domain entity. This is a deliberate semantic change, not an implementation detail. The product glossary will be updated as part of this slice's documentation work.

## Capabilities

### New Capabilities

- `user-onboarding`: Onboarding Profile (`display_name`, `household_size`, `cooking_skill`), one-way `isComplete`, transactional completion stamping `users.onboarding_completed_at`; requires valid User Preferences and slot cooking times in the same submission.
- `user-preferences`: `diet` + `hard_restrictions[]` (controlled catalogs), `soft_preferences[]` (free-form); readable + updatable post-onboarding; never returned by `/me`.
- `user-slot-cooking-times`: per-(User, meal_slot) `cooking_time_minutes` (non-negative integer; `0` means no cook) and `hunger_level` (`light` | `normal` | `strong`) for the MVP slots `breakfast`, `lunch`, `dinner`; required input of the onboarding flow; editable from the Profile tab when app access is available.

### Modified Capabilities

- `auth-account-trial`: clarifies that authenticated pre-app setup endpoints needed for onboarding may remain available while an Account is in Access Lock, while Tabs and protected internal app data remain blocked when `account.access.canUseApp = false`.


## Approach

Backend contract first. One `user_preferences` row per user. `POST /api/onboarding/complete` is transactional (validate profile, preferences, slot cooking times, stamp `onboarding_completed_at`); `GET/PUT /api/me/preferences` handles edits. Frontend adds an `onboarding` route, a Profile tab, reorders `app/index.tsx`: unauth → AuthLanding; authenticated + incomplete → Onboarding even if the Account is locked; complete + locked → TrialExpired; complete + usable → Tabs. Strict TDD: backend RED-first; frontend unit tests for gate + service. `isComplete` is one-way; re-login or reinstall skips onboarding when true.

## Affected Areas

- `meal-app-docs/openspec/specs/user-onboarding/spec.md`, `…/user-preferences/spec.md`, `…/user-slot-cooking-times/spec.md` — new full specs.
- `meal-app-docs/openspec/specs/auth-account-trial/spec.md` — modified trial gate semantics for pre-app setup endpoints.
- `my_food_back`: `accounts.ex` modified; `user_preferences.ex`, `user_slot_cooking_times.ex` schemas, migrations, router, accounts tests new/modified.
- `my-expo-app`: `app/index.tsx`, `authService.ts` modified; `app/onboarding/*`, `(tabs)/profile.tsx` new.


## Risks

- Catalog codes for `diet` / `hard_restrictions` undefined → spec accepts placeholders, final list owned by product.
- 400-line review budget → chained PRs: docs/spec → backend → frontend → E2E.
- `RequireUnlockedAccount` blocks post-expiry onboarding → onboarding setup endpoints accept sessions regardless of `canUseApp`; Tabs and protected app data stay locked.
- Soft preferences drift un-normalized → free-form string in scope; normalization deferred.

## Rollback Plan

Revert the backend PR (drop routes, down-migrate `user_preferences` and `user_slot_cooking_times`); revert the frontend PR to the Slice 1 gate order. No data loss outside abandoned rows.

## Dependencies

- Slice 1 `auth-account-trial` spec (frozen).
- `RequireUnlockedAccount` plug.

## Success Criteria

- [ ] Backend tests RED→GREEN for onboarding + preferences contexts, completion, and access gating.
- [ ] `POST /api/onboarding/complete` rejects missing profile, preferences, or slot cooking-time fields and atomically stamps `onboarding_completed_at` only after persisting all three groups.
- [ ] `/api/me` shape unchanged; full preferences only on `/api/me/preferences`.
- [ ] Frontend gate order matches spec; onboarding skipped on re-login and reinstall when `isComplete = true`.
- [ ] Profile edits round-trip via `PUT /api/me/preferences` and survive restart.
- [ ] Slot cooking-time edits round-trip via `PUT /api/me/slot-cooking-times` and survive restart.

## Open Questions

- Exact MVP catalog codes for `diet` and `hard_restrictions`.
- Whether `soft_preferences` has extra fields beyond `string`.
- Whether to keep an audit log of preferences changes.
