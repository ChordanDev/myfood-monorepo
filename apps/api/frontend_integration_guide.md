# Frontend Integration Guide (React Native)

This document is the integration reference for the current backend contracts in `meal_planner_api`.

> **Auth follows spec #1.** The authentication contract the mobile app uses is defined in
> [ChordanDev/myfood-monorepo#1](https://github.com/ChordanDev/myfood-monorepo/issues/1). Section 2
> summarises it. Section 10 states which error body shape each group of endpoints returns today.

## 1. Base URL and Transport

- Base HTTP URL (example local): `http://localhost:4000/api`
- Content-Type: `application/json`
- Auth for protected REST routes: `Authorization: Bearer <access_token>`
- WebSocket endpoint: `/socket/websocket`

## 2. Authentication

Sign-in and sign-up use a code sent by email; there is no password or social login. Login serves emails
that already have a User, sign-up serves emails that do not. Both end in the same session: a short-lived
access token and a refresh token bound to the device. The full contract is spec
[#1](https://github.com/ChordanDev/myfood-monorepo/issues/1); this section summarises it.

Errors on the routes in 2.1, 2.2 and `POST /api/auth/refresh` use the envelope
`{ "error": { "code": "<code>", "message": "<text>" } }` (see section 10).

### 2.1 Request a code

- Method: `POST`
- Path: `/api/auth/login/request-code` (existing User) or `/api/auth/signup/request-code` (new User)
- Auth required: No

Request body:

```json
{
  "email": "user@example.com"
}
```

Success response (`200`):

```json
{
  "status": "code_sent",
  "expiresInSeconds": 600,
  "resendAvailableInSeconds": 60
}
```

Error responses:

- `422 invalid_email`
- `404 email_not_found`: login only, no User has this email
- `409 email_already_exists`: sign-up only, a User already has this email
- `429 rate_limited`: resend cooldown or hourly request limit; the `retry-after` header carries the wait in seconds
- `502 code_send_failed`: the email could not be sent; any earlier code stays valid, and the request can be retried at once (it still counts against the hourly limit)

### 2.2 Verify the code

- Method: `POST`
- Path: `/api/auth/login/verify-code` or `/api/auth/signup/verify-code`
- Auth required: No

Request body:

```json
{
  "email": "user@example.com",
  "code": "123456",
  "deviceId": "<device_id>"
}
```

Rules:

- `code` is the six-digit code from the email. Only the latest code requested for an email can verify.
- `deviceId` is a non-blank string that names the phone, in practice a UUID the app generates and keeps.
  The session it opens replaces the one the same User already had on that device.
- A sign-up verify creates the User, their individual Account, the owner Membership and the Trial.

Success response (`200`):

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "tokenType": "Bearer",
  "me": {
    "user": {
      "id": "...",
      "email": "user@example.com",
      "displayName": "user",
      "householdSize": null,
      "cookingSkill": null
    },
    "account": {
      "id": "...",
      "type": "individual",
      "trialEndsAt": "2026-01-08T12:00:00Z",
      "timezone": null,
      "subscriptionStatus": "none",
      "access": {
        "canUseApp": true,
        "reason": null
      }
    },
    "membership": {
      "role": "owner"
    },
    "onboarding": {
      "isComplete": false
    }
  }
}
```

`me` is the same payload `GET /api/me` returns.

Error responses:

- `422 code_invalid`: wrong code, or a missing or blank `deviceId` (which does not spend the code or count as an attempt)
- `401 code_expired`
- `429 too_many_attempts`: the code is locked; request a new one
- `401 account_not_found`: login only, the User has no active Membership
- `409 email_already_exists`: sign-up only, the email got a User after the code was sent
- `429 rate_limited`: login only, a wrong, expired or locked code from a client IP that has 20 failed verifications in the last hour (the API's `@max_verify_failures_per_ip_per_window`); the `retry-after` header carries the wait in seconds. The right digits of a code that is still valid are never refused by this limit; a wrong code still counts as an attempt on the code. If the right code gets this answer, it has expired or been locked: request a new one

When the session cannot be opened after a right code (`account_not_found`, or a server error), the code is not spent and the same request can be retried.

### 2.3 Renew and end the session

Renew:

- Method: `POST`
- Path: `/api/auth/refresh`
- Auth required: No (the refresh token in the body is the credential)

Request body:

```json
{
  "refreshToken": "<jwt>"
}
```

Success response (`200`), without `me`:

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "tokenType": "Bearer"
}
```

Every refresh returns a new refresh token; store it and discard the one that was sent. Access tokens live
1 hour and refresh tokens 30 days.

A refresh whose response never arrived may be sent again with the same token within 10 seconds: it gets a
new pair and the pair of the lost response stops working, so always store the pair of the last response
received. After those 10 seconds a refresh token that was already used gets `401 refresh_token_replayed`
and the sessions of that device are revoked. The client must still serialize the refresh: one call in
flight, shared by every request that found the access token expired.

Error responses (all `401`): `refresh_token_invalid`, `refresh_token_replayed`, `refresh_token_revoked`,
`refresh_token_expired`, `refresh_token_session_mismatch`, and `account_not_found` when the Membership of
the session is no longer active.

End:

- Method: `POST`
- Path: `/api/auth/logout`
- Auth required: No
- Request body: `{ "refreshToken": "<jwt>" }`
- Response: `204` with no body, also for a refresh token that is unknown, already revoked or missing.

### 2.4 Authenticated user endpoints

All routes below require:

```http
Authorization: Bearer <accessToken>
```

If the token is missing or invalid, the backend returns `401` with the envelope:

```json
{
  "error": {
    "code": "unauthenticated",
    "message": "Authentication is required for this request."
  }
}
```

An expired access token gets `401 access_token_expired` in the same envelope: refresh (2.3) and retry,
running one refresh at a time.

## 3. Account Context and Budget Inputs

### 3.1 Get account context

- Method: `GET`
- Path: `/api/account/context`

Success response:

```json
{
  "account_id": "...",
  "budget": {
    "account_id": "...",
    "weekly_limit_cents": 45000,
    "currency": "ARS"
  },
  "inventory_items": ["Tomate", "Pollo", "Arroz"],
  "subscription": {
    "max_planning_days": 7
  }
}
```

Notes:

- `budget` can be overridden by query params in planning-related flows (`weekly_budget_cents`, `currency`).
- `subscription.max_planning_days` controls planning limits.

### 3.2 Get current user

- Method: `GET`
- Path: `/api/me`

### 3.3 Edit the Onboarding profile

- Method: `PUT`
- Path: `/api/me/profile`
- Not capability-gated: an Account whose access has expired can still use it.

Request body, all three fields required:

```json
{
  "displayName": "Ana María",
  "householdSize": 4,
  "cookingSkill": "intermediate"
}
```

- `displayName`: string, 1 to 64 characters after trimming. A character is a grapheme (a joined emoji
  counts as one); the name also holds at most 255 Unicode code points and no NUL character (`\u0000`).
- `householdSize`: JSON integer, 1 to 20. The string `"4"` and the number `4.5` are rejected.
- `cookingSkill`: `beginner`, `intermediate` or `advanced`.

Success response (`200`), the same `user` object `GET /api/me` returns:

```json
{
  "user": {
    "id": "...",
    "email": "ana@example.com",
    "displayName": "Ana María",
    "householdSize": 4,
    "cookingSkill": "intermediate"
  }
}
```

Fields are validated in the order `displayName`, `householdSize`, `cookingSkill`, and the first offending
one decides the response: `422 invalid_cooking_skill` when `cookingSkill` is a string outside the catalog,
`422 validation_error` otherwise, with a `message` that names the field. A rejected request stores nothing.

### 3.4 Get slot cooking times

For each of breakfast, lunch and dinner: the minutes the signed-in User will cook and their Hunger level.
The times belong to the User, not to the Account. Like `GET /api/me`, this route and the one in 3.5 are not
behind the capability guard, so they stay reachable when the Account's trial has expired. Both read and
render camelCase keys.

- Method: `GET`
- Path: `/api/me/slot-cooking-times`

Success response (`200`), with no wrapper:

```json
{
  "breakfast": { "cookingTimeMinutes": 0, "hungerLevel": "light" },
  "lunch": { "cookingTimeMinutes": 30, "hungerLevel": "normal" },
  "dinner": { "cookingTimeMinutes": 45, "hungerLevel": "strong" }
}
```

Errors (envelope, see section 10):

- `404 slot_cooking_times_not_found`: the User has not saved the three slots yet. The mobile settings
  screen reads this code as "none saved" and starts from its default set; any other failure is an error.

### 3.5 Replace slot cooking times

- Method: `PUT`
- Path: `/api/me/slot-cooking-times`

Request body: the same shape as the response in 3.4. The body is the whole set and replaces the saved one;
nothing is saved when it is refused.

Rules:

- Exactly the three slots `breakfast`, `lunch` and `dinner`, each an object. `snack` is neither required
  nor accepted, and neither is any other key.
- `cookingTimeMinutes`: an integer from `0` to `240`. `0` means the User does not cook that slot. A
  decimal (`30.0`), a numeric string or a boolean is refused.
- `hungerLevel`: `light`, `normal` or `strong`.

Success response (`200`): the stored set, in the shape of 3.4.

Errors (envelope, see section 10):

- `422 validation_error`: a slot is missing or is not an object, a key is not one of the three slots,
  `cookingTimeMinutes` is missing, not an integer or outside `0` to `240`, or `hungerLevel` is missing or
  not a string. The `message` is `The field <field> is not valid.`, where `<field>` is the field at fault
  in camelCase: a slot (`lunch`), a key that is not a slot (`snack`) or a field of a slot
  (`lunch.cookingTimeMinutes`, `dinner.hungerLevel`).
- `422 validation_error` with the `message` `The request is not valid.`: the body is not a JSON object,
  or no parser read it (for example a `text/plain` body). There is no field to name.
- `422 invalid_hunger_level`: `hungerLevel` is a string outside `light`, `normal` and `strong`.

Only the first problem is reported: a key that is not a slot, then each slot in the order breakfast,
lunch, dinner, and within a slot its minutes before its Hunger level.

### 3.6 Update the Account timezone

- Method: `PUT`
- Path: `/api/account/timezone`
- Not capability-gated: an Account whose access has expired can still use it.

The app sends the device's IANA timezone so the Account's "today" follows the User when they travel.
`account.timezone` in `GET /api/me` is the stored value, `null` until one is saved (the Account's day is
then the UTC day). Send it only when it differs from the one `me` reported.

Request body, `timezone` required:

```json
{
  "timezone": "America/Argentina/Buenos_Aires"
}
```

- `timezone`: string, an IANA timezone id known to the server. Missing, `null`, blank, non-string and
  unknown values are rejected.

Success response (`200`):

```json
{
  "account": {
    "id": "...",
    "timezone": "America/Argentina/Buenos_Aires"
  }
}
```

Any member of the Account may update it and the last write wins. A rejected request answers
`422 validation_error` with a `message` that names `timezone`, and the stored value is unchanged. Dates
already computed are not recomputed: only later requests see the new "today".

## 4. Planning (REST)

### 4.1 Weekly planning generation

- Method: `GET`
- Path: `/api/planning/weekly`
- Query params supported:
  - `kcal_target` (int)
  - `weekly_budget_cents` (int)
  - `currency` (string)
  - `days` (list, max constrained by plan)

Example:

```http
GET /api/planning/weekly?kcal_target=2200&weekly_budget_cents=60000&currency=ARS
```

This route is in the mobile casing scope: keys are camelCase in the response.

Success response (`200`):

```json
{
  "data": {
    "days": [
      {
        "day": "monday",
        "meals": [
          {
            "recipeId": "...",
            "recipeName": "...",
            "isFavorite": false,
            "slot": "breakfast",
            "macros": { "calories": 450 },
            "prepTimeMinutes": null
          }
        ]
      }
    ],
    "estimatedCostCents": 21500,
    "optimizerUsed": true,
    "maxPlanningDays": 7,
    "subscriptionTier": "free"
  }
}
```

- Each meal is the shared meal summary of the calendar. A meal carries neither its day nor its cost:
  the day is the `day` of the entry that lists it, and only the whole plan has a cost,
  `estimatedCostCents`.
- `isFavorite` is always `false` and `prepTimeMinutes` always `null` here: the candidates of the
  optimizer know neither.

Error responses:

- `400` for:
  - `invalid_payload`
  - `invalid_meals`
  - `duplicate_meal_slot`
  - `exceeds_max_planning_days`
- `422` for other planning errors.

Error format:

```json
{
  "error": "exceeds_max_planning_days"
}
```

### 4.2 Confirm selected plan

- Method: `POST`
- Path: `/api/planning/confirm`

Request body:

```json
{
  "meals": [
    {
      "date": "2026-03-30",
      "slot": "lunch",
      "recipe_id": "3f5b06a8-7a79-4b4a-95ca-89dff7f9c6f2"
    },
    {
      "date": "2026-03-30",
      "slot": "dinner",
      "recipe_id": "98f8de95-352e-4c25-b89a-c99db66b9003"
    }
  ]
}
```

Rules:

- Required keys per meal: `date`, `slot`, `recipe_id`
- Accepted slots: `breakfast`, `lunch`, `snack`, `dinner`
- No duplicate `{date, slot}` pairs

Success response:

```json
{
  "data": {
    "scheduled_meals_count": 2,
    "scheduled_meals": [
      {
        "id": "...",
        "date": "2026-03-30",
        "slot": "lunch",
        "recipe_id": "...",
        "is_cooked": false
      }
    ]
  }
}
```

## 5. Planning Chat (REST)

### 5.1 Generate proposal

- Method: `POST`
- Path: `/api/planning/chat`

Request body:

```json
{
  "message": "Quiero una semana barata y alta en proteina",
  "content_type": "text",
  "date_from": "2026-03-30",
  "date_to": "2026-04-05",
  "kcal_target": 2200,
  "weekly_budget_cents": 55000,
  "currency": "ARS",
  "days": ["monday", "tuesday", "wednesday"]
}
```

`date_from` to `date_to` covers 1 to 7 days, both ends counted, on every plan. Neither refusal plans anything:

- A range that ends before it starts answers `422` with `{"error": "invalid_date_range"}`.
- A longer range answers `422` with the error envelope, `details.maxDays` holding the allowed maximum:

```json
{
  "error": {
    "code": "date_range_too_long",
    "message": "The date range must not be longer than 7 days.",
    "details": { "maxDays": 7 }
  }
}
```

Success response:

```json
{
  "data": {
    "run_id": "...",
    "proposal_id": "...",
    "date_from": "2026-03-30",
    "date_to": "2026-04-05",
    "proposal": {
      "summary": "...",
      "scheduled_meals": [],
      "weekly_plan": {},
      "shopping_hints": []
    }
  }
}
```

### 5.2 Favorites

- Method: `GET`
- Path: `/api/planning/favorites?limit=10`

### 5.3 Confirm proposal

- Method: `POST`
- Path: `/api/planning/proposals/:proposal_id/confirm`

Success response:

```json
{
  "data": {
    "proposal_id": "...",
    "generation_run_id": "...",
    "scheduled_meals_count": 14,
    "status": "confirmed"
  }
}
```

### 5.4 Reject proposal

- Method: `POST`
- Path: `/api/planning/proposals/:proposal_id/reject`

Success response:

```json
{
  "data": {
    "proposal_id": "...",
    "generation_run_id": "...",
    "status": "rejected"
  }
}
```

Planning chat errors return `422` with:

```json
{
  "error": "<reason>"
}
```

## 6. Inventory (REST)

Keys are camelCase on these routes, in requests and in responses (issue #11). snake_case request keys are
still accepted. Values are not rewritten: `no_perecederos` stays a category and `validation_error` stays a
code.

Quantities are integers in thousandths of the unit (`quantityMilli: 1500` with `unit: "g"` is 1.5 g).

### 6.1 Get inventory view

- Method: `GET`
- Path: `/api/inventory`

Success response:

```json
{
  "data": {
    "sections": {
      "ok": [],
      "warning": [],
      "expired": []
    },
    "byCategory": {
      "no_perecederos": []
    },
    "extras": [],
    "totals": {
      "itemsCount": 12,
      "warningCount": 2,
      "expiredCount": 1
    }
  }
}
```

A lot at quantity zero (disposed or fully consumed) is not listed and not counted.

Each inventory item contains:

```json
{
  "id": "<item_uuid>",
  "ingredientId": "<ingredient_uuid>",
  "name": "Arroz",
  "category": "no_perecederos",
  "quantityMilli": 400,
  "unit": "g",
  "sourceKind": "extra",
  "acquiredAt": null,
  "expiresAt": "2026-10-28",
  "freshness": "ok",
  "isLeftover": false,
  "notes": null
}
```

- `category`: `lacteos`, `frutas`, `verduras`, `carnes`, `granos`, `congelados`, `no_perecederos` or `otros`.
- `unit`: `g`, `ml` or `unit`.
- `sourceKind`: `planned` or `extra`.
- `acquiredAt`: ISO 8601 datetime, or `null`.
- `expiresAt`: always an ISO date (`YYYY-MM-DD`). It is the explicit expiry when the lot has one, else the
  one inferred from the acquisition date and the category.
- `freshness`: `ok`, `warning` or `expired`.

### 6.2 Add extra item

- Method: `POST`
- Path: `/api/inventory/items/add-extra`

Request body:

```json
{
  "ingredientId": "<ingredient_uuid>",
  "quantityMilli": 500,
  "unit": "g",
  "expiresAt": "2026-10-28",
  "notes": "Opened bag",
  "isLeftover": false
}
```

- `ingredientId` or `ingredientName` (exact catalogue name) is required; `ingredientId` wins when both are
  sent.
- `quantityMilli`: required, an integer above zero.
- `unit`: required, one of `g`, `ml`, `unit`.
- `expiresAt`: optional, an ISO date or an ISO datetime with an offset. It is stored and read back as its
  UTC date.
- `notes`: optional string, trimmed, of at most 1000 characters. A blank one is stored as `null`.
- `isLeftover`: optional boolean, `false` when omitted.

An add with `expiresAt`, `notes` or `isLeftover: true` creates a lot of its own. An add with none of them
accumulates in the anonymous lot of that ingredient and unit, and the response carries the accumulated lot.

Success response:

```json
{
  "data": {
    "item": { "id": "<item_uuid>", "quantityMilli": 500, "...": "the item of 6.1" },
    "mutationEvent": {
      "id": "<event_uuid>",
      "inventoryItemId": "<item_uuid>",
      "triggerType": "manual",
      "operation": "add",
      "quantityBeforeMilli": 0,
      "quantityDeltaMilli": 500,
      "quantityAfterMilli": 500,
      "insertedAt": "2026-10-08T17:02:11.482913Z"
    }
  }
}
```

`triggerType` is `purchase`, `cooking`, `manual` or `voice`; `operation` is `add`, `subtract`, `set` or
`delete`.

### 6.3 Update quantity

- Method: `POST`
- Path: `/api/inventory/items/:item_id/quantity`

Request body:

```json
{
  "quantityMilli": 250
}
```

`quantityMilli` is the new quantity of the lot: an integer, zero or above. Setting zero empties the lot,
which then leaves the inventory view.

Success response: `{ "data": { "item": {...}, "mutationEvent": {...} } }` as in 6.2, with operation `set`.

### 6.4 Dispose item

- Method: `POST`
- Path: `/api/inventory/items/:item_id/dispose`

Request body (optional reason):

```json
{
  "reason": "expired"
}
```

Success response:

```json
{
  "data": {
    "disposed": true,
    "mutationEvent": {
      "id": "<event_uuid>",
      "inventoryItemId": "<item_uuid>",
      "triggerType": "manual",
      "operation": "delete",
      "quantityBeforeMilli": 500,
      "quantityDeltaMilli": -500,
      "quantityAfterMilli": 0,
      "insertedAt": "2026-10-08T17:05:40.120377Z"
    }
  }
}
```

The lot is kept at quantity zero, so its mutation events survive, and it leaves the inventory view.

### 6.5 Inventory errors

Every error of the routes in this section uses the envelope of section 10:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is not valid."
  }
}
```

| Status | Code                       | When                                                                                              |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `422`  | `validation_error`         | Missing, unknown or malformed ingredient; missing, zero, negative or non-integer quantity; missing or unknown unit; malformed `expiresAt`; `notes` that is not a string or is longer than 1000 characters; `isLeftover` that is not a boolean; a voice payload without a `transcript` or with one longer than 500 Unicode codepoints, or an apply whose `intent` is missing, not a `subtract`, or has a non-positive `quantityMilli` or a malformed `ingredientId`; a rescue request without ingredients |
| `404`  | `inventory_item_not_found` | `:item_id` is not a lot of the Account: unknown, owned by another Account, or not a UUID          |
| `404`  | `not_found`                | No recipe is available for a rescue plan                                                          |
| `500`  | `unknown_error`            | Unexpected failure                                                                                |

The envelope does not name the field that failed.

### 6.6 Voice flows

A spoken Inventory adjustment is previewed, then applied. Only `subtract` exists.

- Preview parse (writes nothing):
  - `POST /api/inventory/voice/preview`
- Apply the intent:
  - `POST /api/inventory/voice/apply`

Preview request:

```json
{
  "transcript": "Me comí la mitad del queso crema"
}
```

Preview response (`200`):

```json
{
  "data": {
    "confirmationRequired": false,
    "confidence": 0.9,
    "intent": {
      "operation": "subtract",
      "ingredientId": "...",
      "name": "Queso crema",
      "quantityMilli": 200000,
      "unit": "g"
    }
  }
}
```

`confidence` is from 0 to 1. A named ingredient in stock, a consume verb and a stated amount (a
fraction, or a quantity in the unit of the stock) is confident; a vague or missing amount takes all
the stock with low confidence. `confirmationRequired` is `true` when `confidence` is below `0.8`.

Apply request: send back the `transcript` and the `intent` of the preview, with `confirmed: true`
once the User confirmed it.

```json
{
  "transcript": "Me comí la mitad del queso crema",
  "intent": {
    "operation": "subtract",
    "ingredientId": "...",
    "name": "Queso crema",
    "quantityMilli": 200000,
    "unit": "g"
  },
  "confirmed": false
}
```

Apply response (`200`) lists one mutation event per lot touched, first expiring lot first, each with
`triggerType` `voice` and the transcript stored in the ledger. The subtraction is capped at the
stock, so `quantityDeltaMilli` can be smaller in magnitude than the intent.

```json
{
  "data": {
    "ingredientId": "...",
    "quantityDeltaMilli": -200000,
    "mutationEvents": [{ "id": "...", "inventoryItemId": "...", "triggerType": "voice", "operation": "subtract", "quantityBeforeMilli": 400000, "quantityDeltaMilli": -200000, "quantityAfterMilli": 200000, "insertedAt": "..." }]
  }
}
```

The server derives the confidence again from the transcript and never reads a client one. An intent
that is not confident, or that differs from what the transcript says, is refused without
`confirmed: true`.

| Status | Code                          | When                                                          |
| ------ | ----------------------------- | ------------------------------------------------------------- |
| `422`  | `voice_parse_failed`          | The transcript names no ingredient the Account has in stock   |
| `422`  | `voice_confirmation_required` | Apply of a low-confidence or edited intent without `confirmed: true` |
| `422`  | `validation_error`            | Missing transcript, a transcript longer than 500 Unicode codepoints, or malformed intent |
| `404`  | `inventory_item_not_found`    | The intent's ingredient has no usable stock any more          |

### 6.7 Rescue planning from expiring ingredients

- Method: `POST`
- Path: `/api/planning/rescue`

Request body can use:

- `ingredient_ids` (array of ingredient UUIDs)
- `inventory_item_ids` (array of inventory item UUIDs)

## 7. Shopping (REST)

### 7.1 Get shopping list

- Method: `GET`
- Path: `/api/shopping-list`
- Query params (both optional):
  - `untilDate` (`YYYY-MM-DD`): keeps the planned lines of Scheduled meals on or before that date, the date
    itself included. Without it the list covers every upcoming uncooked Scheduled meal, with no upper bound.
  - `groupBy` (`ingredient` or `meal`, default `ingredient`): one line per ingredient and unit, adding up the
    meals that need it, or one line per meal.

This route is in the mobile casing scope: keys are camelCase in the response, and the params are read in
camelCase or snake_case (`until_date`, `group_by`).

"Today" is the Account's today, computed by the server: the current date in the Account's stored timezone,
or the UTC date while none is stored. The client never sends its local date. The list starts at that date,
and pending items planned before it are archived by the read. `from_date`, `to_date`, `start_date`,
`end_date` and `include_archived` are not read.

Success response (`groupBy=ingredient`):

```json
{
  "data": {
    "planned": [
      {
        "id": "<ingredient_uuid>:g",
        "ingredientId": "<ingredient_uuid>",
        "name": "Tomate",
        "category": "verduras",
        "quantityMilli": 800,
        "unit": "g",
        "status": "needed",
        "source": "planned_meal",
        "supermarketId": null,
        "allocations": [
          {
            "itemId": "<shopping_item_uuid>",
            "scheduledMealId": "<scheduled_meal_uuid>",
            "date": "2026-10-08",
            "slot": "lunch",
            "quantityMilli": 400,
            "status": "needed"
          },
          {
            "itemId": "<shopping_item_uuid>",
            "scheduledMealId": "<scheduled_meal_uuid>",
            "date": "2026-10-10",
            "slot": "dinner",
            "quantityMilli": 400,
            "status": "needed"
          }
        ]
      }
    ],
    "manual": [],
    "cart": null,
    "totals": {
      "needed": 1,
      "inCart": 0,
      "removed": 0,
      "estimatedCents": 0
    },
    "plannedDates": ["2026-10-08", "2026-10-10"]
  }
}
```

Fields:

- `planned`: the lines to buy for the plan, ordered by the date of their first allocation, then by its slot
  in the order of the day.
  - `id`: `<ingredientId>:<unit>` with `groupBy=ingredient`; the Shopping item id with `groupBy=meal`.
  - `status`: `needed`, `in_cart`, `removed` or `purchased`. It is decided by the allocations that are still
    to buy, the ones that are neither removed nor purchased: an ingredient line reads `in_cart` only when
    every one of them is in a Cart, whoever holds it; otherwise it reads `needed`. A line with nothing left
    to buy reads `purchased` when any allocation was bought, and `removed` only when every allocation was
    removed (7.8).
  - `quantityMilli`: what is still to buy, the sum of the allocations that are `needed` or `in_cart`. On a
    `purchased` line it is what was bought, the sum of its purchased allocations; on a `removed` line it adds
    up all of them, so it can be restored.
  - `source`: always `planned_meal`.
  - `supermarketId`: the supermarket every allocation is assigned to, or `null` when there is none or they
    differ.
  - `allocations`: the share of the line each Scheduled meal needs. `itemId` is the Shopping item to send to
    `/api/shopping-items/mark-cart`. With `groupBy=meal` a line has exactly one allocation, and the line has
    the status and the quantity of that allocation.
    - `status`: the status of that Shopping item, `needed`, `in_cart`, `removed` or `purchased`. Only a
      `needed` allocation can go into a Cart.
- `manual`: the Shopping items the User added by hand (7.6) that are still on the list, oldest first. Each
  one has the keys of a `planned` line, with `source` `manual`, `allocations` `[]`, `ingredientId` `null`
  when no ingredient was given and `category` `otros` in that case. They are never merged with each other or
  with a planned line, `untilDate` does not limit them and `groupBy` does not change them. `id` is the
  Shopping item id: send it to `/api/shopping-items/mark-cart` or `DELETE /api/shopping-items/:itemId`.
- `cart`: the caller's own active Cart, or `null`. Reading the list does not renew the lease.

  ```json
  {
    "sessionId": "<checkout_session_uuid>",
    "leaseExpiresAt": "<ISO 8601 datetime>",
    "lines": [
      { "id": "<ingredient_uuid>:g", "name": "Tomate", "unit": "g", "quantityMilli": 700 },
      { "id": "<manual_item_uuid>", "name": "Detergente", "unit": "unit", "quantityMilli": 1000 }
    ]
  }
  ```

  - `lines`: the lines of that Cart exactly as a confirm takes them (7.4), `[]` for a Cart that holds
    nothing. Show these in a confirm screen, not the `in_cart` lines of `planned`.
    - `id`: the `itemId` to send in the `lines` of a confirm: `<ingredientId>:<unit>` for the planned items
      of an ingredient, the Shopping item id for a manual item.
    - `name`: the name of the Ingredient for a planned line, the name of the item for a manual one, as
      `planned` and `manual` give them.
    - `quantityMilli`: the total of the line across every Shopping item the Cart holds of it. This is the
      suggested quantity, the one the line is bought at when the confirm does not list it.
    - `untilDate` and `groupBy` do not change `lines`: an item marked for a meal after `untilDate` is not in
      `planned`, and it is still part of its line here and still bought by a confirm. A line can therefore
      total more than the read shows of it, or not be in `planned` at all.
    - Only the caller's Cart is listed. The `in_cart` allocations of `planned` also include the ones another
      member holds, which are in no `lines` of the caller.
- `totals`: `needed`, `inCart` and `removed` count the lines of `planned` by status;
  `estimatedCents` adds the estimated price of the needed items. Manual items are not counted, and neither are
  `purchased` lines: the totals are what is still to buy.
- `plannedDates`: every date from today on with an uncooked Scheduled meal, sorted. `untilDate` does not
  change it.

Validation errors use the error envelope of section 10, with status `422` and code `validation_error`. The
envelope does not say which param was rejected. It is returned when:

- `untilDate` is not a `YYYY-MM-DD` date, or it is before the Account's today;
- `groupBy` is neither `ingredient` nor `meal`.

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is not valid."
  }
}
```

