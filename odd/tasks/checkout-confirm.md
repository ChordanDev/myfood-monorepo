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
- [x] **T2 — API: online completes on delivered.** Confirm leaves `pending_delivery`; delivered creates lots, completes and replays. Route: delegated writer.
- [ ] **T3 — API: purchased planned items stay visible.** List read includes them as `purchased` until cooked or out of range; guide updated for the whole contract. Route: delegated writer.
- [ ] **T4 — Mobile: confirm screen.** API client and types, quantity adjustment per line, confirm action, list and Inventory refreshed afterwards, `purchased` line status rendered. Route: delegated writer.

## Acceptance criteria

The four criteria of issue #43.

## Checks

- API (`apps/api`): `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict`, `mix sobelow --config`, `mix dialyzer`, `mix test`.
- Mobile (`apps/mobile`): `npm run lint`, `npx tsc --noEmit`, `npx jest --ci`.

## Delivery

Forecast is above 400 authored lines. Strategy: `ask-on-risk`; chain strategy to be asked before opening pull requests. One whole-branch native review at the end.

## Progress

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

Next step: T3 (purchased planned items stay on the list read as `purchased` until their meal is cooked or leaves the range; guide updated for the whole contract).
