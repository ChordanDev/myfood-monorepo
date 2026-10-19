# Feature: Maestro flows for Planning and Shopping, and a runner for every flow (issue #377)

Ticket: ChordanDev/myfood-monorepo#377, part of #365, blocked by #376. Base: `feat/376-e2e-environment` at `6f7132cd`. Branch: `feat/377-maestro-planning-shopping`.
Delivery: one PR stacked on the #376 PR. Test runner: `npx jest` in `apps/mobile`; Maestro on an iOS simulator.

## Specs

- **S1** "`testID`s with the `e2e-` prefix on the Planning and Shopping elements the flows touch." "No behavior or copy change."
- **S2** "`apps/mobile/e2e/maestro/planning-confirm.yaml`: sign in as the seeded User, start a Planning session, get a proposal, confirm it, and see the Scheduled meals."
- **S3** "`apps/mobile/e2e/maestro/shopping-check-off.yaml`: after a confirmed plan, the Shopping list shows its items and one item can be checked off."
- **S4** "Flows select elements by `testID`, never by visible copy."
- **S5** "The runner runs one flow by name or `all`. `login` and `restore` keep working as today." "`npm run e2e:maestro -- all` (or the documented equivalent) runs the four flows and exits non-zero when one fails."
- **S6** "`apps/mobile/e2e/README.md` uses the monorepo paths (`apps/api`, `apps/mobile`) and explains how to run every flow and how to add a new one."
- **S7** "`maestroSelectors.contract.test.ts` (or an equivalent Jest test) covers the new `testID`s, so renaming one breaks a unit test." "Jest passes."
- **S8** "Both new flows pass locally on an iOS simulator against the `e2e` API seeded by #376."

## Decisions

- **D1 Login and restore assert Home.** #376 seeds `E2E_LOGIN_EMAIL` with onboarding completed, so both flows now reach Home (`e2e-home-screen`) instead of the onboarding screen. Their commands and runner behaviour are unchanged.
- **D2 Existing Planner testIDs are renamed, not duplicated.** An element has one `testID`, so `planner-start`, `planner-proposal`, `planner-confirm` and `planner-committed` become `e2e-planner-*` and their Jest test follows.
- **D3 The checked state is a testID.** A Shopping row is `e2e-shopping-item`, or `e2e-shopping-item-in-cart` once checked off, so the flow does not depend on how iOS exposes `accessibilityState`.
- **D4 `shopping-check-off` relies on the plan `planning-confirm` confirmed.** `all` runs it after `planning-confirm`; the README says so.
- **D6 The login flow clears the Keychain.** On iOS `launchApp: clearState: true` keeps the Keychain, where SecureStore saves the session, so a second run skipped login and found no email field. `clearKeychain` runs first; the restoration flow still relaunches without clearing.
- **D5 Any flow of `e2e/maestro/` runs by name.** Names are `[a-z0-9-]` and must match a file; `all` runs the restore command and then `all_flows` in order.

## Tasks

- [x] **T1** S1-S7. Route: inline (no writer trigger).
- [x] **T2** S8 on the iOS simulator. Route: inline.

## Log

- **L1** (2026-10-19) User request: implement #376 then #377, one stacked PR each; "the acceptance criteria ask for the flows to pass on an iOS simulator against the seeded `e2e` API. If you cannot run a simulator in this session, say so in the pull request and report which checks you could and could not run, instead of claiming they pass."
- **L2** Contract test: 14 passed (7 existing cases kept, onboarding assertions moved to Home; 7 new). `npm run typecheck` and `eslint` on the changed files clean.
- **L3** CocoaPods 1.16 on Ruby 4 cannot install pods under the accented checkout path (`hermes-engine.podspec`: incompatible character encodings); the iOS build ran from an ASCII-path copy of `apps/mobile`.
- **L4** iOS simulator (iPhone 17 Pro, iOS 26.2, Maestro, Java 17 from Homebrew) against the seeded `e2e` API on port 4000 with `E2E_ACCESS_TOKEN_TTL_SECONDS=2` and the real optimizer: `npm run e2e:maestro` passed; `planning-confirm` first failed (Keychain kept the session; then Confirm off screen), fixed with `clearKeychain` (D6) and `scrollUntilVisible`; then `planning-confirm` and `shopping-check-off` passed, `npm run e2e:maestro -- all` after a reseed ran the four flows and exited 0, and `npm run e2e:maestro:restore` passed.
- **L5** Jest: 158 suites, 2584 tests passed; contract test 14 passed; typecheck clean. One earlier full run had 12 failures in `LeftoversScreen.test.tsx`, which passed alone and in the next full run; it imports nothing this change touches.
- **L6** RDD: assessed `high` (shell runner); review granted by the user, lenses risk and reliability, approved and acknowledged for `6798fd50`. Its three non-blocking advisories applied in a follow-up commit: `planning-confirm` asserts no Scheduled meal before planning, `shopping-check-off` asserts nothing in the Cart before the tap, and the copy guard also refuses `text:` and `assertNotVisible: <text>`. Contract test 14 passed; `npm run e2e:maestro -- all` after a reseed passed again on the simulator.
