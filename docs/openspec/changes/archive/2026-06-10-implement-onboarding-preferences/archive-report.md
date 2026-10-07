# Archive Report: implement-onboarding-preferences

**Change**: `implement-onboarding-preferences`
**Archived on**: 2026-06-10
**Archived to**: `openspec/changes/archive/2026-06-10-implement-onboarding-preferences/`
**Mode**: openspec
**Verdict**: PASS WITH WARNINGS (no CRITICAL issues)

## Summary

Slice 2 captured post-authentication Onboarding Profile, minimum User Preferences, and per-slot cooking times, gated the app on completion, and exposed Profile-tab editing for completed Users with app access. Backend, frontend, and verification merged; the change was archived with three new capability specs and one modified capability.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `user-onboarding` | Created | 6 requirements, 16 scenarios. Full spec copied to `openspec/specs/user-onboarding/spec.md`. |
| `user-preferences` | Created | 6 requirements, 12 scenarios. Full spec copied to `openspec/specs/user-preferences/spec.md`. |
| `user-slot-cooking-times` | Created | 6 requirements, 13 scenarios. Full spec copied to `openspec/specs/user-slot-cooking-times/spec.md`. |
| `auth-account-trial` | Modified | 1 requirement modified (`Protected App Data Gate`) with `Previously:` note. All 10 requirements preserved; 2 original scenarios preserved verbatim; 1 new scenario added. |

### Modified requirement details

- `Protected App Data Gate`: now explicitly exempts pre-app setup endpoints (`POST /api/onboarding/complete`, `GET/PUT /api/me/preferences`, `GET/PUT /api/me/slot-cooking-times`) from the access lock, while keeping Tabs and protected internal app data unavailable when `account.access.canUseApp = false`. The first existing scenario is updated to mention completed onboarding. The "Locked incomplete account may complete pre-app setup" scenario is added.

## Task Completion Gate

- `tasks.md`: 16/16 tasks checked (`- [x]`)
- `apply-progress.md`: marked `all_done`
- `verify-report.md`: 0 CRITICAL issues, 27/27 spec scenarios compliant

No archive-time stale-checkbox reconciliation was needed. The persisted tasks artifact was clean before archive.

## Source of Truth Updated

- `openspec/specs/user-onboarding/spec.md` (new)
- `openspec/specs/user-preferences/spec.md` (new)
- `openspec/specs/user-slot-cooking-times/spec.md` (new)
- `openspec/specs/auth-account-trial/spec.md` (modified `Protected App Data Gate`)

## Archive Contents

```
openspec/changes/archive/2026-06-10-implement-onboarding-preferences/
├── apply-progress/
│   └── slice2-backend.md
├── apply-progress.md
├── design.md
├── exploration.md
├── proposal.md
├── specs/
│   ├── auth-account-trial/spec.md   (delta)
│   ├── user-onboarding/spec.md      (full new spec)
│   ├── user-preferences/spec.md     (full new spec)
│   └── user-slot-cooking-times/spec.md (full new spec)
├── tasks.md
└── verify-report.md
```

## Implementation Evidence

- Backend PR #11 merged into `my_food_back/develop`
- Frontend PR #16 merged into `my-expo-app/Develop`
- Backend tests: 131 ExUnit tests, 0 failures (`mix test` and `mix precommit`)
- Frontend tests: 78 Jest tests, 0 failures (`npm test`); typecheck clean; lint passes with 7 pre-existing warnings in unrelated files.

## Known Warnings (non-blocking, do not fail archive)

1. `my-expo-app/CONTEXT.md` is a stale mirror that still defines `Onboarding Profile` as including restrictions/preferences. Authoritative glossary (`meal-app-docs/CONTEXT.md`) and ADR `0001-onboarding-profile-scope.md` are correct. Frontend mirror sync is out of the docs worktree scope and should be tracked as a separate cleanup.
2. Strict TDD evidence includes indirect/manual rows for some UI wiring/docs tasks; runtime tests pass and source inspection supports behavior. Evidence table is not perfectly strict-formatted.
3. `npm run lint` reports 7 pre-existing warnings in unrelated files (`fix-auth-colors.js`, `FoodCard/icons.tsx`, `PlannerChatInput.tsx`).

## Next Steps

- Open a follow-up issue to sync `my-expo-app/CONTEXT.md` to the authoritative `Onboarding Profile` definition.
- Plan Slice 3 (meal planning, recipes, or shopping) with catalog ownership decisions (Q1/Q2/Q3 from the proposal still open).
- Verify the docs branch contains all expected paths (modified main spec + 3 new specs + archived change folder) before opening a docs PR against `develop`.
