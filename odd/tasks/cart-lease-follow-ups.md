# Feature: Cart lease follow-ups from the review of #133 (issue #161)

Ticket: ChordanDev/myfood-monorepo#161, follow-ups of #41 (PR #133).
Base: `main` at `bacab02`. Branch: `fix/cart-lease-follow-ups`.

## Objective

Close the non-blocking findings of the native review of #133: the Cart client rejects malformed answers like its sibling parsers, the lease hook explains an expired Cart and does not bring back a Cart this device ended, and the names say what the values are.

## Problem

The findings were written before checkout confirm (#43) landed. Each one was checked against `main` at `bacab02`: all of them are still present, none was resolved by #43. #43 did add a precedent for R4-003: a confirm that finds the lease gone sets the error before dropping the Cart.

## Scope and constraints

- In scope: `apps/mobile/src/features/shopping` (`api/shoppingApi.ts`, `hooks/useCartLease.ts`, `hooks/useShoppingList.ts`, `screens/ShoppingScreen.tsx`, `types/shoppingApi.ts`, their tests), `cart_response` in `apps/api/lib/meal_planner_api_web/controllers/shopping_controller.ex`, and `apps/api/test/meal_planner_api_web/controllers/cart_lifecycle_test.exs`.
- Out of scope: #111, #112, #116, #159, #190, the auth code of PRs #193, #197, #201, cooking, planner and recipes.
- No new user-facing copy and no new design token.
- Review level (triage comment): RDD is enough; an item that touches transactions, locks, retries or auth is re-evaluated. No task below touches them.

## Decisions

- **D1 R4-002 is not changed here.** What the User should see when renewals keep failing (a notice, or dropping the Cart once the lease time has passed on the device clock) is a product decision the issue does not answer, and a faster reattempt changes retry timing, which the triage comment asks to re-evaluate. The current behavior stays: one attempt a minute, and the Cart is dropped as soon as the server says the lease is gone.
- **D2 `cancelCart` parses what the server answers (R2-003, R3-003).** It requires `status: "abandoned"` and an integer `updatedRows`, and rejects anything else as malformed, like the sibling parsers. Dropping the fields would also satisfy R2-003 but not R3-003.
- **D3 A tick refused as `stale_cart` says so (R4-003).** Same as the confirm path since #43: the error is set, then the Cart is dropped. The message is the one already in the catalogue.
- **D4 The hook remembers the session this device ended (R4-004).** Set when a cancel or a physical confirm succeeds, cleared when a tick starts a Cart. A list read that still reports that session does not restore it. It is state, not a ref, because it is read while rendering. A lease the server reported gone is not remembered: the list read decides.
- **D5 `tickLine` keeps doing nothing for a line that is not `needed` (second half of R2-004).** A line in the Cart or bought has nothing to tick; un-ticking one line out of the Cart is a feature nobody specified. Manual items are not tickable on this screen (#159 is out of scope). The rename of R2-005 makes "planned lines only" explicit.

## Tasks

- [x] **T1 API: one guarded `cart_response` clause and a pinned expired-lease code (R2-001, R2-007, R3-002).** Route: direct inline (two mechanical edits, no research). The four error clauses become one with the allowlist in a module attribute; the comment names `subscription_required`. The test asserts `stale_cart` for renew and cancel after expiry.
- [x] **T2 Mobile client: strict Cart parsers (R1-001, R3-004, R2-002, R2-003, R3-003).** Route: delegated direct. `markInCart` validates each element of `items` and reads them from the parsed `data`; the three literals go through `malformed('cart')`; `cancelCart` follows D2.
- [x] **T3 Mobile hooks and screen (R4-003, R4-004, R2-004, R2-005, R2-006, R3-005).** Route: delegated direct. D3 and D4 in `useCartLease`; `readCart` becomes `lastSeenListCart` with a note on the pattern; `useShoppingList` exposes `refresh` and `plannedLines` with a stable empty list; the screen passes `refresh` as `refreshList`; the held-Cart test pins the renewal on opening and the throttle.

## Acceptance criteria

- Each finding of #161 is fixed, or kept with a note saying why (D1, D5).
- `mix test` in `apps/api`; `npm test`, `npm run typecheck` and `npm run lint` in `apps/mobile` pass.

## Checks

- `mix test test/meal_planner_api_web/controllers/cart_lifecycle_test.exs`, then `mix test`, `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo` in `apps/api`.
- `npx jest src/features/shopping`, then `npm test`, `npm run typecheck`, `npm run lint` in `apps/mobile`.

## Progress

All three tasks are done, one commit each:

- T1: `refactor(api): answer the cart envelope reasons from one clause`. No RED: the clause is a refactor under the existing lifecycle tests, and the pinned code tightens an assertion that already held.
- T2: `fix(mobile): reject malformed cart answers in the shopping client`. RED: seven malformed `items` rows and five `cancelCart` rows resolved instead of rejecting.
- T3: `fix(mobile): explain an expired cart and keep an ended one gone`. RED: the `stale_cart` tick had no message, a cancelled and a bought Cart came back from a late read, `refresh` did not exist, and the empty planned lines were a new list each render. The held-Cart test pins behavior that already held (1 renewal on opening, 1 at 59 999 ms, 2 at 60 000 ms).

Observed on the final tree: `mix test` 1819 passed, 22 skipped; `mix compile --warnings-as-errors`, `mix format --check-formatted` and `mix credo --strict` clean; `npm test` 149 suites, 2291 tests passed; `npm run typecheck` and `npm run lint` exit 0 (4 lint warnings, all in files outside this change). `mix dialyzer` was not run locally (see the local baseline note: OTP 29 here, OTP 27 in CI); CI is the run that counts.

## Left as found

- R4-002, by D1. Open question for the User: what should the screen do while renewals keep failing for a reason other than the lease being gone?
- The second half of R2-004, by D5.
- After a cancel followed by a tick, a list read asked before the cancel can still show the cancelled session until the tick's own read lands. Closing it means ordering reads by request, not by session.
- The full jest run prints "A worker process has failed to exit gracefully". It comes from suites outside `src/features/shopping` and is on `main` too.

## After the native review

The review of the branch was approved with two findings that did not block. Both were taken, in `fix(mobile): tighten the reserved item check and pin the cancel answer`:

- The cancel route's test asserts `updatedRows`, and a hook test covers a cancel whose answer cannot be read: the Cart stays, with the error, until a renewal finds it gone.
- `isCartReservation` also rejects an empty `reservationToken` and a negative `quantityMilli`, like `isShoppingCartLine`; a quantity of zero is accepted. RED: both rows resolved instead of rejecting.
