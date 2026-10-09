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

- **Commands (client to server):** send camelCase keys at any depth, for example `rangeFrom`, `sessionId` or `constraints.budgetCents`. snake_case keys are still accepted (`range_from`); the incoming tables below are written in snake_case. When a payload carries the same key in both spellings, the snake_case one is used.
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
| `rangeFrom` | `"YYYY-MM-DD"` | First day. Today or later; one day before today (UTC) is still accepted, because a member east of UTC sees a date that is yesterday in UTC |
| `rangeTo` | `"YYYY-MM-DD"` | Last day, inclusive. Optional when `dayCount` is sent |
| `dayCount` | integer | Number of days, 1 to 7. Optional when `rangeTo` is sent; when both are sent they must agree |
| `request` | string | Optional free text, at most 1000 characters after trimming. A blank text counts as none. It reaches the generation as the `request` constraint |
| `requestId` | string | Optional. Correlates `generation_started` and `generation_error`; generated when missing |

The command validates the range, checks the Account is eligible, starts the session (`session_started`), then starts the generation through the same call `generate_menu` uses and replies:

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440002", "status": "active" }
```

`generation_started` follows with the `runId`. When the generation cannot start the session is cancelled (`session_cancelled`), a `generation_error` event is pushed and the command replies the error envelope with `requestId`, so the member can start again. The range is capped at 7 days because the window of the generation server holds 7 days; a longer range is refused before any session starts.

Refusals reply the error envelope with these codes:

| Code | Condition |
|------|-----------|
| `planning_invalid_range` | A date is missing or is not an ISO 8601 date, the range ends before it starts, lasts more than 7 days, starts more than a day in the past, or `dayCount` is not an integer from 1 to 7 or disagrees with `rangeTo` |
| `planning_range_locked` | An active session of the Account already holds part of the range |
| `invalid_payload` | `request` is not a string or is longer than 1000 characters |
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

The older `invalid_range` and `overlapping_range` codes stay in the allowlist; `start_planning` no longer replies them.

#### Incoming Events

| Event | Payload | Description |
|-------|---------|-------------|
| `start_planning` | `{"range_from": "YYYY-MM-DD", "range_to": "YYYY-MM-DD", "request": "text"}` (or `day_count` instead of `range_to`) | Start a planning session and its first generation, see [start_planning](#start_planning) |
| `choose_slot` | `{"slot_id": "uuid", "recipe_id": "uuid"}` | Assign recipe to a slot |
| `remove_slot` | `{"slot_id": "uuid"}` | Remove recipe from a slot |
| `generate_plan` | `{"strategy": "balanced|quick|varied"}` | Trigger AI plan generation |
| `accept_plan` | `{"plan_id": "uuid"}` | Accept generated plan |
| `cancel_planning` | `{"session_id": "uuid"}` | Cancel the planning session with that id |

**Example Payload (start_planning):**
```json
{
  "range_from": "2026-06-09",
  "range_to": "2026-06-15"
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

`generation_error.reason` is the raw reason (`"optimization_failed"`, `"already_running"`, `"pipeline_error"`), not an `ApiError` code; `details` is `{}` when the failure has none.

Order: `proposal_ready` is pushed before `planning_message`. `generation_started` is broadcast by the channel after it started the generation, so a generation that fails at once may deliver `generation_error` first; correlate by `runId` / `requestId`, never by arrival order. A proposal reaches every member joined to the topic, each with its own `planning_message`.

#### Outgoing Events

| Event | Payload | Description |
|-------|---------|-------------|
| `plan_started` | `{"planId": "uuid", "weekStart": "YYYY-MM-DD"}` | Planning session started |
| `plan_generated` | `{"planId": "uuid", "slots": [...], "confidence": 0.92}` | AI plan is ready |
| `slot_chosen` | `{"slotId": "uuid", "recipe": {...}}` | User confirmed a slot choice |
| `slot_removed` | `{"slotId": "uuid"}` | Slot was cleared |
| `plan_conflict` | `{"slotId": "uuid", "conflicts": [...], "suggestions": [...]}` | Conflict detected |
| `plan_saved` | `{"planId": "uuid", "savedCount": 21}` | Plan committed to calendar |
| `planning_error` | `{"code": "string", "message": "string"}` | Error during planning |

**Example Response (plan_generated):**
```json
{
  "planId": "550e8400-e29b-41d4-a716-446655440002",
  "slots": [
    {
      "date": "2026-06-09",
      "slot": "breakfast",
      "recipe": {
        "id": "101",
        "name": "Oatmeal with Berries",
        "caloriesPerServing": 280
      },
      "confidence": 0.95
    }
  ],
  "confidence": 0.92,
  "missingMeals": 2
}
```

---

### cooking:* — Cooking Mode

Real-time cooking guidance and timer synchronization.

**Topic Pattern:** `cooking:<recipe_id>`

#### Incoming Events

| Event | Payload | Description |
|-------|---------|-------------|
| `start_cooking` | `{"recipe_id": "uuid", "servings": number}` | Start cooking mode for a recipe |
| `step_complete` | `{"step_index": number, "notes": "string"}` | Mark a step as completed |
| `timer_start` | `{"duration_seconds": number, "label": "string"}` | Start a cooking timer |
| `timer_pause` | `{"timer_id": "uuid"}` | Pause a running timer |
| `timer_resume` | `{"timer_id": "uuid"}` | Resume a paused timer |
| `timer_cancel` | `{"timer_id": "uuid"}` | Cancel a timer |
| `update_servings` | `{"servings": number}` | Update serving size |
| `end_cooking` | `{"rating": number, "notes": "string"}` | End cooking session |

**Example Payload (start_cooking):**
```json
{
  "recipe_id": "789",
  "servings": 4
}
```

#### Outgoing Events

| Event | Payload | Description |
|-------|---------|-------------|
| `cooking_started` | `{"session_id": "uuid", "recipe": {...}, "steps": [...]}` | Cooking session initialized |
| `step_update` | `{"current_step": number, "total_steps": number}` | Current step changed |
| `step_complete` | `{"step_index": number, "next_step": {...}}` | Step marked complete |
| `timer_tick` | `{"timer_id": "uuid", "remaining_seconds": number}` | Timer countdown update |
| `timer_done` | `{"timer_id": "uuid", "label": "string"}` | Timer finished |
| `scaled_ingredients` | `{"original_servings": number, "new_servings": number, "ingredients": [...]}` | Ingredients rescaled |
| `cooking_complete` | `{"session_id": "uuid", "duration_minutes": number}` | Cooking session ended |

**Example Response (timer_done):**
```json
{
  "timer_id": "550e8400-e29b-41d4-a716-446655440003",
  "label": "Boil pasta",
  "remaining_seconds": 0,
  "next_action": "drain_pasta"
}
```

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
5. **Presence tracking**: Use Phoenix Presence for showing active users in cooking mode