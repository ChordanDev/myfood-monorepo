# Feature: Subscribe from the app with RevenueCat (issue #412, part 2: mobile)

Ticket: ChordanDev/myfood-monorepo#412. Part 1 (API `app_user_id`) merged as PR #415.
Base: `main` at `1879a21c`. Branch: `feat/412-revenuecat-mobile`. One PR to `main`.
Test runner: `npx jest` in `apps/mobile` (react-test-renderer). Checks: `npm run lint`, `npx tsc --noEmit`.

## Specs

Quoted from the issue, scope 2 "Mobile: RevenueCat SDK, Paywall and Customer Center":

- **S1** "Install `react-native-purchases` and `react-native-purchases-ui` with npm. This needs an Expo development build, because the SDK does not run in Expo Go. Document how to build and run it."
- **S2** "Configure the SDK once at startup from `EXPO_PUBLIC_REVENUECAT_API_KEY` (or per-platform keys). **Never commit a key**: this repository is public. Add the variable to the env example with a placeholder."
- **S3** "After sign-in and on every Account switch, read `appUserId` from `/billing/revenuecat/status` and call `Purchases.logIn(appUserId)`. On sign-out, call `Purchases.logOut()`. Do not purchase before `logIn`, so no anonymous RevenueCat user is created."
- **S4** "Read `CustomerInfo` and listen to its updates for `brosky_company_pro`, but treat the server's `/me` and `/billing/revenuecat/status` as the source of truth for access."
- **S5** "TrialExpired screen: present the RevenueCat Paywall for the current Offering. On a purchase or restore, call `/billing/revenuecat/purchase` or `/restore`. While it answers `202 pending_webhook`, retry with backoff, then refresh `/me`."
- **S6** "Settings: a \"Manage subscription\" entry that opens the Customer Center when the Account has an active entitlement."
- **S7** "Handle user cancellation (not an error), network errors and store errors, with Spanish UI copy that follows the existing settings and auth screens."
- **S8** "Mock the SDK in `jest.setup.js` and test the login and logout calls, the purchase-then-pending-webhook flow, and the entitlement listener."

Out of scope (issue): the real bundle id / Android package, store products, the webhook, `AccountAccess`, the generation engine.

## Decisions

- **D1 The JSON key is `app_user_id`.** That is the API's wire contract (PR #415).
- **D2 Identity lives in a render-nothing `RevenueCatSession` under `AuthProvider`.** This is the `FavoritesSession` pattern. It follows `me.account.id`, so sign-in, session restore, Account switch, sign-out and an invalidated session all go through it without changing `AuthContextValue`.
- **D3 `logOut` only when the SDK holds an identified user.** `Purchases.logOut()` rejects for an anonymous user.
- **D4 The Paywall is opened only after `logIn` with the server's id.** If the session has not identified yet, the subscribe action identifies first.
- **D5 A missing key disables billing UI** (no Subscribe button, no Manage row), like Google sign-in without its client id.
- **D6 No `expo-dev-client` dependency.** The app already builds locally with `expo run:ios|android`, which Google Sign-In requires too.

## Tasks

- [x] T1 S1-S4, S8: SDK install, configure, logIn/logOut session, CustomerInfo listener, jest mocks. Route: inline. Commit `45a33be2`.
- [x] T2 S5, S7, S8: TrialExpired Paywall, purchase/restore confirmation with backoff, error copy. Route: inline. Commit `775b9724`.
- [x] T3 S6, S7: Settings "Gestionar suscripción" opening the Customer Center. Route: inline. Commit `a60df9c1`.
- [x] T5 S3, S7: verifier blocker B1 fixed: an Account switch no longer leaves the previous Account's id usable (RED then GREEN). Route: inline. Commit `f3185844`.
- [x] T6 S3, S5, S7: RDD advisories fixed: a paid purchase stays checkable on the right route, sign-out waits for an in-flight login, stale CustomerInfo is ignored, a failed refresh after the Customer Center is silent (6 tests, RED then GREEN). Route: inline. Commit `64254802`.
- [x] T7 S3, S5: Jorge round 1 at eddcf20a. TR-1, a stale sign-out logging out the next User, fixed in `63bbf431` (RED then GREEN). TR-2, an empty restore stuck on the payment copy, fixed in `2dd91848` (RED then GREEN). SP-1: exact versions pinned in `5f761e47`. RDD advisory: env-key test hygiene in `78b8dcfc`. Route: inline.
- [x] T8 S3, S5: Jorge round-2 notes on PR #420, fixed in PR #437 (each RED then GREEN). SP-A, overlapping logins, in `5825013b`. CD-1, an unreadable CustomerInfo after a restore, in `64404fd5`. CD-2 in `83e0e1eb`, later reverted in substance by T9. SP-B, an Account switch keeping the previous state, in `d7646298`. Route: inline.
- [x] T9 S3, S5: Jorge on PR #437 at d7646298. The confirmed finding (an Account with no trial on record whose purchase starts the one-time trial waited through every retry, because the server answers `trial` ahead of `active`) is fixed in `047f3ba6`: a `200` with `trial` confirms again, as S5 says. Optional notes fixed: `/me` refreshed after an unverified restore in `4c348b82`; the subscribe flow scoped to its Account in `dced15e9`; the wait for an earlier login bounded in `64a966b9`. Each RED then GREEN. Route: inline.
- [x] T4 S1, S2: README dev-build section, `.gitignore`, and `apps/mobile/.env.example` with placeholders only. The user created the file because the session's permissions deny writing `.env*`; the commit was verified by hash against the expected content. Route: inline.

