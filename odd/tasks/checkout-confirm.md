# Checkout confirm into Inventory (issue #43, S5)

## Objective

One tap confirms the Cart as purchased with per-line bought quantities, and everything enters Inventory as lots. A retried confirm never doubles stock. Purchased planned items stay visible until their meal is cooked or leaves the range.

## Problem and why

`POST /api/checkout/confirm` and the delivered route exist under an older contract: `items[]` with `reservation_token` and `total_cents`, flat 422 errors, re-confirm is an error, lots are always `planned`, online stock enters at confirm. The spec (#5) and issue #43 define a different contract, and mobile has no confirm UI.

## Scope

- API: `MealPlannerApi.Cart` purchase and delivery, `ShoppingController` confirm and delivered actions, `ApiError` codes, shopping list read, tests and fixtures, `frontend_integration_guide.md`.
- Mobile: shopping feature (API client, types, store, hooks, confirm UI), error-code allowlist, Inventory refresh after confirm.

Out of scope: reversing a purchase, `actionId`, `inventoryVersion`, any mobile UI for online checkouts (online purchases are a future feature; decided by the user on 2026-10-10).

## Decisions

1. **Online stock enters on delivered (user decision, 2026-10-10).** Online confirm sets the session and its items to `pending_delivery` and creates no lots. `POST /api/checkout/sessions/:id/delivered` creates the lots and completes the session. A repeated delivered call replays the stored result. This replaces the previous "stock at confirm" behaviour and its test.
2. **Request contract follows the spec.** `{ sessionId, checkoutType, lines[{ itemId, quantityMilli, totalCents? }] }`. `lines` is optional; omitted lines use the suggested quantity. `reservation_token` and the old `items[]` are removed (the app is pre-launch, no compatibility layer).
3. **`itemId` is the list line id.** An ingredient line (`"<ingredientId>:<unit>"`) covers several Shopping items; its bought quantity covers allocations nearest first (date, then slot) and the uncovered remainder becomes a new `needed` Shortage. A manual item uses its own id.
4. **Manual items.** With an Ingredient they enter Inventory as `extra` lots. Without one they are marked purchased and dropped from the list.
5. **Idempotency.** Re-confirming a completed or pending-delivery session returns the original result with 200.
6. **Errors use the envelope.** `checkout_invalid_type` (422), `cart_expired` (409, confirm on a Cart whose lease expired), `checkout_session_not_found` (404, unknown session on confirm or delivered), `validation_error` for malformed lines. `stale_cart` and `cart_not_found` stay as they are on the cart routes.
7. **Quantity edges keep current behaviour.** Quantity 0 releases the line back to needed; a quantity above the suggestion stocks exactly what was bought.
8. **Purchased visibility.** The list read returns purchased planned items with status `purchased` until their Scheduled meal is cooked or leaves the range.

## Tasks

- [x] **T1 — API: physical confirm contract.** `lines[]` request, `extra` lots for manual items with an Ingredient, nearest-allocation partial coverage with a `needed` remainder, idempotent replay, envelope errors with the three new codes (API table, typespec, `api_error_test`, mobile allowlist so the contract scan stays green). Route: delegated writer (several non-trivial files). Commit `1684633`.
- [x] **T2 — API: online completes on delivered.** Confirm leaves `pending_delivery`; delivered creates lots, completes and replays. Route: delegated writer. Commit `96d8a9d`.
- [x] **T3 — API: purchased planned items stay visible.** List read includes them as `purchased` until cooked or out of range; guide updated for the whole contract. Route: delegated writer. Commit `2e46b2d`.
- [x] **T4 — Mobile: confirm screen.** API client and types, quantity adjustment per line, confirm action, list and Inventory refreshed afterwards, `purchased` line status rendered. Route: delegated writer. Commit `a9b871a`.

## Acceptance criteria

The four criteria of issue #43.

## Checks

- API (`apps/api`): `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict`, `mix sobelow --config`, `mix dialyzer`, `mix test`.
- Mobile (`apps/mobile`): `npm run lint`, `npx tsc --noEmit`, `npx jest --ci`.

## Delivery

Forecast is above 400 authored lines. Strategy: `ask-on-risk`; chain strategy to be asked before opening pull requests. One whole-branch native review at the end.

## Progress

**All four tasks are implemented and their checks were observed.** Remaining, both decided by the user: the whole-branch review and the pull request.

**T1 done** (route: delegated writer; several non-trivial files).

- `Cart.purchase/3` takes `lines[{ item_id, quantity_milli, total_cents? }]` keyed by the list line id; omitted lines are bought at the reserved quantity. `reservation_token` and `items[]` are gone from confirm (`Cart.remove/3` still uses tokens).
- Coverage rule: allocations nearest first (date, slot, item id); the first one not fully covered is purchased for its covered part and a `pending` remainder is stored for the same meal; allocations that get nothing are released. A surplus goes to the last allocation's lot. Quantity 0 releases the line.
- Lots: one per purchased Shopping item, `planned` or `extra` (manual with an Ingredient), each with a `purchase` event. A line's `total_cents` is split across its lots in proportion to quantity, the last lot taking the rounding remainder; without `total_cents` the lots carry no price.
- Replay: a completed session returns the stored result (atom keys rebuilt from `purchase_result`) and announces nothing on the channel.
- Errors returned by `Cart.purchase/3` and mapped 1:1 by the controller: `validation_error`, `checkout_invalid_type`, `checkout_session_not_found`, `cart_expired`, `cart_locked`.
- Decisions taken beyond the list above: a live Cart of another member of the same Account answers `cart_locked`, any other session not reserved by the caller answers `checkout_session_not_found`; a cancelled Cart also answers `cart_expired` (both are `abandoned`, with nothing stored to tell them apart); a confirm without `sessionId`, or of an empty Cart, is `validation_error`; `POST /api/checkout/confirm` without a session no longer reaches the legacy `reservation_required` branch.
- Observed: RED 0/13 on `checkout_confirm_test.exs` before the change, then `mix test` 1709 passed, 20 skipped; compile, format, credo and sobelow clean; mobile `tsc` and the error-code contract test pass. `mix dialyzer` reports 9 `call_without_opaque` warnings in files this task does not touch, identical with the three changed `lib` files reverted to the base.

**T2 done** (route: delegated writer, together with T3).

- Online confirm validates and resolves quantities exactly as physical, but stocks nothing: the session and its purchased Shopping items become `pending_delivery`; partial remainders and released lines behave as in physical. The result has `status: "pending_delivery"`, `moved_to_inventory_count: 0` and `checked_out_items_count: 0`, and a repeated confirm replays it.
- No migration. What delivery needs is stored at confirm in existing columns: the session keeps the lots to create (`purchase_result.pending_lots`: Shopping item, Ingredient, unit, `planned`/`extra`, bought quantity, price share) next to the result, and the items keep the bought quantity. The lots are read from the session and not from the items because `shopping_items.scheduled_meal_id` is `ON DELETE CASCADE`: re-planning a meal while its purchase is on the way deletes the items, and the stock must still arrive.
- `Cart.delivery/2` runs under the same account advisory lock as `purchase/3`: for a `pending_delivery` session it creates the lots (acquired at the delivery, `purchase` events attributed to the member who acknowledges), moves the items to `checked_out`, completes the session and stores the final result. A completed session, delivered before or bought in person, replays its stored result unchanged; anything else is `checkout_session_not_found`. Any member of the Account may acknowledge.
- The delivered route answers errors through `ApiError`; the flat 422 body is gone from it.
- Lease expiry only ever selected `draft` sessions, so nothing changed there; a test now pins that a pending-delivery session survives `expire_account/2`, `expire_due/0`, a Cart command and a list read.
- Decisions taken beyond the list above: delivery announces `purchase_confirmed` (with the completed result) and `inventory_changed` on the shopping channel, the events a physical confirm announces, and an online confirm announces only `purchase_confirmed`; a completed physical session replays its real result on the delivered route (it used to answer the stored body with `moved_to_inventory_count` forced to 0).
- Observed: RED 9/10 on `checkout_delivered_test.exs` before the change (the replay test passed against the old stock-at-confirm path), then `mix test` 1719 passed, 21 skipped; compile, format, credo and sobelow clean; dialyzer shows only the 9 known `call_without_opaque` warnings; mobile `tsc` and the error-code contract test pass. `cart_concurrency_test.exs` gained a concurrent-delivery test that plain `mix test` only compiles.

**T3 done** (route: delegated writer, together with T2).

- The list read adds the planned items that were bought (`checked_out`, and `pending_delivery` ones) whose Scheduled meal is not cooked and is planned inside the range of the read (the Account's today to `untilDate`). They read `purchased`. Purchased manual items are never returned: they are for no meal.
- Wire shape: every allocation of a `planned` line now carries `status` (`needed`, `in_cart`, `removed` or `purchased`), the status of its own Shopping item. No other key was added.
- Line rule (`ShoppingRebuilder.group_lines/2`, `:ingredient`): the quantity and status of a line come from its open allocations, the ones neither removed nor purchased, so a line bought in part stays `needed` (or `in_cart`) for its remainder. With no open allocation the line reads `purchased` when any allocation was bought, with the bought quantity, and `removed` only when all were removed. With `groupBy=meal` each item is its own line with its own status.
- `totals` are unchanged and count only `needed`, `in_cart` and `removed` lines; `estimatedCents` only pending items. Purchased lines are in none of them.
- A purchased item is not re-derived (`planned_item_keys` already answered for every status) and cannot be reserved (`mark-cart` by item id is refused with the legacy `already_reserved`, by Ingredient it only takes open items) or removed (`shopping_item_not_found`). These were already true; tests now pin them.
- `frontend_integration_guide.md`: 7.1 documents `purchased` and the allocation `status`; 7.4 and 7.5 were rewritten for the whole contract (request, response, replay, error codes, online pending delivery, delivered); section 10 lists both routes under the envelope.
- Decisions taken beyond the list above: the allocation `status` is attached where the service serializes the line, from the rows it handed to the rebuilder, so the allocation map `group_lines/2` returns is unchanged; a line with purchased and removed allocations and nothing left to buy reads `purchased`.
- Known gaps, not addressed here: `docs/GLOSSARY.md` still lists the Shopping item statuses as `needed`, `in_cart` or `removed`; a purchased item of a meal whose recipe is later swapped stays listed as `purchased` for that meal until it is cooked; the new line rule has no unit test in `shopping_rebuilder_test.exs` (covered through the list read in `shopping_purchased_test.exs`).
- Observed: RED 8/9 on `shopping_purchased_test.exs` before the change (the manual-items test already passed), then `mix test` 1728 passed, 21 skipped; compile, format, credo and sobelow clean; dialyzer shows only the 9 known `call_without_opaque` warnings; mobile `tsc` and the error-code contract test pass.

**T4 done** (route: delegated writer; several non-trivial files).

- Client: `confirmCheckout({ sessionId, checkoutType, lines })` validates the answer in the style of the other calls of the feature and lets the transport ask again on a network failure, since the server replays a confirmed session. `lines` is left out of the body when empty. The line status type has `purchased`, and every allocation has its `status`.
- Reaching it: on the Carrito tab, while the User holds a Cart, a floating cart button sits above the tab bar at the bottom right with the number of lines in the Cart. It opens the "Tu carrito" sheet: one row per line with "Sugerido: <quantity>" and a field with the bought quantity in the unit of the line, then "Marcar como comprado" and "Cancelar".
- Cart lines are built on the device from the read: the `in_cart` allocations added up per `<ingredientId>:<unit>`, whatever the grouping, plus the manual items that are `in_cart` by their own id. Only the lines whose quantity was changed are sent; `0` and a quantity above the suggestion are both taken. A field that does not read as a quantity disables the confirm.
- The confirm lives in `useCartLease`, next to marking and cancelling: one request at a time (a ref guards the second press, and the button and the fields are disabled while it is pending). Bought: the Cart is dropped, the list is read again, the Inventory store is refreshed and the sheet closes. `cart_expired`, `checkout_session_not_found`, `stale_cart` and `cart_not_found`: the Cart is dropped, the list is read again, the sheet closes and the message shows where the screen shows Cart errors. Anything else (`cart_locked`, `validation_error`, a network failure): the message shows inside the sheet, which stays open with the quantities typed, and the Cart is kept.
- Purchased on the list: a `purchased` line is dimmed and tagged "Comprado", reads ", comprado" to a screen reader, and has nothing to tick or hold. A line bought in part shows the remainder the server reports; ticking it marks only its `needed` allocations, removing it leaves out the purchased ones, and its "Para N comidas" counts only the meals still to buy for.
- `docs/GLOSSARY.md`: the Shopping item statuses include `purchased` (no longer listed as an alias) and the Checkout session entry says an online session waits for its delivery.
- Decisions taken beyond the list above:
  - The re-read goes through `useCartLease`'s `refreshList` (the store's `refresh`), as marking and cancelling a Cart do, and not through the store's `change` helper: `change` answers only a boolean and leaves the error in `changeError`, which the screen draws as a banner under the sheet, so the sheet could not tell an error that closes it from one that keeps it open.
  - The sheet no longer takes a row out of the Cart or shows a price: the mobile client has no route for either, and a quantity of `0` releases a line at confirm. The price helpers only the old sheet used (`formatPrice`, `formatItemMetaLine`, `BestOffer`, `NO_PRICE_LABEL`) were removed with it.
  - The sheet rises with the keyboard, as the add sheet does; the list keeps clear of the cart button while there is a Cart; a successful purchase gives the success haptic; the sheet closes if the Cart runs out while it is open.
- Known gaps, not addressed here: a read does not say who holds an `in_cart` allocation, so a share in another member's Cart is listed in the sheet too (it is only sent when its quantity is changed, and the server then answers `validation_error`); with a date limit on the list, Cart lines beyond that date are not shown in the sheet and are bought at the Cart's quantity; manual items cannot be ticked into a Cart from the screen yet, so their path through the sheet is covered only by unit tests; a list with only purchased lines shows them without the "No hay nada para comprar" message; the sheet was not checked on a simulator.
- Observed: baseline `npx jest --ci` 142 suites, 2083 tests, all passing (the `authService.test.ts` failures reported earlier did not reproduce). RED: 31 failing tests in the API client, Cart domain and formatter suites before their code, then 62 failing tests in the lease hook, list hook, row, sheet and screen suites before theirs (one new screen test, the remainder of a line bought in part, passed at once: the server computes it). Then `npx jest --ci` 143 suites, 2158 tests passing; `npx tsc --noEmit` clean; `npm run lint` 0 errors and the 4 warnings it had before, in files this task does not touch; `npm run knip` reports three findings fewer (the cart button and sheet are mounted now) and none new.

**Verification follow-ups** (route: delegated writer; found by two independent verifiers after T4).

- Fixed, API: a `quantityMilli` or a `totalCents` above what an `int4` column holds (2 147 483 647) is `validation_error`; it used to end as a 500 outside the envelope (`DBConnection.EncodeError`). The totals of the lines added up are bounded the same way, since the session stores their sum. Nothing else a confirm writes can exceed it: the quantities a line is split into never add up to more than the quantity sent, a remainder is never more than the reserved quantity, the price shares never add up to more than the line's total, and every lot is a new row and not an addition to an existing one.
- Fixed, mobile: the cart sheet writes "Sugerido" in the unit and the number format of the field next to it ("Sugerido: 1500 g" beside `1500 g`), never in kilos or litres. `formatQuantity` and the other screens are unchanged.
- Fixed, API and mobile (the product owner chose the count on the read; route: delegated writer): **a Cart whose lines the date limit hides.** The `cart` of the list read now carries `itemsCount`, the Shopping items the caller's Cart holds whatever `untilDate` leaves out (`Cart.items_count/1`, commit `f9a6b81`); marking and renewing answer the lease as before, since they do not share that serializer. The device requires it as a whole number of `0` or more and counts the hidden items as `itemsCount` less the `in_cart` allocations and manual items of the read, never below zero because the read also lists the shares in another member's Cart. With hidden items the sheet says "N ítem(s) fuera de las fechas elegidas también se va(n) a comprar con la cantidad sugerida.", the confirm is enabled with no listed line and sends no `lines`, "Todavía no marcaste nada." is left for a Cart with nothing in it, and the cart button counts the listed lines plus the hidden items. Observed: RED on `shopping_controller_test.exs`, 3 tests failing with `itemsCount` missing; RED on six mobile suites, 22 tests failing.
- Known gaps left open on purpose:
  - A partial purchase of a manual item leaves a new manual item with the remainder; the spec does not say what should happen.
  - An online purchase whose meal is planned again before delivery can be derived as a new Shortage and bought twice.
  - Another member's in-cart share appears in the sheet, and editing it fails the confirm with `validation_error`.
  - More than three decimals in a bought quantity are rounded silently.
  - A quantity that does not read as one disables the button without a message.
  - `cart_concurrency_test.exs` is skipped by plain `mix test`.
- Observed: RED on `checkout_confirm_test.exs`, 2 of the 3 new tests failing with `DBConnection.EncodeError` (the boundary test, the largest storable values, passed at once); RED on the mobile formatter and sheet suites, 7 tests failing.