Purchased items:

- A planned item bought in a checkout (7.4) stays in `planned` with status `purchased` until its Scheduled
  meal is cooked or falls outside the range of the read (`untilDate`); after that it is no longer returned.
  The items of an online purchase read `purchased` from the confirm on, before their delivery.
- A line bought in part keeps one allocation per part: for the same Scheduled meal, a `purchased` allocation
  with the quantity bought and a `needed` one with the remainder, each with its own `itemId`. The line reads
  `needed` with the remainder as its `quantityMilli`.
- A purchased item is never to buy again. Sending its `itemId` to `/api/shopping-items/mark-cart` is refused
  and the whole call fails, so send only the `needed` allocations; `/api/shopping-items/set-status` answers
  `shopping_item_not_found` for it. A later read does not add its Shortage again.
- Purchased manual items leave the list, with or without an ingredient.

Important inventory-reservation behavior:

- Shopping generation uses only currently **available** inventory.
- Needed quantity is computed as: `missing = planned_needed - currently_available` per ingredient/unit.
- If inventory already covers the requirement, no shopping row is created for that ingredient.

### 7.2 Mark ingredient as in-cart / pending

- Method: `POST`
- Path: `/api/shopping-items/mark-cart`

Request body:

```json
{
  "ingredient_id": "<ingredient_uuid>",
  "in_cart": true,
  "start_date": "2026-03-30",
  "end_date": "2026-04-05"
}
```

