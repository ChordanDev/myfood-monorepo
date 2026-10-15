# Phoenix Channels Reference

This document provides a complete reference for all Phoenix Channels used in the Meal Planner API real-time communication layer.

## Overview

The application uses Phoenix Channels for real-time bidirectional communication between the Elixir backend and JavaScript frontend clients. All channels are accessed through a single authenticated `UserSocket` connection.

## Connection

```javascript
import { Socket } from "phoenix";

const socket = new Socket("/socket", {
  params: { token: "<jwt-token>" }
});

socket.connect();
```

## Channel Reference

### ai_chat:* — AI Meal Planning Assistant

Conversational AI assistant for meal planning queries.

**Topic Pattern:** `ai_chat:<session_id>`

#### Incoming Events

| Event | Payload | Description |
|-------|---------|-------------|
| `new_message` | `{"content": "string", "context": {...}}` | Send a message to the AI assistant |
| `regenerate` | `{"message_id": "uuid", "options": {...}}` | Request regeneration of an AI response |
| `end_session` | `{}` | End the AI chat session and cleanup |

**Example Payload (new_message):**
```json
{
  "content": "What can I make with chicken and rice?",
  "context": {
    "dietary_restrictions": ["gluten-free"],
    "servings": 4
  }
}
```

#### Outgoing Events

| Event | Payload | Description |
|-------|---------|-------------|
| `new_message` | `{"id": "uuid", "content": "string", "role": "assistant", "timestamp": "ISO8601"}` | AI response |
| `typing` | `{"is_typing": true}` | Indicator that AI is processing |
| `error` | `{"code": "string", "message": "string"}` | Error occurred |
| `regeneration_started` | `{"message_id": "uuid"}` | Regeneration process initiated |
| `regeneration_complete` | `{"original_id": "uuid", "new_message": {...}}` | New message ready |

**Example Response (new_message):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "content": "Here are some options with chicken and rice...",
  "role": "assistant",
  "timestamp": "2026-06-07T10:30:00Z",
  "suggestions": [
    {"recipe_id": "123", "name": "Chicken Fried Rice", "match_score": 0.95}
  ]
}
```

---

### calendar:* — Calendar Operations

Real-time calendar updates for meal planning.

**Topic Pattern:** `calendar:<account_id>`

#### Incoming Events

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{"date_range": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}}` | Subscribe to calendar updates in date range |
| `unsubscribe` | `{"date_range": {...}}` | Unsubscribe from date range updates |
| `refresh` | `{}` | Request full calendar refresh |

**Example Payload (subscribe):**
```json
{
  "date_range": {
    "start": "2026-06-01",
    "end": "2026-06-30"
  }
}
```

#### Outgoing Events

| Event | Payload | Description |
|-------|---------|-------------|
| `slot_updated` | `{"slot": {...}}` | A calendar slot was modified |
| `meal_assigned` | `{"slot": {...}, "recipe": {...}}` | Meal was assigned to a slot |
| `meal_removed` | `{"slot_id": "uuid"}` | Meal was removed from a slot |
| `batch_update` | `{"slots": [...]}` | Multiple slots updated at once |
| `sync_complete` | `{"synced_count": 30}` | Full sync finished |

**Example Response (slot_updated):**
```json
{
  "slot": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "date": "2026-06-10",
    "slot": "lunch",
    "is_cooked": false,
    "recipe": {
      "id": "789",
      "name": "Grilled Chicken Salad",
      "calories_per_serving": 350,
      "prep_time_minutes": 15
    },
    "is_favorite": true
  },
  "updated_by": "user"
}
```

---

### planning:* — Weekly Planning

Real-time meal planning workflow coordination.

**Topic Pattern:** `planning:<account_id>`

#### Join

A refused join replies the error envelope (see below) with one of three codes, checked in this order:

| Code | Condition |
|------|-----------|
| `unauthenticated` | The socket carries no identity, or its access token has expired since the socket connected |
| `forbidden` | No Membership resolves for the socket, the Membership belongs to another Account than the topic, or it is not active |
| `trial_expired` | Capability enforcement is on and the Account is not eligible. The HTTP API replies the same code for the same rule |

`unauthenticated` is the client's cue to refresh the access token and reconnect the socket with the new one; rejoining on the same connection is refused again. A token without an expiry claim is not treated as expired. The other two codes do not change with a retry.

