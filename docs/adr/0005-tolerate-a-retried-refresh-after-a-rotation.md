# Tolerate a retried refresh for 10 seconds after a rotation

Status: accepted

Refresh tokens rotate on every use, and a rotated token that shows up again is treated as a replay: the Device session of that User on that device is revoked. But a rotation commits before its answer reaches the phone. When the answer is lost (a network drop, a client timeout, the app killed mid-request) the app still holds the old token, its honest retry is indistinguishable from a replay, and the person is sent back to the email code. We decided that a refresh token is accepted again for 10 seconds after it was rotated, as long as the Device session that replaced it has not been used or ended since. The retry revokes the pair nobody received and issues a new one. After the 10 seconds, or once the replacement was rotated, logged out or taken over by a login, a rotated token is a replay as before.

The window is short on purpose: for as long as it lasts, a rotated token is still a credential. It is a config value (`refresh_retry_window_seconds`); `0` turns the tolerance off. It counts from the first rotation of the presented token, so retries do not extend it. The client has to fit inside it: a refresh that fails is retried at once, with a timeout short enough for both attempts to land within the 10 seconds (issue #205).

A retry gets a new pair, not the one the lost response carried, because only the SHA-256 digest of a refresh token is stored.

## Considered options

- **No window (the previous behaviour).** The strictest replay detection, at the price of a login with a new email code for every lost response.
- **Return the identical pair.** What a client expects from an idempotent retry, and two concurrent refreshes would agree on one pair. It needs the refresh token, or what is needed to sign it again, kept readable for the length of the window; today nothing readable is stored.
- **A window longer than the client timeout.** It would cover a lost response without any change to the app, whose refresh request waited 30 seconds when this was decided. A stolen token would be accepted for that much longer, so the client changes instead.

## Consequences

- Inside the window a stolen refresh token is accepted once more without ending the session. Whoever presents the rotated token second gets the live pair, and the other holder's pair becomes a replaced one. The theft is noticed when that holder next refreshes, up to one access token lifetime later (1 hour), and that replay revokes the session on the device.
- A pair superseded by a retry is itself a replaced token and follows the same rule from the moment it was superseded.
- Logging out with a replaced token does nothing, as it did for any rotated token. If someone else retried inside the window, the owner's logout does not end that session; their next login on that device does.
- Two concurrent refreshes with the same token no longer end the session: the second is a retry and supersedes the pair of the first. A client has to store the pair of the last response it received and keep one refresh in flight.
- No schema change: the window is measured from `revoked_at` of the rotated row, and `replaced_by_id` moves to the newest row.