Success response (`in_cart: true`):

```json
{
  "data": {
    "sessionId": "<cart_session_uuid>",
    "leaseExpiresAt": "<ISO 8601 datetime>",
    "items": [{ "itemId": "<item_uuid>", "reservationToken": "<token>", "quantityMilli": 1500 }]
  }
}
```

Cart lease (one hour from the last activity):

- Renew: `POST /api/cart/:sessionId/activity` returns `{ "data": { "sessionId", "leaseExpiresAt" } }`.
  Clients renew at most once a minute while the shopping screen is active.
- Cancel: `DELETE /api/cart/:sessionId` returns `{ "data": { "sessionId", "updatedRows", "status": "abandoned" } }`.
- An expired lease reads back as `cart: null` on `GET /api/shopping-list`.
- Marking and renewing do not answer `lines`: only the `cart` of the read (7.1) carries them.

Errors (`{ "error": { "code", "message" } }`):

- `cart_locked` (409): the items are held in another Membership's live Cart.
- `stale_cart` (409): the lease ran out; drop the local Cart and reread the list.
- `cart_not_found` (404): the Cart belongs to another Membership or does not exist.

### 7.3 Assign supermarket

- Method: `POST`
- Path: `/api/shopping-items/assign-supermarket`

Request body:

```json
{
  "ingredient_id": "<ingredient_uuid>",
  "supermarket_id": "<supermarket_uuid>",
  "start_date": "2026-03-30",
  "end_date": "2026-04-05"
}
```

