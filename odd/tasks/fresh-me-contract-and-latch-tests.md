# Fresh /me contract and AuthContext test tidy (issue #216)

Follow-up from #169 (PR #196, native review advisory findings). Branch:
`test/216-fresh-me-contract`.

## Objective

The rule of #169 (a successful `GET /api/me` is the only source of the profile
fields after Onboarding) must not rest on an unstated service contract, and the
AuthContext tests of that rule must say what they prove.

## Problem

- `completeOnboarding` reads a non-null `refreshCurrentSession()` as "a
  `GET /api/me` succeeded". Only context tests with a mocked service prove it.
- That a successful refresh overwrites the stored completion answer with what
  `/me` returned is not tested at service level.
- The snapshot write of the completion answer has no user-id check in the
  context; the store has its own, and the context does not say so.
- The fallback test table names its field `stubRefresh`, though the third case
  never reaches the refresh; the null-refresh case relies on null fields to
  discriminate; the rejected snapshot write test asserts only the result; the
  `console.warn` spy leaks if an assertion fails first.
- The #169 task document still says T1 writes nothing from the completion
  answer on the success path.

## Scope and constraints

- Triage decision (2026-10-13, owner): the freshness contract takes the test
  route, with no new freshness signal; the user-id guard takes the comment
  route.
- No production behavior changes. Mobile only.
- Allowed files: `apps/mobile/src/features/auth/services/__tests__/authSessionService.test.ts`,
  `apps/mobile/src/features/auth/context/AuthContext.tsx` (comment only),
  `apps/mobile/src/features/auth/context/__tests__/AuthContext.optimisticLatch.test.tsx`,
  `odd/tasks/onboarding-completion-profile-rule.md`, this document.

## Tasks

- [x] **T1 Service freshness contract** (route: delegated writer, sonnet; two
  non-trivial test files with T3)
  - A non-null `refreshCurrentSession` comes from a successful `GET /api/me`:
    it rejects, and never resolves the stored snapshot, when `/me` fails.
  - A successful refresh overwrites the stored completion answer with what
    `/me` returned.
- [x] **T2 User-id guard comment** (route: inline; one comment)
- [x] **T3 Latch test tidy** (route: same delegated writer as T1)
  - Rename `stubRefresh`; assert no refresh in the no-stored-session case.
  - Distinct non-null stored values in the null-refresh case.
  - Assert the rejected `persistProfileForStoredSession` call, with a failed
    and a successful refresh.
  - Restore the `console.warn` spy in `afterEach`.
- [x] **T4 #169 task document** (route: inline) — mark the T1 bullet
  superseded by T3.

## Acceptance criteria

- The rule of #169 does not depend on an unstated service contract.
- App suite green.

## Checks

- `apps/mobile`: `npx jest --ci`, `npx tsc --noEmit`, `npm run lint`.

## Progress

- Before any change, flipping `isFreshMe` to `true` in `completeOnboarding`
  failed only the null-refresh case, and only because its stored fixture has
  null profile fields.
- T1 (commit `af072c9`): `refreshCurrentSession` freshness block in
  `authSessionService.test.ts`. No RED possible (it pins existing behavior).
  Mutation: making `refreshCurrentSession` return the stored session when
  `getMe` fails failed both `/me` failure cases; restored.
- T2 and T3 (commit `ff53742`): comment in `completeOnboarding`; latch test
  tidy. The null-refresh case now stores 'Stored name', 2, 'intermediate'.
  Mutation `isFreshMe: true` failed only that case; restored. The writer also
  reset `persistProfileForStoredSession` in `beforeEach`: `clearAllMocks`
  keeps implementations, so the rejected write leaked into later tests.
- T4 (this commit): T1 of `onboarding-completion-profile-rule.md` marked
  superseded by T3.
- Checks observed: `npx jest --ci` 153 suites and 2396 tests passed;
  `npx tsc --noEmit` clean; `npm run lint` 0 errors, 4 warnings, all in files
  this branch does not touch; prettier clean.
- Native review: assessed `high` (auth hot path), review due.

## Next step

Native review of the branch from `45d74ab`, then the pull request.
