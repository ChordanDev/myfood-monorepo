# Cart lease while shopping (issue #41)

## Objective
A User ticks items into the Cart in the aisle; the lease is renewed while the screen is open and released on cancel or abandonment; another Membership is told the Cart is held.

## Authorized scope
Issue #41 acceptance criteria only (API + mobile). Parent: #5. Blocker #39 is merged.

## Acceptance criteria
- [ ] `POST /api/shopping-items/mark-cart` returns `{ sessionId, leaseExpiresAt, items[] }` (camelCase); renew and cancel keep semantics inside the `ApiError` envelope.
- [ ] Another Membership marking held items -> `cart_locked`; an expired lease reads back as `cart: null`.
- [ ] Mobile renews at most once a minute while the screen is active and cancels when the User abandons the Cart.
- [ ] Tests drive time through existing clock helpers (`CartFixtures.expire!`, `Cart.expire_account/2` with `now`), never sweeper timing.

## Decisions
- `items[]` replaces `reservations[]` and keeps `itemId` and `reservationToken` (checkout still needs the token).
- `cart_locked` is 409, added to `ApiError` `@codes` and mobile `KNOWN_AUTH_ERROR_CODES`.

## Tasks
- [x] T1 API: mark-cart envelope, `cart_locked`, renew/cancel through `ApiError`, tests (route: delegated writer; trigger: 2+ non-trivial files)
- [ ] T2 Mobile: cart client (mark/renew/cancel), throttled renew hook, cancel on abandon, `cart_locked` handling, tests (route: delegated writer)
- [ ] T3 Docs: GLOSSARY Cart / Cart lease, frontend_integration_guide

## Progress / evidence
- T1 (uncommitted, parent commits): mark-cart returns `{sessionId, leaseExpiresAt, items[]}`; `cart_locked` 409, `stale_cart` 409, `cart_not_found` 404 via ApiError on mark-cart/renew/cancel. RED observed (8 failures) then GREEN: mix test 1474 passed, 20 skipped; format and warnings-as-errors clean; mobile authErrorCodeContract 9 passed, tsc clean. Also touched mobile auth.ts union + Spanish messages (required by tsc/contract).