### 7.4 Confirm checkout

- Method: `POST`
- Path: `/api/checkout/confirm`

Confirms the caller's Cart as purchased. This route is in the mobile casing scope: keys are camelCase in the
response, and the body is read in camelCase or snake_case.

Request body:

```json
{
  "sessionId": "<cart_session_uuid>",
  "checkoutType": "physical",
  "lines": [
    { "itemId": "<ingredient_uuid>:g", "quantityMilli": 1200, "totalCents": 600 },
    { "itemId": "<manual_item_uuid>", "quantityMilli": 1000 }
  ]
}
```

- `sessionId`: required, the `sessionId` of the Cart (7.1, 7.2).
- `checkoutType`: required, `physical` or `online`.
  - `physical`: what was bought enters Inventory now and the session is `completed`.
  - `online`: nothing enters Inventory yet. The session and its purchased items are `pending_delivery` until
    the delivery is acknowledged (7.5).
- `lines`: optional, what was actually bought, one entry per line of the Cart at most. A line of the Cart
  that is not listed is bought at its suggested quantity, the `quantityMilli` of its `cart.lines` entry, with
  no price; without `lines` every line is.
  - `itemId`: the `id` of the line as the `cart.lines` of `GET /api/shopping-list` give it (7.1):
    `<ingredientId>:<unit>` for the planned items of an ingredient, the Shopping item id for a manual item.
    It is not the `itemId` of an allocation.
  - `quantityMilli`: required, an integer, `0` or more. `0` puts the line back on the list as `needed` and
    buys nothing. A quantity above the suggested one stocks exactly what was bought.
  - `totalCents`: optional, an integer, `0` or more: what the line cost. It must be `0` or absent when
    `quantityMilli` is `0`.