## Log

- L1 (2026-10-21, user): "Implement issue #412 ... Two pull requests, the second stacked on the first ... 2. Mobile: `react-native-purchases` and `react-native-purchases-ui` (npm, Expo development build). Configure the SDK from an env variable, `Purchases.logIn(appUserId)` after sign-in and on Account switch, `logOut` on sign-out, the Paywall on the TrialExpired screen with `/billing/revenuecat/purchase` and `/restore` and the `202 pending_webhook` retry, the Customer Center from Settings, and entitlement `brosky_company_pro` read from CustomerInfo while the server stays the source of truth for access." Cautions: never commit a RevenueCat key; the `app_user_id` must be the server-issued one; never purchase before `logIn`.
- L2 (2026-10-21): PR #409 (#407) and PR #415 merged, so this PR targets `main` directly. SDK 10.15.0 API was checked against its type definitions: `Purchases.configure({apiKey, appUserID?})`, `logIn(id) -> {customerInfo, created}`, `logOut()`, `isAnonymous()`, `RevenueCatUI.presentPaywall() -> PAYWALL_RESULT`, `RevenueCatUI.presentCustomerCenter()`.
- L3 (2026-10-21): The code was written before its tests, so there is no RED-first evidence. Instead, removing `ensureIdentified()` before the Paywall and `Purchases.logOut()` on sign-out made 4 tests fail. Each commit typechecks and passes the full suite on its own: the final one runs 166 suites and 2696 tests. Lint shows 0 errors; its 4 warnings are pre-existing. The only key-like strings in the diff are the tests' `test_placeholder_key`.
- L4 (2026-10-21): The independent verifier passed S1 and S4-S8, met S2 only partly (`.env.example` missing) and blocked S3 (B1, a stale id after a direct Account switch); the B1 fix is `f3185844`. Merged `origin/main` (`f56e8c13`, no mobile changes). The native RDD review of PR #420 (risk, resilience, reliability) was approved and acknowledged; its advisories are fixed in `64254802`. PR: https://github.com/ChordanDev/myfood-monorepo/pull/420 (`jorge:required`). Full suite: 166 suites, 2703 tests.
- L5 (2026-10-21, user): "Si correji", meaning fix Jorge's TR-1 and TR-2 here, together with SP-1 and the RDD env-key test bug. Jorge round 1 at eddcf20a escalated manually: 0 confirmed findings, 2 suspects that depend on native SDK behavior. Full suite after the fixes: 166 suites, 2705 tests. A Test Store sandbox check of TR-2's premise (does the Paywall return RESTORED when nothing was restored?) is still owed by the owner.
- L6 (2026-10-21, user): "Te habilito la escritura, como lo hago?" The user ran the given command to create `apps/mobile/.env.example`, keeping the global `Edit(.env.*)` deny rule.
- L7 (2026-10-21): PR #420 merged mid-work, so the four T8 commits were rebased onto `main` and opened as PR #437 (`jorge:required`). A force-push was denied, so the stale remote branch `fix/412-billing-edge-cases` holds the pre-rebase commits.
- L8 (2026-10-21, user): "Si, arreglalos", meaning fix Jorge's findings on PR #437 here. Server evidence for the confirmed finding: `account_access.ex` checks the trial before the entitlement, and `revenuecat_service.ex` opens the 7-day window on the first qualifying webhook when `trial_started_at` is nil. When an earlier login does not settle within `LOGIN_WAIT_TIMEOUT_MS` (10 s), the new login fails with the identity error instead of starting, because the earlier one could still land.
