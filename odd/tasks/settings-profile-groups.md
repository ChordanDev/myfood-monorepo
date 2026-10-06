# settings-profile-groups

Issue: ChordanDev/progra-3-front#47 — "Ajustes: rediseñar la pantalla de perfil
como lista de grupos".

## Objective

Replace the long `ProfilePreferencesScreen` form on the Perfil tab with the
grouped-row settings screen of `docs/design/screens/Ajustes.dc.html`: an account
card, four row groups, one editor per row, and sign-out in the `alert` token.

## Problem and why

The Perfil tab is one long form with a single save button. Name, household size
and cooking experience can only be set during onboarding, and the hunger chips
render raw codes (`light/normal/strong`) instead of the Spanish labels.

## Scope

- `src/features/settings/` (new feature: screen, components, hook, utils, constants, tests)
- `src/features/preferences/` (shared option maps, `preferencesApi`, validation; old form removed)
- `src/features/auth/` (types, context, api, service mock, fixtures) for the profile contract
- `src/types/domain.ts`, `src/context/RecipeThemeContext.tsx`, `src/mocks/domainMocks.ts`,
  `docs/THEMING.md` for the `alert` token
- `app/(tabs)/profile.tsx` if the screen export is renamed
- Test fixtures that build a `RecipeThemeConfig` or a `CurrentMe`

## Constraints

- Colors only from the active palette (`docs/THEMING.md`); no color literals,
  tints via `withOpacity`. Do not copy the literals in the onboarding components.
- `alert` is replicated with the exact lines and values the #46 branch
  (`feat/home-confirm-past-meal`) uses, so both branches merge cleanly
  (user decision, 2026-10-06). No other token is added, renamed or removed.
- No new dependency: editors are React Native `Modal` sheets like `EatTodaySheet`.
- UI copy in Spanish, matching the existing screens; code, comments and tests in English.
- Conventional commits, no AI attribution.
- Branch `feat/settings-profile-groups` from `origin/Develop` (db05b87), worktree
  `my-expo-app-worktrees/settings-profile-groups`.
- RDD is off for this clone (`clone_local`); no native review is started.

## Backend contract gap (user decision, 2026-10-06)

`my_food_back` has no endpoint to read or edit household size and cooking skill
after onboarding, and none to edit the display name
(`lib/my_food_back_web/router.ex`: writers are `POST /onboarding/complete`,
`PUT /me/preferences`, `PUT /me/slot-cooking-times`). The frontend is built
against this proposed contract and a backend issue tracks it:

- `GET /api/me` → `user.householdSize: number | null`, `user.cookingSkill: CookingSkill | null`
- `PUT /api/me/profile` with `{ displayName, householdSize, cookingSkill }` →
  `{ user: { id, email, displayName, householdSize, cookingSkill } }`,
  same validation as onboarding (name 1–60, household 1–20, skill in the list).

Until the backend ships it, the "Tu hogar" rows show a placeholder for missing
values and saving them fails with the normal error state.

## Design decisions

- The mockup draws no editor. Each row opens a bottom sheet (`Modal`, panel on
  `colorDark`) with that field's editor and its own save button; there is no
  screen-wide "Guardar cambios".
- Screen title is "AJUSTES" as in the mockup; the tab label stays "Perfil".
- Trial pill is shown only while the account is in trial
  (`subscriptionStatus === 'none'` and `trialEndsAt` in the future).

## Structure (user decision, 2026-10-06)

Feature-first: the settings screen is its own feature, `src/features/settings/`
(`screens`, `components`, `hooks`, `utils`, `constants`, `__tests__`, barrel
`index.ts`), not a `settings`-prefixed set of files spread over the technical
folders of `preferences`.

- Moves to `settings`: screen, components, state hook, formatters, draft
  helpers, settings-only labels and their tests.
- Stays in `preferences`: onboarding, shared catalogs and option maps,
  `preferencesApi` (with `updateProfile`), shared validation.
- Stays in `auth`: `me`, `AuthContext.updateProfile`, normalisation, token store.
- Dependency direction: `settings` → `auth`, `preferences`; never the reverse.

## Tasks

- [x] T1 `alert` token replicated from the #46 branch (type, `DEFAULT_THEME`,
      provider fallback, mocks, `THEMING.md` rows). Route: delegated (same writer
      as T2). Check: `npx tsc --noEmit`, `npm test`.
- [x] T2 Profile data layer and pure formatters. `AuthUser` gains nullable
      `householdSize` / `cookingSkill`; `updateProfile` (`PUT /api/me/profile`)
      through the auth context, refreshing `me`; label maps for account type;
      pure helpers for initials, trial days left, plan summary, household,
      slot summary and list summaries. Route: delegated (2+ non-trivial files).
      Test-first: unit tests for every helper and for the API call.
- [x] T3 Grouped settings screen with account card, four groups, per-row editor
      sheets and sign-out in `alert`; labels from `onboardingOptions.ts`; old
      form removed; integration tests rewritten. Route: delegated (2+ non-trivial
      files). Test-first where a deterministic render test applies.
      Done: `498098a`, `53303d0`, `702ac84`, `7f91cad`, `6739447`.