How a bought quantity is applied:

- The quantity of an ingredient line covers its allocations nearest first (by date, then by slot). An
  allocation is covered in full before the next one gets anything. The first one that is not fully covered is
  purchased for the part it got, and its remainder goes back on the list as a new `needed` item for the same
  Scheduled meal. Allocations that get nothing leave the Cart and stay `needed`.
- Each purchased item becomes one Inventory lot with a `purchase` movement: `planned` for the item of a
  Scheduled meal, `extra` for a manual item with an ingredient. A manual item without an ingredient is marked
  as bought and stocks nothing.
- `totalCents` is shared by the lots of its line in proportion to their quantity.

Success response (`200`):

```json
{
  "data": {
    "checkoutSessionId": "<cart_session_uuid>",
    "status": "completed",
    "checkoutType": "physical",
    "movedToInventoryCount": 3,
    "checkedOutItemsCount": 3,
    "actualTotalCents": 600
  }
}
```

- `status`: `completed` for a physical purchase, `pending_delivery` for an online one.
- `movedToInventoryCount`: the number of lots created. A manual item without an ingredient creates none.
- `checkedOutItemsCount`: the number of Shopping items bought (a quantity above `0`), manual items without an
  ingredient included. Both are `0` for an online purchase until it is delivered.
- `actualTotalCents`: the sum of the `totalCents` sent.