#### Payload Casing and Error Replies

Payloads are camelCase in both directions:

- **Commands (client to server):** send camelCase keys at any depth, for example `rangeFrom`, `sessionId` or `constraints.budgetCents`. snake_case keys are still accepted (`range_from`); the tables below are written in camelCase. When a payload carries the same key in both spellings, the snake_case one is used.
- **Replies and events (server to client):** every ok reply, every error reply and every event pushed on the topic has camelCase keys at any depth, nested lists included.

Only keys are rewritten. Event names (`session_started`) and values stay as they are: ids, enum values and the `reason` of a `generation_error` event (`"invalid_date_range"`) are not changed. A key that is not a snake_case identifier is left untouched: a date, a UUID, or a name with a word that starts with a digit (`calories_per_100`).

A failed join or command replies the error envelope, never a free-text reason:

```json
{
  "error": {
    "code": "overlapping_range",
    "message": "The date range overlaps an active planning session."
  }
}
```

- `code` is always one of the codes of `MealPlannerApiWeb.ApiError` (`lib/meal_planner_api_web/controllers/api_error.ex`). A failure the server did not anticipate replies `unknown_error`. Clients branch on `code`; `message` is a human-readable description.
- `generate_menu` and `swap_constraints` correlate their reply: it carries `requestId` (the one the command sent, or a generated one) next to `error`.

**Example (start_planning, camelCase):**
```json
{ "rangeFrom": "2026-04-01", "rangeTo": "2026-04-07" }
```

Ok reply; the `session_started` event carries the same `sessionId`:
```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440002", "status": "active" }
```

#### Ordering

- An event the channel emits while it handles a command reaches the commanding client after the reply to that command. For example, `cancel_planning` replies first and `session_cancelled` follows on the same socket.
- An event emitted by another server process (generation, the planning session, the session sweeper, the AI chat channel) has no ordering guarantee relative to a reply. `session_started` is one of them: a client must not assume on which side of the `start_planning` reply it arrives.
- Clients correlate replies and events by `requestId` / `sessionId`, never by arrival order.

#### start_planning

