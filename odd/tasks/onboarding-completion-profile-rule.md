# Onboarding completion: one rule for the profile fields (issue #169)

## Objective

After `POST /api/onboarding/complete`, the mobile app follows one documented
rule for `displayName`, `householdSize` and `cookingSkill`.

## Problem and why

Issue #22 (PR #168) removed the session-level fallback that backfilled the
profile fields from the stored snapshot. `AuthContext.completeOnboarding`
still wrote the completion answer into the stored session and into `me`, and
kept it even when the follow-up `GET /api/me` succeeded. The code and its test
stated two rules: "the server is the only source" (session service) and "the
completion response wins over the refresh" (context).

## Rule (decided at triage, 2026-10-11)

A successful `GET /api/me` is the only source of the profile fields. The
completion answer stands in only when no fresh `/me` arrived (the refresh
failed, there was no stored session to refresh, or the app closed before the
refresh finished), so the User is not sent back to Onboarding with empty
fields.

## Scope

- Mobile: `features/auth/context/AuthContext.tsx` and its tests.
- API: one HTTP test that completes Onboarding and then reads `GET /api/me`.

## Constraints

- The optimistic completion latch (`optimisticComplete`) keeps working: it is
  set only after the completion POST succeeds.
- No API behavior changes: the API already stores both fields at completion
  and serves them from the user row.
- Out of scope: the error catalog (issue #170).

## Tasks

- [x] **T1 Mobile rule** (route: delegated writer; context plus its tests)
  - `completeOnboarding` applies the completion answer to `me` only when the
    follow-up refresh did not deliver a fresh `/me`.
  - One comment states the rule; comments stating the old rule go.
  - Tests: success path (the `/me` fields win, nothing is written from the
    completion answer) and failed-refresh path (the completion answer is
    stored and shown, the gate stays complete).
  - Superseded by T3 (issue #216): on the success path the completion answer
    is now written to the stored snapshot before the refresh, and the refresh
    overwrites it with what `/me` returned. Only `me` takes nothing from the
    completion answer when a fresh `/me` arrives.
- [x] **T2 API pin** (same writer, same work unit)
  - `onboarding_controller_test.exs`: post the completion, read `GET /api/me`
    over HTTP, assert `householdSize` and `cookingSkill`.
  - No RED is possible: the behavior already exists; the test pins it.

- [x] **T3 Snapshot write before the refresh** (route: inline; one production
  file and its test; user decision 2026-10-11 after the native review)
  - The completion answer goes to the stored snapshot before the refresh
    starts, and the refresh overwrites it with what `/me` returned.

## Acceptance criteria

- One documented rule, covered by a success-path test and a failed-refresh
  test.
- The optimistic latch is set only after the POST succeeds.
- App suite and API suite green.

## Checks

- `apps/mobile`: `npx jest --ci`, `npx tsc --noEmit`, `npm run lint`.
- `apps/api`: `mix test`, `mix format --check-formatted`, `mix credo --strict`.

## Progress

T1 and T2 done in one work unit (2026-10-11).

- `completeOnboarding` tells a fresh `/me` from the stored-session fallback
  with an `isFreshMe` flag on the refresh result: `reconcileAfterCompletion`
  reports `refresh-success` for both.
- T1 first moved the snapshot write after the refresh attempt. T3 put it back
  before the refresh: the native review (resilience and reliability lenses)
  and the verifier flagged that an app closed mid-refresh and reopened offline
  showed empty profile fields. The write is provisional; a successful refresh
  stores what `/me` returned over it.
- RED observed for the success-path test (`me.user` showed the completion
  values where the `/me` values were expected). The fallback cases (refresh
  rejects, refresh resolves `null`, no stored session) passed before and after
  the change.
- Observed after rebasing onto `main` at `fa49e88`: `npx jest --ci` 145 suites
  and 2107 tests passed; `npx tsc --noEmit` clean; `mix test` 1735 passed, 21
  skipped. Observed before the rebase: `npm run lint` 0 errors (4 warnings in
  untouched files); `mix format --check-formatted` and `mix credo --strict`
  clean.
- `mix test` is intermittent on this machine: before the rebase two of four
  full runs failed in tests outside this change (one identified:
  `cooking_channel_test.exs:291`, a 100 ms `assert_receive`), the other two
  were green.
- An independent read-only verifier passed the commit with notes. Accepted:
  a context test that a rejected completion POST leaves the latch unset (the
  criterion held by code structure only).
- The native review of T1 and T2 was approved with advisory findings only. T3
  answers its one warning. RED observed for T3: the success-path test expected
  the snapshot write before the refresh and found no write. A test that a
  rejected snapshot write does not fail the completion passes before and
  after.
- Observed after T3: `npx jest --ci` 146 suites and 2219 tests passed; `npx
  tsc --noEmit` clean; `npm run lint` 0 errors (4 warnings in untouched
  files). No API file changed in T3.

Next step: review of the pull request.