The confirm is idempotent: confirming a session that is already `completed` or `pending_delivery` changes
nothing and answers `200` with the result stored for it, whatever the body carries this time. A client can
retry a confirm that timed out with the same `sessionId` and never doubles the stock. After a delivery (7.5)
the stored result is the completed one.

Purchased planned items stay on the list as `purchased` (7.1).

Errors use the error envelope of section 10. Nothing is changed by a refused confirm, except that an expired
Cart is released.

| Status | Code                         | When                                                                                                                                                                                                        |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `422`  | `validation_error`           | No `sessionId`, an empty Cart, or malformed `lines`: not a list, an unknown or repeated `itemId`, a `quantityMilli` or `totalCents` that is not an integer of `0` or more, or a price for a quantity of `0` |
| `422`  | `checkout_invalid_type`      | `checkoutType` is missing or is neither `physical` nor `online`                                                                                                                                             |
| `404`  | `checkout_session_not_found` | The session is unknown, not a UUID, of another Account, or one another member already closed                                                                                                                |
| `409`  | `cart_locked`                | The session is the live Cart of another member of the Account                                                                                                                                               |
| `409`  | `cart_expired`               | The Cart's lease ran out, or the Cart was cancelled. Reread the list and start a new Cart                                                                                                                   |

### 7.5 Confirm online delivery arrived

- Method: `POST`
- Path: `/api/checkout/sessions/:checkoutSessionId/delivered`
- Body: none.

Acknowledges that an online purchase (7.4) was delivered. For a session that is `pending_delivery` it creates
the Inventory lots of what was bought, acquired at the delivery, marks its items as bought and completes the
session. Any member of the Account may call it, not only the one who confirmed the purchase.

Success response (`200`):

```json
{
  "data": {
    "checkoutSessionId": "<cart_session_uuid>",
    "status": "completed",
    "checkoutType": "online",
    "movedToInventoryCount": 3,
    "checkedOutItemsCount": 3,
    "actualTotalCents": 600
  }
}
```

The fields are the ones of the confirm response (7.4), now with the lots that were created and the items that
were bought.

The call is idempotent: on a session that is already `completed` it creates nothing and answers `200` with
the same body. That includes a physical purchase, which answers the result of its confirm.

What was bought arrives even if the plan changed while the purchase was on its way: the lots are created for
the quantities confirmed, whether or not their Scheduled meals are still planned.

Errors use the error envelope of section 10:

| Status | Code                         | When                                                                                                                |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `404`  | `checkout_session_not_found` | The session is unknown, not a UUID, of another Account, or was never confirmed (a Cart, live, expired or cancelled) |

### 7.6 Add a manual item

- Method: `POST`
- Path: `/api/shopping-items/manual`

Request body:

```json
{
  "name": "Dish soap",
  "ingredientId": "<ingredient_uuid>",
  "quantityMilli": 1000,
  "unit": "unit"
}
```

- `name`: required, a string of 1 to 200 Unicode codepoints once trimmed, with no NUL character.
- `ingredientId`: optional, an ingredient of the catalogue.
- `quantityMilli`: optional, an integer above zero and at most `2147483647`, in thousandths of the unit.
  `1000` when omitted.
- `unit`: optional, one of `g`, `ml`, `unit`. `unit` when omitted, so the default is 1 unit.

Success response (`201`): the line of the new item, as it appears in `manual` (7.1).

```json
{
  "data": {
    "id": "<shopping_item_uuid>",
    "ingredientId": null,
    "name": "Dish soap",
    "category": "otros",
    "quantityMilli": 1000,
    "unit": "unit",
    "status": "needed",
    "source": "manual",
    "supermarketId": null,
    "allocations": []
  }
}
```

A manual item belongs to the Account and is for no Scheduled meal or date, so a re-plan (a confirmed plan or a
calendar range replace) never touches it. Errors use the error envelope of section 10: `422 validation_error`
for a field that is missing or malformed, or an `ingredientId` that is not in the catalogue.

### 7.7 Delete a manual item

- Method: `DELETE`
- Path: `/api/shopping-items/:itemId`

Success response (`200`): `{ "data": { "id": "<shopping_item_uuid>" } }`.

Only an item added by hand (7.6) that is still on the list (`needed` or `in_cart`) can be deleted. The check
and the delete are one write: a delete that races a purchase of the same item, or a second delete of it,
answers `404`. Errors use the error envelope of section 10:

| Status | Code                       | When                                                                                         |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| `422`  | `shopping_item_not_manual` | The item is a planned one. Planned items are removed, not deleted (7.8)                       |
| `404`  | `shopping_item_not_found`  | `:itemId` is unknown, of another Account, not a UUID, or of an item already bought or closed |

### 7.8 Remove or restore a planned item

- Method: `POST`
- Path: `/api/shopping-items/set-status`

Request body:

```json
{
  "itemIds": ["<shopping_item_uuid>", "<shopping_item_uuid>"],
  "status": "removed"
}
```

- `itemIds`: required, a non-empty list of Shopping item ids without repeats. These are the `itemId` of the
  `allocations` of a `planned` line (7.1). A single `itemId` string is read in place of the list.
- `status`: required, `removed` (the User will not buy it) or `needed` (restore it).

Success response (`200`):

```json
{
  "data": {
    "status": "removed",
    "itemIds": ["<shopping_item_uuid>", "<shopping_item_uuid>"],
    "updatedRows": 2
  }
}
```

`updatedRows` counts the items whose status changed: setting the status an item already has succeeds and
changes nothing. The call is all or nothing; if one item is refused none changes.

