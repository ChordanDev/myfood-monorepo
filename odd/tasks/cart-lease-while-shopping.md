# Cart lease while shopping (issue #41)

## Objective
A User ticks items into the Cart in the aisle; the lease is renewed while the screen is open and released on cancel or abandonment; another Membership is told the Cart is held.

## Authorized scope
Issue #41 acceptance criteria only (API + mobile). Parent: #5. Blocker #39 is merged.

## Acceptance criteria
- [x] `POST /api/shopping-items/mark-cart` returns `{ sessionId, leaseExpiresAt, items[] }` (camelCase); renew and cancel keep semantics inside the `ApiError` envelope.
- [x] Another Membership marking held items -> `cart_locked`; an expired lease reads back as `cart: null`.
- [x] Mobile renews at most once a minute while the screen is active and cancels when the User abandons the Cart.
- [x] Tests drive time through existing clock helpers (`CartFixtures.expire!`, `Cart.expire_account/2` with `now`), never sweeper timing.

## Decisions
- `items[]` replaces `reservations[]` and keeps `itemId` and `reservationToken` (checkout still needs the token).
- `cart_locked` is 409, added to `ApiError` `@codes` and mobile `KNOWN_AUTH_ERROR_CODES`.

## Tasks
- [x] T1 API: mark-cart envelope, `cart_locked`, renew/cancel through `ApiError`, tests (route: delegated writer; trigger: 2+ non-trivial files)
- [x] T2 Mobile: cart client (mark/renew/cancel), throttled renew hook, cancel on abandon, `cart_locked` handling, tests (route: delegated writer)
- [x] T3 Docs: GLOSSARY Cart / Cart lease, frontend_integration_guide

## Progress / evidence
- T1 (uncommitted, parent commits): mark-cart returns `{sessionId, leaseExpiresAt, items[]}`; `cart_locked` 409, `stale_cart` 409, `cart_not_found` 404 via ApiError on mark-cart/renew/cancel. RED observed (8 failures) then GREEN: mix test 1474 passed, 20 skipped; format and warnings-as-errors clean; mobile authErrorCodeContract 9 passed, tsc clean. Also touched mobile auth.ts union + Spanish messages (required by tsc/contract).
- T2 (uncommitted, parent commits): `markInCart`/`renewCart`/`cancelCart` client + parsers; `useCartLease` hook (renew at most once per 60s while focused and AppState active, cancel on abandon, `cart_locked` message, `stale_cart` drops the Cart and rereads); ShoppingScreen ticks needed lines and has a cancel-Cart icon button. RED observed (api: 12 failed; hook: module missing; screen: 6 failed), then GREEN: shopping suites 338 passed; full jest 1600 passed, 6 failed (all `authService.test.ts` planning-channel allowlist count, 29 vs 37, untouched by T2 and failing on base); `tsc --noEmit` clean; eslint 0 errors (4 pre-existing warnings); prettier clean. Leaving the screen does not cancel the Cart: renewal just stops and the lease runs out.
