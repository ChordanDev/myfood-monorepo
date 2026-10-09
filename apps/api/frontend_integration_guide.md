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
- `502 code_send_failed`: the email could not be sent; the request can be retried at once

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

A refresh token works once. A second request that sends the same token gets `401 refresh_token_replayed`
and the sessions of that device are revoked. The client must serialize the refresh: one call in flight,
shared by every request that found the access token expired.

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

Success response (`200`):

```json
{
  "data": {
    "account_type": "individual",
    "subscription_tier": "free",
    "days": [
      {
        "day": "monday",
        "meals": [
          {
            "slot": "breakfast",
            "recipe_id": "...",
            "label": "...",
            "estimated_cost_cents": 1200
          }
        ]
      }
    ],
    "notes": ["..."],
    "budget": {
      "account_id": "...",
      "weekly_limit_cents": 60000,
      "currency": "ARS"
    },
    "budget_within_limit": true,
    "estimated_total_cost_cents": 21500,
    "inventory_items": ["..."],
    "max_planning_days": 7
  }
}
```

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
| `422`  | `validation_error`         | Missing, unknown or malformed ingredient; missing, zero, negative or non-integer quantity; missing or unknown unit; malformed `expiresAt`; `notes` that is not a string or is longer than 1000 characters; `isLeftover` that is not a boolean; a voice payload without `text` or `operations`; a rescue request without ingredients |
| `404`  | `inventory_item_not_found` | `:item_id` is not a lot of the Account: unknown, owned by another Account, or not a UUID          |
| `404`  | `not_found`                | No recipe is available for a rescue plan                                                          |
| `500`  | `unknown_error`            | Unexpected failure                                                                                |

The envelope does not name the field that failed.

### 6.6 Voice flows

- Preview parse:
  - `POST /api/inventory/voice/preview`
- Apply operations:
  - `POST /api/inventory/voice/apply`

Preview request:

```json
{
  "text": "Use medio tomate y la mitad del kilo de pollo"
}
```

Apply request:

