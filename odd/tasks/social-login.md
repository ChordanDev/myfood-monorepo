# Feature: social login with Google and Apple on the mobile auth contract (#106)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/106 (labels `ready-for-agent`, `jorge:required`). Branch: `feat/106-social-login` from `main` at `db70459c`.
Delivery: `single-pr`. Test runners: `mix test` in `apps/api`, `npx jest` in `apps/mobile`.

## Specs

Quoted from the owner's decision comment of 2026-10-20 on #106.

- **S1 Providers.** "Google on iOS and Android, Apple on iOS only. Facebook is out of this issue; it can be added later as one more verifier."
- **S2 Existing or new email.** "the provider proof replaces the email code; everything else follows the code contract. A verified provider email whose User has an active Membership signs in. An email with no User signs up: Account, owner Membership and Trial, as `POST /api/auth/signup/verify-code` does. Every other case answers what the code contract answers for that email."
- **S3 No usable email.** "only an email the provider marks as verified is accepted. Apple's private relay address counts as a real email. Without a verified email the sign-in is refused with `social_email_unverified`."
- **S4 Link and unlink.** "not in this issue. A provider identity links to the User by verified email on first sign-in; there is no unlink screen."
- **S5 Route and errors.** "`POST /api/auth/social` with `{provider, idToken, deviceId}`. It answers the `200` of `POST /api/auth/login/verify-code` (`accessToken`, `refreshToken`, `tokenType`, `me`) and opens a Device session, so `POST /api/auth/refresh` renews it. New error codes, added to the mobile allowlist (`authErrorCodeContract.test.ts`): `social_token_invalid`, `social_email_unverified`, `social_provider_unsupported`."
- **S6 API scope.** "recover `MealPlannerApi.Auth.SocialVerifier`, its fake and config keys from the parent of `4f007773`, drop Facebook, and return the provider subject and `email_verified`. Store the provider identity (`provider`, `subject`) per User in a new table, because Apple sends the email only on the first sign-in."
- **S7 Mobile scope.** "`expo-apple-authentication` (iOS only) and a Google Sign-In SDK; restore the landing buttons removed in #74 (`SocialLogin`, `SocialLoginIcons`, `SocialDivider`)."
- **S8 Docs.** "`FRONTEND_INTEGRATION.md`."
- **S9 Acceptance.** "A User signs in from the app with each supported provider and gets a session that `POST /api/auth/refresh` can renew." / "The response and the errors use the mobile contract (camelCase body, error envelope)." / "The landing screen offers the provider buttons again, wired to the provider SDKs." / "The rule for an email that already has a User is specified and tested."

Planning cautions (from the lane prompt): validate the token audience against the configured client IDs; reuse the Device session and Membership-selection rules unchanged; leave the email-code services, Guardian and `AuthController` refresh/logout untouched; minimal diffs in `config/test.exs`, `apps/mobile/package.json` and `app.json`.

Assumptions:
- A provider whose client IDs are not configured is refused with `social_provider_unsupported` (fail closed: the recovered verifier accepted any audience when the list was empty).
- An identity already stored for `(provider, subject)` signs its User in without looking at the token's email (S6: Apple sends the email only once).
- An invalid `deviceId` answers `social_token_invalid` before the token is verified, as the code flow answers `code_invalid`.
- A provider outage answers `unknown_error` (500): no fourth code was decided.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S2-S6, S9 | inline (API, error codes, mobile allowlist) | done: 37 new API tests green; suite 2311/2312, the one failure is `router_test.exs` (owned by #274 lane) | `feat(api)` commit |
| T2 | S1, S7, S9 | delegated writer (parallel unit, disjoint surface: `apps/mobile` except `src/api/errors.ts`) | pending | |
| T3 | S8 | inline | done | `feat(api)` commit |

## Log

- **L1 (2026-10-20, user request):** "Implement issue #106 of ChordanDev/myfood-monorepo: \"Social login (Google, Apple, Facebook) on the mobile auth contract\". [...] Open the pull request and report the link. Do not merge."
- **L2:** Recovered verifier read from `4f007773^`. Its `validate_audience(_, [])` accepted every audience, and Google tokens without an email passed; both are closed in T1. Membership selection lives in the private `EmailCodeLogin.resolve_session/1`; T1 exposes it `@doc false` instead of copying it, so the rule stays one.
- **L3:** T1 tests were written after the code, so RED was not observed first. Mutation checks instead: accepting an unverified email, ignoring a stored identity, accepting any audience and treating an empty client ID list as configured each make the new tests fail (1, 3, 2 and 1 failures).
- **L4:** `test/meal_planner_api_web/router_test.exs` pins `POST /api/auth/social` as a removed route (404). That file belongs to the #274 lane, so it is not edited here; the PR is blocked on it until the user decides.
