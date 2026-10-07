# Design: Slice 2 — Onboarding + Preferences

## Technical Approach

Extend the existing Slice 1 auth/session graph without changing `/api/me` except `onboarding.isComplete`. Backend stores profile fields on `users`, adds separate per-User preferences and slot cooking-time resources, and completes onboarding through one `Ecto.Multi`. Frontend adds an authenticated pre-app onboarding route, keeps locked Accounts out of tabs, and exposes post-onboarding edits only from the Profile tab.

## Architecture Decisions

| Area | Choice | Rationale |
|---|---|---|
| Tables | Add `users.household_size`, `users.cooking_skill`; create `user_preferences` with unique `user_id`; create `user_slot_cooking_times` with unique `(user_id, meal_slot)`. | Profile data is lifecycle-bound to User completion; preferences and slot settings are editable resources. |
| Context | Keep operations in `MyFoodBack.Accounts`: `complete_onboarding/3`, `get/update_user_preferences/2`, `get/update_slot_cooking_times/2`. | Existing account graph and current-account logic live there; avoids controller business logic. |
| Transaction | `complete_onboarding` validates profile, preferences, and all three slots before stamping `onboarding_completed_at`. | Prevents partial onboarding and preserves one-way completion. |
| Catalog validation | Server-side module/config validates diet and hard-restriction codes; exact seed list remains product TBD. | Client cannot define valid codes; avoids inventing catalog content. |
| Locked access | Routes use `AuthenticateSession`; setup endpoints are not piped through `RequireUnlockedAccount`. Protected app-data routes should use a separate unlocked pipeline. | Locked incomplete Accounts must complete setup; tabs/internal app data stay blocked. |

## Data Flow

```text
Signup/Login -> AuthContext stores me
  -> index gate: unauth -> AuthLanding
  -> incomplete -> /onboarding (even locked)
/onboarding POST /api/onboarding/complete
  -> Accounts.complete_onboarding Ecto.Multi
  -> refreshMe()/GET /api/me
  -> complete+locked TrialExpired | complete+canUseApp /(tabs)/home
Profile tab -> GET/PUT preferences + slot-cooking-times -> reload form data
```

## File Changes

| File | Action | Description |
|---|---|---|
| `my_food_back/priv/repo/migrations/*_add_onboarding_preferences.exs` | Create | Add profile columns and two resource tables/indexes. |
| `my_food_back/lib/my_food_back/accounts/user.ex` | Modify | Cast/validate `display_name`, `household_size`, `cooking_skill`; never clear completion. |
| `my_food_back/lib/my_food_back/accounts/user_preferences.ex` | Create | Schema/changeset with catalog validation. |
| `my_food_back/lib/my_food_back/accounts/user_slot_cooking_time.ex` | Create | Schema/changeset for breakfast/lunch/dinner, minutes, hunger. |
| `my_food_back/lib/my_food_back/accounts.ex` | Modify | Add read/update/upsert and completion transaction functions. |
| `my_food_back/lib/my_food_back_web/router.ex` | Modify | Add setup routes under authenticated API, outside unlocked plug. |
| `my_food_back/lib/my_food_back_web/controllers/{onboarding,preferences,slot_cooking_times}_controller.ex` | Create | Thin JSON controllers with stable error codes. |
| `my-expo-app/app/index.tsx` | Modify | Gate order: auth → onboarding → lock → tabs. |
| `my-expo-app/app/onboarding.tsx` | Create | Scrollable multi-section setup screen. |
| `my-expo-app/app/(tabs)/profile.tsx` | Create/Modify | Editable profile/preferences/slot settings when tabs are reachable. |
| `my-expo-app/src/services/authService.ts` | Modify | Add setup API functions using existing authenticated fetch/error pattern. |
| `my-expo-app/src/features/auth/context/AuthContext.tsx` | Modify | Expose onboarding completion/refresh path if needed. |
| `my-expo-app/src/features/auth/types/auth.ts` | Modify | Add onboarding/preference/slot types and error codes. |

## Interfaces / Contracts

```json
POST /api/onboarding/complete
{
  "profile": { "displayName": "Lucca", "householdSize": 1, "cookingSkill": "beginner" },
  "preferences": { "diet": "omnivore", "hardRestrictions": [], "softPreferences": [] },
  "slotCookingTimes": {
    "breakfast": { "cookingTimeMinutes": 0, "hungerLevel": "normal" },
    "lunch": { "cookingTimeMinutes": 30, "hungerLevel": "normal" },
    "dinner": { "cookingTimeMinutes": 45, "hungerLevel": "strong" }
  }
}
```

`GET/PUT /api/me/preferences` returns `{ "diet": null|string, "hardRestrictions": string[], "softPreferences": string[] }`. `GET/PUT /api/me/slot-cooking-times` returns the three supported slot keys; missing rows read as defaults. Errors: `onboarding_invalid`, `onboarding_already_complete`, `preferences_invalid`, `slot_cooking_times_invalid`.

## Testing Strategy

| Layer | RED-first tests |
|---|---|
| Backend context | Changesets reject invalid profile/catalog/slot values; `Ecto.Multi` leaves no partial rows; completion is one-way. |
| Backend controllers | Anonymous rejected; locked Accounts can call setup endpoints; `/api/me` excludes full preferences. |
| Frontend services | Calls correct endpoints, sends bearer token, maps new error codes. |
| Frontend gate | Incomplete locked routes to onboarding; complete locked routes to TrialExpired; tabs require `canUseApp`. |

Run `cd ../my_food_back && mix test`, `mix precommit`, `cd ../my-expo-app && npm test`, and `npm run lint`.

## Migration / Rollout

Add nullable profile columns and new empty tables; existing Users remain `onboarding.isComplete=false` until completion. Rollback drops new tables/columns. No catalog seed list is defined here; product/server catalog setup is a prerequisite for final implementation.

## Open Questions

- [ ] Exact MVP catalog codes for `diet` and `hard_restrictions`.
- [ ] Whether `soft_preferences` remains `string[]` only after MVP.
- [ ] Whether preference-change audit logging is needed later.
