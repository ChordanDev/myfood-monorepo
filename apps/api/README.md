# MealPlannerApi

To start your Phoenix server:

* Create local direnv file: `cp .envrc.local.example .envrc.local` and set required values
* Allow direnv to load variables: `direnv allow`
* Run `mix setup` to install dependencies (it only runs `deps.get`)
* Create and migrate the database: `mix ecto.create && mix ecto.migrate`. The migrations insert the reference Plans, so sign-up works without the seeds
* On a development database migrated before the 15-digit migration versions were renumbered (issue #315), run `mix db.renumber_migrations` once before `mix ecto.migrate`. It rewrites the old versions in `schema_migrations` to the new ones in one transaction, so the renamed migrations are not run again. It is safe to run twice and does nothing on a fresh database. Run it on the test database too (`MIX_ENV=test mix db.renumber_migrations`) if it was migrated before the renumbering
* Optionally load demo data (a demo Account, two Users, a recipe and a scheduled meal) with `mix run priv/repo/seeds.exs`: once, on a fresh development database, never in production
* Start Phoenix endpoint with `mix phx.server` or inside IEx with `iex -S mix phx.server`

Now you can visit [`localhost:4000`](http://localhost:4000) from your browser.

Ready to run in production? Please [check our deployment guides](https://hexdocs.pm/phoenix/deployment.html).

## Learn more

* Official website: https://www.phoenixframework.org/
* Guides: https://hexdocs.pm/phoenix/overview.html
* Docs: https://hexdocs.pm/phoenix
* Forum: https://elixirforum.com/c/phoenix-forum
* Source: https://github.com/phoenixframework/phoenix

## Project Notes

* Known issues: `docs/known-issues.md`

## Auth Policy

Sign-in and sign-up use a code sent by email. Supported routes:

* `POST /api/auth/login/request-code` and `POST /api/auth/login/verify-code`
* `POST /api/auth/signup/request-code` and `POST /api/auth/signup/verify-code`
* `POST /api/auth/refresh` and `POST /api/auth/logout`

Removed endpoint:

* `POST /api/auth/token` is no longer available.

Reason:

* The app login surface is intentionally limited to the email code routes above.

## Email Code Auth

Login serves only emails that already have a User (`email_not_found` otherwise). Sign-up serves only emails that do not (`email_already_exists` otherwise); verifying a sign-up code creates the User, their Account, the owner Membership and the Trial.

In development the mailer uses `Bamboo.LocalAdapter` (`config/dev.exs`), so no email leaves the machine. Read the code from `Bamboo.SentEmail.all/0` in the `iex -S mix phx.server` session.

Endpoint contract:

* Request a code: `POST /api/auth/login/request-code` or `POST /api/auth/signup/request-code`
* Body:

```json
{
	"email": "user@example.com"
}
```

* Verify it: `POST /api/auth/login/verify-code` or `POST /api/auth/signup/verify-code`
* Body:

```json
{
	"email": "user@example.com",
	"code": "123456",
	"deviceId": "<device_id>"
}
```

Field notes:

* `code`: the six-digit code from the email. It expires after 10 minutes, and a new one can be requested after 60 seconds
* Limits: 5 code requests per email and 20 per client IP in a rolling hour (an IPv6 client counts as its whole /64, and its code requests also count against its /56, 100 per rolling hour), and 20 failed login verifications per client IP in a rolling hour; over a limit the answer is `429 rate_limited` with a `retry-after` header in seconds. The failed-verification limit only refuses failed checks (a wrong, expired or locked code): the right digits of a code that is still valid always log in, so nobody sharing the IP can lock another User out
* `deviceId`: a non-blank string that names the phone, in practice a UUID the app generates. The session it opens replaces the one the same User had on that device

Example calls:

```bash
curl -X POST http://localhost:4000/api/auth/login/request-code \
	-H 'content-type: application/json' \
	-d '{"email":"user@example.com"}'

curl -X POST http://localhost:4000/api/auth/login/verify-code \
	-H 'content-type: application/json' \
	-d '{"email":"user@example.com","code":"123456","deviceId":"DEVICE_ID"}'
```

On success, a code request returns:

* `status` (`"code_sent"`)
* `expiresInSeconds`
* `resendAvailableInSeconds`

On success, both verify endpoints return:

* `accessToken`
* `refreshToken`
* `tokenType`
* `me`, the same payload `GET /api/me` returns

Errors on these routes use the envelope `{ "error": { "code": "<code>", "message": "<text>" } }`.

Session examples:

```bash
curl -X POST http://localhost:4000/api/auth/refresh \
	-H 'content-type: application/json' \
	-d '{"refreshToken":"REFRESH_TOKEN"}'

curl -X POST http://localhost:4000/api/auth/logout \
	-H 'content-type: application/json' \
	-d '{"refreshToken":"REFRESH_TOKEN"}'
```

`POST /api/auth/refresh` returns a new `accessToken` and `refreshToken` (the presented refresh token stops working), and `POST /api/auth/logout` answers `204` with no body.