The command that starts a Planning session and its first generation (issue #25).

| Param (camelCase) | Type | Description |
|-------------------|------|-------------|
| `rangeFrom` | `"YYYY-MM-DD"` | First day. Today or later; one day before today (UTC) is still accepted, because a member west of UTC sees a date that is yesterday in UTC |
| `rangeTo` | `"YYYY-MM-DD"` | Last day, inclusive. Optional when `dayCount` is sent |
| `dayCount` | integer | Number of days, 1 to 7. Optional when `rangeTo` is sent; when both are sent they must agree |
| `request` | string | Optional free text, at most 1000 characters after trimming. A blank text counts as none. It reaches the generation as the `request` constraint |
| `favoriteRecipeIds` | list of UUID strings | Optional. The Favorite recipes the member preselected for this plan; absent or `null` means none. Only the ids that are favorites of the caller (their own, in this Account) reach the engine: any other id is dropped, because a client cache can be stale. Duplicates collapse onto their first place and the client's order is kept. See [Planning context](#planning-context) |
| `requestId` | string | Optional. Correlates `generation_started`, and `generation_error` when that event carries it; generated when missing |

The command validates the range, checks the Account is eligible, starts the session (`session_started`), then starts the generation through the same call `generate_menu` uses and replies:

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440002", "status": "active" }
```

`generation_started` follows with the `runId`. When the generation cannot start the session is cancelled (`session_cancelled`), its process is stopped, and the command replies the error envelope with `requestId`, so the member can start again. A `generation_error` event is pushed too, except when the account already has a run in flight: that case replies `generation_in_progress` only, as `generate_menu` does, and the topic is not told of a failure. A start that does not get an answer from the generation server in time is handled as a failed start. `rangeTo` and `dayCount` sent as `null` count as absent. The range is capped at 7 days because the window of the generation server holds 7 days; a longer range is refused before any session starts.

Refusals reply the error envelope with these codes:

| Code | Condition |
|------|-----------|
| `planning_invalid_range` | A date is missing or is not an ISO 8601 date, the range ends before it starts, lasts more than 7 days, starts more than a day in the past, or `dayCount` is not an integer from 1 to 7 or disagrees with `rangeTo` |
| `planning_range_locked` | An active session of the Account already holds part of the range |
| `planning_slot_occupied` | A day of the range already has a Scheduled meal in a slot the session plans (breakfast, lunch or dinner). Refused before any session starts |
| `invalid_payload` | `request` is not a string or is longer than 1000 characters, or `favoriteRecipeIds` is not a list of strings. Both are refused before any session starts |
| `subscription_required` | The Account is not eligible |
| `generation_in_progress` | A generation of the Account is already running (the session is cancelled) |

`planning_range_locked` may carry `details` inside `error`, next to `code` and `message`: `{"ownerName": "Ana"}`, the display name of the member who holds the range. It is present only when that member is not the caller; a member who collides with their own session gets no `details`.

```json
{
  "error": {
    "code": "planning_range_locked",
    "message": "Another planning session holds part of this date range.",
    "details": { "ownerName": "Ana" }
  }
}
```

`planning_slot_occupied` carries `details` naming every date and slot pair that already holds a Scheduled meal, ordered by date (issue #28). The Planner never plans over a Scheduled meal; a snack, or a day outside the range, does not block the start.

```json
{
  "error": {
    "code": "planning_slot_occupied",
    "message": "A meal is already scheduled for one of the requested days and slots.",
    "details": { "occupied": [{ "date": "2026-06-10", "slot": "lunch" }] }
  }
}
```

The older `invalid_range` and `overlapping_range` codes stay in the allowlist; `start_planning` no longer replies them.

#### Confirm, reject and the session lease (HTTP)

Per ADR 0004 the app confirms and rejects a proposal over HTTP, and the topic carries the notification (issue #28). Every error answers the mobile error envelope.

| Route | Body | Answer |
|-------|------|--------|
| `POST /api/planning/confirm` | `{"proposalId", "sessionId"}` | `{"data": {"proposalId", "sessionId", "status": "committed", "scheduledMealsCount", "shoppingRebuilt": true}}`. Confirms through the generation server of the Account in one transaction, then broadcasts `session_committed` next to the engine's `proposal_confirmed`. A proposal already accepted answers the same result, writes nothing and broadcasts `session_committed` again (its first confirm may have committed after its call timed out), as long as `sessionId` names a committed session of the Account; otherwise `missing_lock` (409). Any other status answers `planning_proposal_not_pending` (409). Engine refusals (`lost_lock`, `terminal_lock`, `missing_lock`, `transaction_failed`, ...) pass through, and `no_active_generation` (409) when no generation server runs |
| `POST /api/planning/proposals/:proposalId/reject` | none | `{"data": {"proposalId", "generationRunId", "status": "rejected"}}`, after `proposal_rejected` was broadcast. The proposal is read once the generation server finished what it was running, so a confirm still in flight is not overwritten. Only a pending proposal; otherwise `planning_proposal_not_pending` (409). A generation server that cannot be reached answers `unknown_error` (500) and rejects nothing; so does a reject the server did not apply, read back once it handled it |
| `POST /api/planning/sessions/:sessionId/activity` | none | `{"data": {"sessionId", "leaseExpiresAt"}}`. The Planner renews its session every 60 s while the screen is open. The lease moves to two minutes from now, never past 30 minutes from the start of the session. A lease that ran out answers `lost_lock`, an ended session `terminal_lock`, another member `forbidden` and an unknown id `not_found` |

#### Planning context

`start_planning` hands the engine a Planning context with what the member set up during onboarding and the favorites they preselected (issue #29). It is a contract for the engine, not a payload the client receives: no event or reply carries it, and the mobile app has no type for it.

It is read before the session starts, so a refused start leaves nothing behind, and it travels as one nested map under `"planning_context"` in the constraints of the generation, next to `"date_from"`, `"date_to"` and `"request"` (snake_case, as the rest of the constraints). The Generation run persists it at `input_context.constraints.planning_context`. Its own keys are camelCase strings and every key is always present:

| Key | Type | Source |
|-----|------|--------|
| `diet` | string \| `null` | The Diet of the User (`omnivore`, `vegetarian`, `vegan`, `pescatarian`); `null` until set |
| `hardRestrictionCodes` | list of strings | The Hard restriction codes of the User, in catalog order. Text only: the strict candidate filter does not read them |
| `softPreferences` | list of strings | The Soft preferences of the User, in the stored order |
| `cookingSkill` | string \| `null` | `beginner`, `intermediate` or `advanced`; `null` until set. Read from the User row at start time, not from the socket |
| `householdSize` | integer \| `null` | 1 to 20; `null` until set. Read like `cookingSkill` |
| `slotCookingTimes` | object | Always the four Meal slots `breakfast`, `lunch`, `snack` and `dinner`, each `{ "cooking", "maxMinutes", "hungerLevel" }` |
| `favoriteRecipeIds` | list of UUID strings | The `favoriteRecipeIds` of the command that are favorites of the caller, deduplicated, in the client's order |

`slotCookingTimes.<slot>.cooking` is one of three modes:

| `cooking` | Meaning | `maxMinutes` | `hungerLevel` |
|-----------|---------|--------------|---------------|
| `no_constraint` | No time stored for the slot. The snack is never stored, so it is always this; a User who saved no times has it on all four slots | `null` | `null` |
| `do_not_cook` | The member stored 0 minutes: the slot must not need cooking | `0` | `light`, `normal` or `strong` |
| `limited` | The member stored 1 to 240 minutes | the stored minutes | `light`, `normal` or `strong` |

```json
{
  "diet": "vegetarian",
  "hardRestrictionCodes": ["peanut", "gluten"],
  "softPreferences": ["quick_meals"],
  "cookingSkill": "intermediate",
  "householdSize": 3,
  "slotCookingTimes": {
    "breakfast": { "cooking": "limited", "maxMinutes": 15, "hungerLevel": "light" },
    "lunch": { "cooking": "do_not_cook", "maxMinutes": 0, "hungerLevel": "normal" },
    "snack": { "cooking": "no_constraint", "maxMinutes": null, "hungerLevel": null },
    "dinner": { "cooking": "limited", "maxMinutes": 45, "hungerLevel": "strong" }
  },
  "favoriteRecipeIds": ["550e8400-e29b-41d4-a716-446655440010"]
}
```

A User with no preferences, no profile or no Slot cooking times still gets a context: the missing signals are `null`, empty lists or `no_constraint`. Prepared leftovers are not part of the context. The assembly lives in `MealPlannerApi.Services.PlanningContext` (`lib/meal_planner_api/services/planning_context.ex`).

#### Incoming Events

Every command the channel handles. Any other event name replies `invalid_payload`.

| Event | Payload | Description |
|-------|---------|-------------|
| `start_planning` | `{"rangeFrom": "YYYY-MM-DD", "rangeTo": "YYYY-MM-DD", "request": "text", "favoriteRecipeIds": ["uuid"], "requestId": "string"}` (or `dayCount` instead of `rangeTo`; `request`, `favoriteRecipeIds` and `requestId` are optional) | Start a planning session and its first generation, see [start_planning](#start_planning). Replies `{"sessionId": "uuid", "status": "active"}` |
| `send_message` | `{"sessionId": "uuid", "intent": {"kind": "change_constraints" \| "request_slot_swap" \| "request_recipe_suggestion", ...}}` | Apply a typed intent to the session this socket started. Replies the validated intent; emits no event |
| `confirm_proposal` | `{"proposalId": "uuid", "sessionId": "uuid"}` | Confirm a proposal: writes its meals and the shopping cart and commits the session in one transaction. Replies the same payload as `proposal_confirmed` |
| `reject_proposal` | `{"proposalId": "uuid"}` | Reject a proposal. With a generation running it gets no reply and `proposal_rejected` follows; otherwise it replies `{"proposalId", "generationRunId", "status": "rejected"}` |
| `cancel_planning` | `{"sessionId": "uuid"}` | Cancel the planning session with that id. Only its lock owner or the Account owner may. Replies `{"sessionId": "uuid", "status": "cancelled"}` |
| `generate_menu` | `{"requestId": "string", "constraints": {...}}` (flat keys such as `dateFrom`, `dateTo`, `budgetCents` are merged over `constraints`) | Start a generation outside a session. Replies `{"requestId", "runId"}` |
| `swap_constraints` | `{"requestId": "string", "basePayload": {...}, "constraints": {...}}` | Regenerate a menu with changed constraints. Replies the same payload as its `proposal_ready` |
| `chat` | `{"message": "text", "proposalId": "uuid"}` | Send a free-text change to the running generation. No reply; `proposal_update` or `generation_error` follows |

**Example Payload (start_planning):**
```json
{
  "rangeFrom": "2026-06-09",
  "rangeTo": "2026-06-15"
}
```

#### Planner events (frozen shapes)

The Planner screen reads five events of `planning:<account_id>` (issue #25). Their payloads are frozen: a key is added only with a new version of this section, and a test pins each shape. Every key is camelCase. The shapes are built by the channel (`MealPlannerApiWeb.Channels.Serializers.PlanningEvents`), not by the generation server.

| Event | Emitted | Payload |
|-------|---------|---------|
| `session_started` | When the session row is created | `{ "sessionId": "uuid" }` |
| `generation_started` | After `start_planning` started the generation | `{ "requestId": "string", "runId": "uuid", "sessionId": "uuid" }`. `generate_menu` emits it without `sessionId`, and `swap_constraints` with `{ "requestId", "reason": "constraint_update" }` |
| `proposal_ready` | When the generation finished a proposal | see below |
| `planning_message` | Right after `proposal_ready`, same socket | see below |
| `generation_error` | When a generation failed or could not start | `{ "reason": "string", "details": {}, "runId": "uuid" \| null, "requestId": "string" \| null }` |

`proposal_ready`, day by day:

```json
{
  "proposalId": "uuid",
  "runId": "uuid",
  "estimatedCostCents": 1950,
  "days": [
    {
      "date": "2026-10-09",
      "costCents": 1250,
      "meals": [
        {
          "slot": "lunch",
          "recipeId": "uuid",
          "recipeName": "Chicken rice",
          "priceCents": 1250,
          "macros": { "proteinG": 30, "carbsG": 60, "calories": 500 }
        }
      ]
    }
  ]
}
```

Days are in calendar order and the meals of a day in `breakfast`, `lunch`, `dinner`, `snack` order. `priceCents` is `null` when the price of a recipe is unknown and then adds nothing to `costCents` and `estimatedCostCents`. The `proposal_ready` of `swap_constraints` is a different payload (`proposal` with `scheduledMeals` and `weeklyPlan`) and is pushed as it was.

`planning_message` is the assistant's message about the proposal:

```json
{
  "role": "assistant",
  "text": "Here is your plan for 2 days: 3 meals, estimated cost 19.50.",
  "proposalId": "uuid",
  "runId": "uuid",
  "summary": { "dayCount": 2, "mealCount": 3, "estimatedCostCents": 1950 }
}
```

`generation_error.reason` is the raw reason (`"optimization_failed"`, `"invalid_date_range"`, `"pipeline_error"`), not an `ApiError` code; `details` is `{}` when the failure has none.

`runId` and `requestId` are `null` when the failure comes from a path of the engine that carries a reason alone (`pipeline_error`, the reasons of the request validation, `invalid_modification`). Such an event cannot be matched to a run by id: a client attributes it to the in-flight generation of the account, of which there is at most one. Do not rely on the ids to correlate a `generation_error`.

Order: `proposal_ready` is pushed before `planning_message`. `generation_started` is broadcast by the channel after it started the generation, so a generation that fails at once may deliver `generation_error` first; correlate by `runId` / `requestId` when they are present (see above when they are `null`), never by arrival order. A proposal reaches every member joined to the topic, each with its own `planning_message`.

#### Planner fixtures

The frozen payloads above are also committed as JSON in `apps/mobile/src/features/planner/fixtures/` (`startPlanningReply`, `sessionStarted`, `generationStarted`, `proposalReady`, `planningMessage`, `generationError`, `planningInvalidRangeError`, `planningRangeLockedError`, `planningContext`). The channel serializers are real: every fixture except `proposalReady`/`planningMessage` is recorded from a real channel run. `proposal_ready` is driven by a synthetic broadcast of a proposal built in the test (with a fractional macro and a missing one, as the producer sends them):

- `test/meal_planner_api_web/channels/planner_fixtures_test.exs` runs `start_planning` and records each payload through `MealPlannerApiWeb.PlannerFixtures.check!/3`. Without `UPDATE_FIXTURES`, the test fails when a committed file differs from the fresh payload, so API drift fails an API test.
- The mobile test `src/features/planner/fixtures/__tests__/plannerFixtures.test.ts` parses each payload the client receives with the types in `src/features/planner/types/planningEvents.ts` (missing, extra or mistyped keys throw), so app drift fails an app test.
- Volatile values are normalized: UUIDs become `00000000-0000-4000-8000-00000000000N` and the dates of the run become `2030-01-01`, `2030-01-02`.
- `planningContext` is the exception to the rule above: it is the [Planning context](#planning-context) read back from the persisted Generation run of a User with every signal set, one slot at 0 minutes included. The client never receives it, so no mobile type parses it; the API test is the only guard against drift.

To regenerate after an intended payload change, from `apps/api` (with the test database env set):

```sh
UPDATE_FIXTURES=1 mix test test/meal_planner_api_web/channels/planner_fixtures_test.exs
```

Then update `planningEvents.ts`, run `npm test` in `apps/mobile`, and commit the JSON files with the change.

#### Outgoing Events

The events of `PlanningChannel.outbound_events/0`. Every member joined to the topic receives them, with camelCase keys.

| Event | Payload | Description |
|-------|---------|-------------|
| `session_started` | `{"sessionId": "uuid"}` | A planning session was created by `start_planning` |
| `session_resumed` | `{"sessionId": "uuid"}`; on join, `{"sessionId", "proposalId", "proposal", "messages": [{"role", "content", "intentKind"}]}` | A session server restarted and resumed an active session, or a socket joined while its Account has an active session (pushed to that socket only) |
| `session_cancelled` | `{"sessionId": "uuid"}` | A session was cancelled by `cancel_planning`, or by a `start_planning` whose generation could not start |
| `session_committed` | `{"sessionId", "proposalId", "scheduledMealsCount", "shoppingRebuilt": true}` | `POST /api/planning/confirm` committed the session, wrote its meals and rebuilt the Shopping list. The `confirm_proposal` command does not emit it |
| `session_lost_lock` | `{"sessionId": "uuid"}` | The channel process that held the session's range lock exited abnormally |
| `session_expired` | `{"sessionId": "uuid"}` | The session sweeper expired a session that stayed active too long |
| `generation_started` | `{"requestId", "runId", "sessionId"}` | A generation started; see [Planner events](#planner-events-frozen-shapes) |
| `proposal_ready` | `{"proposalId", "runId", "estimatedCostCents", "days": [...]}` | A generation finished a proposal; see [Planner events](#planner-events-frozen-shapes) |
| `planning_message` | `{"role": "assistant", "text", "proposalId", "runId", "summary": {...}}` | The assistant's message about a proposal, pushed right after `proposal_ready` |
| `generation_error` | `{"reason", "details", "runId", "requestId"}` | A generation failed or could not start; see [Planner events](#planner-events-frozen-shapes) |
| `proposal_update` | `{"changeType": "string", "newValue": ...}` | The running generation applied a `chat` change |
| `proposal_confirmed` | `{"proposalId", "scheduledMealsCount", "cart": [...], "shoppingItemsCount", "checkoutSessionId"}` | A proposal was confirmed and its meals and cart were written |
| `proposal_rejected` | `{"proposalId": "uuid"}` (`generationRunId` and `status` too when the command rejected it with no generation running) | A proposal was rejected, by the command or by `POST /api/planning/proposals/:proposalId/reject` |
| `send_intent` | `{"intent": {"kind": "string", ...}}` | A member sent a typed intent on the AI chat channel. A notification only: the session does not apply it until the client sends `send_message` |

**Example Response (proposal_confirmed):**
```json
{
  "proposalId": "550e8400-e29b-41d4-a716-446655440003",
  "scheduledMealsCount": 14,
  "cart": [...],
  "shoppingItemsCount": 23,
  "checkoutSessionId": "550e8400-e29b-41d4-a716-446655440004"
}
```

---

### shopping:* — Shopping and Inventory Notifications

Pushes the Cart and Inventory changes of an Account to every member's device, so a change made by another User or device of the same Account shows without a refetch. The changes themselves are made over HTTP by the shopping and inventory controllers, which scope every write to the caller's Account; this channel repeats none of them.

**Topic Pattern:** `shopping:<account_id>`

#### Join

The join succeeds only when the socket's Membership belongs to the topic's Account, is still active when read again from the database, and passes the capability check (`ChannelCapability.authorize/1`). Any other case replies `{"reason": "forbidden"}`.

#### Incoming Events

None. Every command pushed on the topic is answered with `{"reason": "unsupported_command"}`.

#### Outgoing Events

Before each push the channel checks the Membership again, the same way as the join, and drops the push when the check fails. Payload keys are snake_case.

| Event | Payload | Sent when |
|-------|---------|-----------|
| `cart_reserved` | `{"session_id": "uuid", "status": "in_cart", "updated_rows": 2, "owner_user_id": "uuid", "lease_expires_at": "ISO8601", "reservations": [...]}` | A member reserved shopping items in their cart |
| `cart_released` | `{"session_id": "uuid", "updated_rows": 1, "status": "pending"}` (`"abandoned"` when the whole cart was cancelled) | A member removed lines from their cart or cancelled it |
| `cart_expired` | `{"session_id": "uuid"}` | A cart lease ran out and its items were released |
| `cart_renewed` | `{"session_id": "uuid", "lease_expires_at": "ISO8601"}` | A member renewed their cart lease |
| `purchase_confirmed` | `{"checkout_session_id": "uuid", "status": "string", "checkout_type": "string", "moved_to_inventory_count": 3, "checked_out_items_count": 3, "actual_total_cents": 1250}` | A member confirmed a purchase, or recorded the delivery of a confirmed order |
| `inventory_changed` | `{"refresh": true}` | The Inventory changed: a purchase moved items into it, or a member edited it. Refetch the Inventory |

---

## Reconnection Strategy

Implement exponential backoff with jitter for WebSocket reconnection:

```javascript
class MealPlannerSocket {
  constructor(url, params) {
    this.url = url;
    this.params = params;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.socket = null;
  }

  connect() {
    this.socket = new Socket(this.url, { params: this.params });

    this.socket.onError(() => this.handleError());
    this.socket.onClose(() => this.handleClose());

    this.socket.connect();
  }

  handleError() {
    console.error("Socket connection error");
  }

  handleClose() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.calculateBackoff();
      console.log(`Reconnecting in ${delay}ms...`);

      setTimeout(() => {
        this.reconnectAttempts++;
        this.refreshToken().then(token => {
          this.params.token = token;
          this.connect();
        });
      }, delay);
    } else {
      console.error("Max reconnection attempts reached");
    }
  }

  calculateBackoff() {
    // Exponential backoff with jitter: base * 2^attempt + random(0-1000)
    const base = 1000;
    const maxDelay = 30000;
    const exponentialDelay = Math.min(base * Math.pow(2, this.reconnectAttempts), maxDelay);
    const jitter = Math.random() * 1000;
    return exponentialDelay + jitter;
  }

  async refreshToken() {
    // Fetch a new JWT from your auth endpoint
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include"
    });
    const { token } = await response.json();
    return token;
  }
}
```

> **Note:** `refreshToken()` above only illustrates where a refresh fits in the reconnection loop; its
> request and response do not match the API. `POST /api/auth/refresh` takes `{ "refreshToken" }` in the
> JSON body and answers `{ "accessToken", "refreshToken", "tokenType" }`, as defined in
> [spec #1](https://github.com/ChordanDev/myfood-monorepo/issues/1).

---

## Error Handling

| Error Code | HTTP Status | Description | Recovery Action |
|-----------|-------------|-------------|----------------|
| `auth_required` | 401 | No valid token provided | Redirect to login |
| `token_expired` | 401 | JWT has expired | Refresh token, reconnect |
| `channel_not_found` | 404 | Invalid topic pattern | Verify topic format |
| `rate_limited` | 429 | Too many requests | Apply backoff, retry |
| `server_error` | 500 | Internal server error | Log error, notify user |
| `channel_closed` | - | Server closed the channel | Auto-reconnect |

---

## Best Practices

1. **Subscribe lazily**: Only join channels when needed, leave when done
2. **Handle disconnections**: Implement reconnection with exponential backoff
3. **Batch updates**: For bulk operations, use batch events to reduce overhead
4. **Timeout handling**: Set reasonable timeouts for requests expecting responses
5. **Presence tracking**: Use Phoenix Presence for showing active users