```json
{
  "raw_text": "Use medio tomate",
  "operations": [
    {
      "inventory_item_id": "...",
      "quantity_milli": 200
    }
  ]
}
```

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
            "quantityMilli": 400
          },
          {
            "itemId": "<shopping_item_uuid>",
            "scheduledMealId": "<scheduled_meal_uuid>",
            "date": "2026-10-10",
            "slot": "dinner",
            "quantityMilli": 400
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
  - `status`: `needed`, `in_cart` or `removed`. An ingredient line reads `in_cart` only when every
    allocation is in a Cart, whoever holds it; otherwise it reads `needed`. A line reads `removed` only when
    every allocation was removed; its quantity then adds up all of them, so it can be restored.
  - `source`: always `planned_meal`.
  - `supermarketId`: the supermarket every allocation is assigned to, or `null` when there is none or they
    differ.
  - `allocations`: the share of the line each Scheduled meal needs. `itemId` is the Shopping item to send to
    `/api/shopping-items/mark-cart`. With `groupBy=meal` a line has exactly one allocation.
- `manual`: the Shopping items the User added by hand (7.6) that are still on the list, oldest first. Each
  one has the keys of a `planned` line, with `source` `manual`, `allocations` `[]`, `ingredientId` `null`
  when no ingredient was given and `category` `otros` in that case. They are never merged with each other or
  with a planned line, `untilDate` does not limit them and `groupBy` does not change them. `id` is the
  Shopping item id: send it to `/api/shopping-items/mark-cart` or `DELETE /api/shopping-items/:itemId`.
- `cart`: the caller's own active Cart, `{ "sessionId": "...", "leaseExpiresAt": "<ISO 8601 datetime>" }`, or
  `null`. Reading the list does not renew the lease.
- `totals`: `needed`, `inCart` and `removed` count the lines of `planned` by status;
  `estimatedCents` adds the estimated price of the needed items. Manual items are not counted.
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

Request body:

```json
{
  "checkout_type": "physical",
  "start_date": "2026-03-30",
  "end_date": "2026-04-05"
}
```

`checkout_type` values:

- `physical`: immediately moves quantities to inventory and marks rows checked out.
- `online`: marks rows `pending_delivery` (inventory is updated only on delivery confirmation).

Success response:

```json
{
  "data": {
    "checkout_session_id": "...",
    "status": "completed",
    "checkout_type": "physical",
    "moved_to_inventory_count": 4,
    "checked_out_items_count": 4,
    "grouped_by_supermarket": {
      "unassigned": {
        "item_count": 4,
        "total_cents": 12000,
        "item_ids": ["..."]
      }
    }
  }
}
```

### 7.5 Confirm online delivery arrived

- Method: `POST`
- Path: `/api/checkout/sessions/:checkout_session_id/delivered`

Success response:

```json
{
  "data": {
    "checkout_session_id": "...",
    "status": "completed",
    "moved_to_inventory_count": 4,
    "checked_out_items_count": 4
  }
}
```

Shopping errors are returned as `422` with:

```json
{
  "error": "<reason>"
}
```

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

- `name`: required, a string of 1 to 200 characters once trimmed.
- `ingredientId`: optional, an ingredient of the catalogue.
- `quantityMilli`: optional, an integer above zero, in thousandths of the unit. `1000` when omitted.
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

Only an item added by hand (7.6) that is still on the list (`needed` or `in_cart`) can be deleted. Errors use
the error envelope of section 10:

| Status | Code                       | When                                                                                         |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| `422`  | `shopping_item_not_manual` | The item is a planned one. Planned items are removed, not deleted                           |
| `404`  | `shopping_item_not_found`  | `:itemId` is unknown, of another Account, not a UUID, or of an item already bought or closed |

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

Payload examples:

```json
{
  "requestId": "req_123"
}
```

or for constraints swap:

```json
{
  "requestId": "req_123",
  "reason": "constraint_update"
}
```

### `proposal_ready`

Emitted when proposal is generated/regenerated.

Payload:

```json
{
  "requestId": "req_123",
  "runId": "...",
  "proposalId": "...",
  "dateFrom": "2026-03-30",
  "dateTo": "2026-04-05",
  "proposal": {
    "summary": "...",
    "scheduledMeals": [],
    "weeklyPlan": {},
    "shoppingHints": []
  },
  "appliedConstraints": {
    "kcalTarget": 2200,
    "weeklyBudgetCents": 50000,
    "currency": "ARS",
    "days": ["monday", "tuesday"]
  }
}
```

Note:

- `appliedConstraints` is present on `swap_constraints` flow.

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

Broadcast when proposal is rejected.

Payload:

```json
{
  "proposalId": "...",
  "generationRunId": "...",
  "status": "rejected"
}
```

## 8.4 Incoming events from client

### `generate_menu`

Payload accepted by channel:

```json
{
  "request_id": "req-client-1",
  "message": "Quiero menus baratos",
  "content_type": "text",
  "date_from": "2026-03-30",
  "date_to": "2026-04-05",
  "kcal_target": 2100,
  "weekly_budget_cents": 45000,
  "currency": "ARS",
  "days": ["monday", "tuesday", "wednesday"]
}
```

Channel reply:

- `{:ok, event}` with same payload shape as `proposal_ready`, or
- `{:error, %{request_id, reason}}`

If `request_id` is omitted, backend auto-generates one (`req_<number>`).

### `swap_constraints`

Payload:

```json
{
  "request_id": "req-client-2",
  "base_payload": {
    "message": "Mantener idea base",
    "content_type": "text",
    "date_from": "2026-03-30",
    "date_to": "2026-04-05",
    "kcal_target": 2100,
    "weekly_budget_cents": 45000,
    "currency": "ARS",
    "days": ["monday", "tuesday"]
  },
  "constraints": {
    "kcal_target": 2300,
    "weekly_budget_cents": 50000,
    "days": ["monday", "tuesday", "wednesday"]
  }
}
```

Behavior:

- Backend merges `constraints` into the base payload.
- Returns and broadcasts `proposal_ready` including `applied_constraints`.

### `confirm_proposal`

Payload:

```json
{
  "proposal_id": "<proposal_uuid>"
}
```

### `reject_proposal`

Payload:

```json
{
  "proposal_id": "<proposal_uuid>"
}
```

### Unknown events

For unsupported event name, channel reply error is:

```json
{
  "reason": "invalid_payload"
}
```

## 9. Recommended React Native Integration Sequence

1. Request and verify an email code (section 2) and persist `accessToken` and `refreshToken` securely.
2. Configure HTTP client with `Authorization: Bearer <token>`.
3. Load `/api/account/context` for budget, inventory names, and plan limits.
4. Open socket with token and join `planning:<account_id>`.
5. Use `generate_menu` and optionally `swap_constraints` over channel for iterative UX.
6. Confirm proposal via channel (`confirm_proposal`) or REST (`/api/planning/proposals/:proposal_id/confirm`).
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
  - `GET` and `PUT /api/me/slot-cooking-times`: `404 slot_cooking_times_not_found`, `422 validation_error`
    and `422 invalid_hunger_level` (see 3.4 and 3.5);
  - `GET /api/recipes/:id`: `404 recipe_not_found` and `403 forbidden` (section 11);
  - `GET /api/shopping-list`, for a rejected `untilDate` or `groupBy` (7.1): `422 validation_error`. Its
    other errors still use the flat shape below;
  - the inventory routes of section 6, for every error: `422 validation_error`,
    `404 inventory_item_not_found` (see 6.5);
  - `POST /api/shopping-items/manual` and `DELETE /api/shopping-items/:itemId` (7.6 and 7.7):
    `422 validation_error`, `422 shopping_item_not_manual`, `404 shopping_item_not_found`.
- **Flat (legacy, not migrated to the envelope):** `{ "error": "<reason>" }`, with the status chosen by each
  endpoint (`422` in most controllers). It is still returned by:
  - the validation and domain errors that the non-auth controllers build themselves: account context,
    dietary profile, planning, planning chat, calendar, cooking, shopping, memberships, invites,
    account leave and billing;
  - `/api/auth/switch-account`, for the errors its own controller or plug builds;
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
    "theme": null
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
- `tags`, `imageUrl` and `theme` are placeholders: they answer `[]`, `null` and `null` until the backend
  stores them.

Errors use the envelope of section 10:

- `404 recipe_not_found`: the recipe does not exist, the id is not a UUID, or the recipe belongs to another
  Account.
- `403 forbidden`: the Account has no access (expired trial without a subscription). A User without an
  active Membership is stopped earlier, by the auth pipeline, with `401 account_not_found`.

`apps/mobile/src/features/recipe/fixtures/recipeDetail.json` is a full example body. A route test keeps its
keys equal to the ones this route answers.