A removed item stays in `planned` (7.1) so it can be restored: it stops adding to the `quantityMilli` of its
line, to `estimatedCents` and to the Cart, and a line whose allocations are all removed reads `removed`. A
re-plan (a confirmed plan or `PUT /api/calendar/meals/range`) keeps it removed while a planned meal on the
same date and slot still needs that ingredient and unit, with the shortage of the new plan, and drops it when
none does. Changing the recipe of a single slot starts that meal over, so its removals are dropped too, and
finishing the cooking of a meal takes its open items off the list, removed ones included: their ids answer
`404` afterwards. Manual items are never touched by a re-plan.

Errors use the error envelope of section 10:

| Status | Code                        | When                                                                                  |
| ------ | --------------------------- | ------------------------------------------------------------------------------------- |
| `422`  | `validation_error`          | `status` is missing or is not `removed` or `needed`, or `itemIds` is empty or repeats |
| `404`  | `shopping_item_not_found`   | An id is unknown, of another Account, not a UUID, or of an item already bought        |
| `422`  | `shopping_item_not_planned` | An id is a manual item. Manual items are deleted (7.7), not removed                   |
| `409`  | `shopping_item_in_cart`     | Removing an item that is in a Cart. Take it out of the Cart first                     |

## 8. WebSocket Integration (`planning_channel`)

## 8.1 Connect socket

Use the access token of the current session (section 2):

```ts
import { Socket } from "phoenix";

const socket = new Socket("ws://localhost:4000/socket/websocket", {
  params: { token: accessToken }
});

socket.connect();
```

If token is invalid or missing, socket connect is rejected.

## 8.2 Join topic

Topic format:

- `planning:<account_id>`

Example:

```ts
const channel = socket.channel(`planning:${accountId}`, {});

channel
  .join()
  .receive("ok", () => console.log("joined"))
  .receive("error", (err) => console.log("join error", err));
```

Join authorization rule:

- User can only join topic where `account_id` equals token user account.
- Forbidden join error payload:

```json
{
  "reason": "forbidden"
}
```

## 8.3 Outgoing events from backend

Event and reply payloads have camelCase keys at any depth; event names and values are not rewritten. Inbound snake_case keys are still accepted on commands, next to camelCase.

### `generation_started`

Emitted when generation begins.

Payload:

```json
{
  "requestId": "req_123",
  "runId": "...",
  "sessionId": "..."
}
```

### `proposal_ready`

Emitted when the generation finished a proposal: day-by-day cards with the estimated cost, followed by a `planning_message`. The frozen shape is in `docs/CHANNELS.md` (Planner events).

### `generation_error`

Emitted on generation failure.

Payload:

```json
{
  "requestId": "req_123",
  "reason": "invalid_date_range"
}
```

The event keeps its `reason` field. The error reply to the command that failed is the error envelope instead, next to `requestId`:

```json
{
  "requestId": "req_123",
  "error": {
    "code": "invalid_date_range",
    "message": "<human text>"
  }
}
```

### `proposal_confirmed`

Broadcast when proposal is confirmed.

Payload:

```json
{
  "proposalId": "...",
  "generationRunId": "...",
  "scheduledMealsCount": 14,
  "status": "confirmed"
}
```

### `proposal_rejected`

Broadcast when proposal is rejected by `POST /api/planning/proposals/:proposal_id/reject`.

Payload:

```json
{
  "proposalId": "..."
}
```

## 8.4 Incoming events from client