- [x] T4 Backend issue opened in `my_food_back` for the contract above and
      linked from #47. Route: inline (`gh`). Done: ChordanDev/progra-3-back#28
      (its body references #47, which backlinks it on the #47 timeline).

## Acceptance criteria (from #47)

- [ ] Name, household size and experience are editable. Frontend done and
      covered by integration tests with a mocked `updateProfile`; end to end it
      is pending ChordanDev/progra-3-back#28.
- [x] Hunger and experience labels come from `onboardingOptions.ts`, never raw
      codes (integration test asserts no raw code in the rendered tree).
- [x] Trial state comes from `me.account` (`trialEndsAt`, `subscriptionStatus`).
- [x] Integration tests updated (`src/features/settings/__tests__/`, 124 tests).

## Checks

`npm test`, `npm run lint`, `npx tsc --noEmit`.

## Delivery

Strategy `ask-on-risk`. Forecast was ≈ 900–1100 authored changed lines; the
actual range `origin/Develop..6739447` is 4246 insertions and 878 deletions
over 53 files (roughly half of the additions are tests), far over the 400-line
budget. Commits are reviewable work units so they can be sliced into a PR
chain; the chain strategy is asked before any PR is opened. Suggested slices:

1. `4fa2df5` — `alert` token.
2. `517e9aa`, `680cf9a`, `498098a` + the auth correction — data contract and formatters.
3. `53303d0`, `702ac84`, `7f91cad`, `6739447` — the settings feature. `53303d0`
   leaves the rows read-only until `6739447`, so a slice must not end between them.

## Progress

- 2026-10-06: document created; worktree, dependencies and CodeGraph index ready.
- T1 done: `4fa2df5`. Code lines identical to the #46 branch. `docs/THEMING.md`
  will conflict with #46 in two places (the `alert` role-table row and the
  "Completeness" bullet); both are one-line doc resolutions.
- T2 done: `517e9aa` (formatters) and `680cf9a` (contract). `updateProfile`
  patches `me` from the PUT response instead of calling `refreshMe` (a refresh
  rotates tokens and could fail after a successful save). `me` is normalised at
  `getMe`, the verify-code session and `getStoredSession`.
- Evidence after T2: `npm test` 453/455 (2 baseline failures in
  `authErrorCodeContract.test.ts`, which needs the backend repo as a sibling of
  the checkout); `npx tsc --noEmit` 22 baseline errors (missing Node types in
  test files), none new; `npm run lint` 0 errors, 7 baseline warnings. Parent
  spot check: formatter + auth suites 93/93.
- Native assessment of `origin/Develop..680cf9a`: `high` (`hot_path`: auth),
  1168 changed lines. RDD is off, so no native review; an independent
  read-only verifier checks the auth commit.
- T3 decisions: each "Tu hogar" row opens its own editor; while the backend
  does not return the other profile fields, the sheet also asks for the missing
  ones so the full `PUT` payload is valid. "Plan" is read-only (no editor
  exists). Trial date follows the mockup casing (`12 Oct`). Unknown restriction
  codes are counted (`+N`) rather than dropped.
- Independent verification of `680cf9a`: no unconditional blocking finding.
  Follow-ups: a saved profile reverts to "Sin definir" on the next refresh if
  the backend ships the `PUT` before the `GET /api/me` fields (added to
  progra-3-back#28 as an acceptance criterion); a refresh racing the `PUT` can
  restore a pre-save snapshot until the next refresh; the stored-session write
  is a non-atomic read-modify-write; no specific error code for profile
  validation. Corrected in scope: unvalidated `PUT` response and the untested
  sign-out guard (see the auth correction commit below).
- T3 done, restructured feature-first into `src/features/settings/` after the
  user's instruction. Evidence: `npm test` 509/511 (same 2 baseline failures),
  `npx tsc --noEmit` 22 baseline errors, `npm run lint` 0 errors and 7 baseline
  warnings; the only color literal in the feature is the black modal backdrop;
  no other feature imports `features/settings`. Parent spot check: settings
  suites 124/124. RED was observed for the formatter corrections, the read-only
  screen, the draft model and the first editor test; the remaining 21 editor
  tests were written after the implementation and checked by mutation.
- T3 choices made by the writer: unknown restriction codes are preserved on
  save; a non-preset saved cooking time gets its own chip; with no display name
  the email is the primary line; sheet errors use `primaryAccent` (contrast on
  `colorDark` is guaranteed for it, not for `alert`); the stepper starts at 1
  when the household size is unknown.
- Auth correction done: `1398001`. `updateProfile` rejects a `PUT` answer
  without a usable `user.id` with the existing `unknown_error` (no new error
  code) and normalises absent profile fields to `null` through the same helper
  as `normalizeCurrentMe`; two tests now pin the sign-out / different-user
  guard (confirmed by removing the guard). Final evidence on the branch tip:
  `npm test` 519/521 (same 2 baseline failures, parent run), `npx tsc --noEmit`
  22 baseline errors, `npm run lint` 0 errors.
- Not verified: the screen has not been run on a device or simulator. The
  keyboard behavior of the sheets (Android first) and the visual match with the
  mockup are unchecked.

## Next step

Visual check on a device, then choose the PR chain strategy and open the PRs.