The topic accepts the session commands only (issue #15): `start_planning`, `send_message` and `cancel_planning`. Their payloads and replies are in `docs/CHANNELS.md` (Incoming Events). Confirm and reject are HTTP requests: `POST /api/planning/confirm` and `POST /api/planning/proposals/:proposal_id/reject`.

The older commands `generate_menu`, `swap_constraints`, `chat`, `confirm_proposal` and `reject_proposal` were retired. Like any unsupported event name, they reply the error envelope with code `invalid_payload`:

```json
{
  "error": {
    "code": "invalid_payload",
    "message": "The request payload is not valid."
  }
}
```

## 9. Recommended React Native Integration Sequence

1. Request and verify an email code (section 2) and persist `accessToken` and `refreshToken` securely.
2. Configure HTTP client with `Authorization: Bearer <token>`.
3. Load `/api/account/context` for budget, inventory names, and plan limits.
4. Open socket with token and join `planning:<account_id>`.
5. Send `start_planning` over the channel, then `send_message` intents for iterative UX.
6. Confirm the proposal with `POST /api/planning/confirm` or reject it with `POST /api/planning/proposals/:proposal_id/reject`.
7. Show shopping view from `/api/shopping-list` and manage cart/checkout flows.
8. Update inventory using add/update/dispose/voice endpoints.

## 10. Error Handling Conventions

Two error body shapes are in use. Which one a request gets depends on the code path that rejects it.

- **Envelope (spec [#1](https://github.com/ChordanDev/myfood-monorepo/issues/1)):**
  `{ "error": { "code": "<code>", "message": "<human text>" } }`, with the HTTP status derived from the code.
  It is returned by:
  - the auth pipeline in front of every protected REST route: `401 unauthenticated` (missing or invalid
    token, or a token of the wrong type), `401 access_token_expired`, and `401 account_not_found` (the
    session has no active Membership);
  - the capability guard in front of the capability-gated routes, when access enforcement is enabled:
    `403 trial_expired`;
  - the mobile auth routes `/api/auth/login/request-code`, `/api/auth/login/verify-code`,
    `/api/auth/signup/request-code`, `/api/auth/signup/verify-code` and `/api/auth/refresh`;
  - `GET /api/me` and its alias `GET /api/auth/me`;
  - `PUT /api/me/profile`: `422 validation_error` and `422 invalid_cooking_skill`;
  - `PUT /api/account/timezone`: `422 validation_error` (see 3.6);
  - `GET` and `PUT /api/me/slot-cooking-times`: `404 slot_cooking_times_not_found`, `422 validation_error`
    and `422 invalid_hunger_level` (see 3.4 and 3.5);
  - `GET /api/recipes/:id`: `404 recipe_not_found` and `403 forbidden` (section 11);
  - `GET /api/shopping-list`, for a rejected `untilDate` or `groupBy` (7.1): `422 validation_error`. Its
    other errors still use the flat shape below;
  - the inventory routes of section 6, for every error: `422 validation_error`,
    `404 inventory_item_not_found` (see 6.5);
  - `POST /api/shopping-items/manual`, `DELETE /api/shopping-items/:itemId` and
    `POST /api/shopping-items/set-status` (7.6 to 7.8): `422 validation_error`,
    `422 shopping_item_not_manual`, `422 shopping_item_not_planned`, `404 shopping_item_not_found`,
    `409 shopping_item_in_cart`;
  - `POST /api/checkout/confirm` and `POST /api/checkout/sessions/:checkoutSessionId/delivered` (7.4 and
    7.5), for every error: `422 validation_error`, `422 checkout_invalid_type`,
    `404 checkout_session_not_found`, `409 cart_locked`, `409 cart_expired`.
- **Flat (legacy, not migrated to the envelope):** `{ "error": "<reason>" }`, with the status chosen by each
  endpoint (`422` in most controllers). It is still returned by:
  - the validation and domain errors that the non-auth controllers build themselves: account context,
    dietary profile, planning, planning chat, calendar, cooking, shopping, memberships, invites,
    account leave and billing;
  - `/api/auth/switch-account`, for the errors its own controller builds;
  - the account scope check on `/api/accounts/:account_id/*`: `403` with `{ "error": "account_mismatch" }`.
- Planning weekly has explicit `400` for known request-shape/limits errors (including `exceeds_max_planning_days`).
- Channel generation errors are emitted and replied with `reason` as string.

## 11. Recipe Detail (REST)

- Method: `GET`
- Path: `/api/recipes/:id`

Returns the frozen version of a recipe the Account can see: a catalog recipe or one of its own (`source` is
`traditional`, `ai_generated` or `user_created`). Every source answers the same shape, with camelCase keys.

```json
{
  "data": {
    "id": "5b0c9d6e-2f4a-4c1b-9e3d-7a8f1c2b3d4e",
    "recipeVersionId": "0e7a4c52-9b1d-4f36-8a2c-6d5e4f3a2b1c",
    "successorRecipeId": null,
    "source": "traditional",
    "name": "Tortilla de papas",
    "description": "Tortilla clásica de papas y cebolla.",
    "servings": 4,
    "durationMinutes": 40,
    "ingredients": [
      {
        "ingredientId": "1c3e5a7b-9d2f-4b6c-8e1a-3f5d7b9c2e4a",
        "name": "Papa",
        "category": "verduras",
        "quantityMilli": 500000,
        "unit": "g"
      }
    ],
    "steps": [{ "order": 1, "text": "Pelar las papas y cortarlas en láminas finas.", "durationMinutes": 15 }],
    "estimatedCostCents": 385000,
    "tags": [],
    "imageUrl": null,
    "theme": {
      "colorBlack": "#0D1007", "colorDark": "#15180F", "colorMedium": "#364025", "colorLight": "#8D9373",
      "primaryAccent": "#EF9432", "appBg": "#BCBFA7", "icon": "#D8D98B", "textBlack": "#0D1007",
      "textDark": "#1B210E", "textMedium": "#D8D98B", "textLight": "#F5F3D4",
      "primaryAccentIntense": "#FF8400", "alert": "#C94F3D"
    }
  }
}
```

Fields:

- `recipeVersionId`: id of the immutable version served. A recipe id always answers the same version, so a
  client can cache the body by this id.
- `successorRecipeId`: id of the recipe that corrects this one, or `null`. It is not version content: it is
  read when the request is served, like `ingredients[].category`, so a cached body does not learn that the
  recipe was corrected afterwards.
- `servings`: servings the quantities are for, or `null`. Quantities are not scaled.
- `durationMinutes`: preparation plus cooking time in minutes; `null` when the recipe has neither.
- `ingredients[].quantityMilli`: quantity in thousandths of `unit` (`g`, `ml` or `unit`): `500000` with `g`
  is 500 g. Formatting is up to the client.
- `ingredients[].category`: current category of the ingredient (`lacteos`, `frutas`, `verduras`, `carnes`,
  `granos`, `congelados`, `no_perecederos`, `otros`), or `null` when the ingredient no longer exists. It is
  read at request time, not frozen with the version.
- `steps[]`: ordered by `order`. `steps[].durationMinutes` is in minutes, or `null`.
- `estimatedCostCents`: estimated cost of the recipe in cents; `0` when no cost is known.
- `theme`: the palette the app takes while this recipe is in view, or `null` (the client then applies its
  default theme). Keys are camelCase: `colorBlack`, `colorDark`, `colorMedium`, `colorLight`, `primaryAccent`,
  `appBg`, `icon`, `textBlack`, `textDark`, `textMedium`, `textLight`, `primaryAccentIntense` and `alert`
  (hex strings), plus an optional `appBgGradient` of two hex strings. It is frozen with the version. A
  derived recipe (`ai_generated`, `user_created`) whose version has no theme serves the current theme of its
  base recipe, read when the request is served; with no base, or a base without a theme, it is `null`.
  Versions frozen before themes existed read as `null`.
- `tags` and `imageUrl` are placeholders: they answer `[]` and `null` until the backend stores them.

Errors use the envelope of section 10:

- `404 recipe_not_found`: the recipe does not exist, the id is not a UUID, or the recipe belongs to another
  Account.
- `403 forbidden`: the Account has no access (expired trial without a subscription). A User without an
  active Membership is stopped earlier, by the auth pipeline, with `401 account_not_found`.

`apps/mobile/src/features/recipe/fixtures/recipeDetail.json` is a full example body. A route test keeps its
keys equal to the ones this route answers.

## 12. Calendar (REST)

### 12.1 Move a Scheduled meal

- Method: `POST`
- Path: `/api/calendar/meals/:mealId/move`

Request body:

```json
{
  "date": "2026-10-11",
  "slot": "lunch"
}
```

- `mealId`: the `mealId` of a meal of `GET /api/calendar`.
- `date`: required, the destination day as `YYYY-MM-DD`.
- `slot`: required, `breakfast`, `lunch`, `snack` or `dinner`.

Success response (`200`):

```json
{
  "data": {
    "moved": { "mealId": "<scheduled_meal_uuid>", "date": "2026-10-11", "slot": "lunch" },
    "displaced": { "mealId": "<scheduled_meal_uuid>", "date": "2026-10-12", "slot": "dinner" }
  }
}
```

The meal goes to `date` and `slot`. A meal already there takes the position the moved one leaves and comes
back as `displaced`; for an empty destination `displaced` is `null`. The server finds the meal at the
destination itself, so a client does not send what its cache holds for that slot. The call is all or nothing.

Both meals keep their `mealId`, and what hangs from them goes with them: their Cooking sessions, the Slot
favorites of both positions, and their planned Shopping items, which now read the meal's new date in every
state (in a Cart, removed, bought). The exception is an archived item, one a past day left unbought: when its
meal lands on the Account's today or later the item is deleted, and the next Shopping list read derives an
open one again. A move to another slot of the same day touches no Shopping item. Use this route to move a
meal; `PUT /api/calendar/meals/range` deletes the meals of its range and creates new ones, and is meant for
replacing a plan.

Errors use the envelope of section 10:

| Status | Code                         | When                                                                                                                                             |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `404`  | `scheduled_meal_not_found`   | The id is unknown, of another Account or not a UUID                                                                                              |
| `422`  | `validation_error`           | `date` or `slot` is missing or not valid, or is the position the meal already has                                                                |
| `409`  | `scheduled_meal_cooked`      | The meal, or the meal at the destination, is cooked. A cooked meal stays on its day                                                              |
| `409`  | `calendar_conflict`          | Another write took the destination meanwhile. Read the calendar again and retry                                                                  |
| `409`  | `calendar_move_not_possible` | The stored Shopping items of a meal cannot follow it to its new date. A retry fails the same way; show the message and keep the meal where it is |

Nothing is saved on any error.
