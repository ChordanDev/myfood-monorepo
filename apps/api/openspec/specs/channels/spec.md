# Channels Capability Specification

> **Source**: `phase-a-tenancy-refactor` change. Delta spec: `membership-scoped-channels.md`.
> **Date**: 2026-07-21 (Phase A archive)

## Purpose

Defines how WebSocket tenancy mirrors the HTTP model: the socket connect populates `current_membership`, and each channel's `join/3` enforces account-scoped access at join time.

---

## Requirements

### Requirement: Socket connect populates `current_membership` from a real row

`UserSocket.connect/3` MUST decode the JWT via `Guardian.resource_from_token/1`, then resolve `current_membership` via `LoadCurrentMembershipSocket.membership_from_socket/1`. Both `access_v2` and legacy `access` tokens MUST resolve to a genuine `AccountMembership` row — there is no in-memory synthesized membership. Connect MUST fail (`:error`) only when no membership can be resolved at all; it MUST succeed for a non-`:active` (e.g. `:invited`) membership so that the channel `join/3` can return a specific rejection reason.

#### Scenario: access_v2 connect resolves the real membership

- GIVEN a valid `access_v2` token with `membership_id`
- WHEN `UserSocket.connect/3` runs
- THEN `socket.assigns.current_membership.id` equals that membership's id

#### Scenario: Legacy access connect resolves the real active membership

- GIVEN a valid legacy `access` token for a User who holds a real `:active` membership
- WHEN `UserSocket.connect/3` runs
- THEN `socket.assigns.current_membership` is that real row

#### Scenario: Unresolvable membership fails connect

- GIVEN a token whose claims resolve to no membership at all
- WHEN `UserSocket.connect/3` runs
- THEN the connection is rejected (`:error`)

### Requirement: `join/3` enforces account match + active status

For `CalendarChannel` and `PlanningChannel` (topic prefix `"<channel>:<account_id>[...]"`), `join/3` MUST reject with `{:error, %{reason: "forbidden"}}` when the resolved membership is `nil`, when `to_string(membership.account_id) != topic_account_id`, or when `membership.status != :active`. On success it MUST assign `:account_id` and `:current_membership` to the socket.

#### Scenario: Cross-Account join rejected

- GIVEN a socket whose membership is scoped to `Account_A`
- WHEN it attempts to join `"calendar:<Account_B_id>"`
- THEN the join is rejected with `{:error, %{reason: "forbidden"}}`

#### Scenario: Invited (non-active) membership join rejected

- GIVEN a socket whose membership on the topic's Account has `status: :invited`
- WHEN it attempts to join that channel's topic
- THEN the join is rejected with `{:error, %{reason: "forbidden"}}`

#### Scenario: Legacy access_v1 connection accepted when active

- GIVEN a legacy `access` token resolving to a real `:active` membership on the topic's Account
- WHEN the socket joins that topic
- THEN the join succeeds

### Requirement: `AIChannel` enforces active membership only (no account match)

`AIChannel`'s topic is `"ai_chat:<room_id>"` — an opaque identifier with no embedded `account_id`. `join/3` MUST reject when the resolved membership is `nil` or non-`:active`, but MUST NOT attempt a topic-vs-account comparison (none is structurally possible).

#### Scenario: Non-active membership rejected on ai_chat join

- GIVEN a socket whose membership has `status: :invited`
- WHEN it attempts to join `"ai_chat:<room_id>"`
- THEN the join is rejected with `{:error, %{reason: "forbidden"}}`

### Requirement: Multi-familia User can hold two live socket connections

A single User with `:active` memberships on two different Accounts MUST be able to open two independent sockets, each scoped to a different Account, and each MUST only receive broadcasts for its own topic.

#### Scenario: Two sockets, two topics, isolated broadcasts

- GIVEN one User with memberships on `Account_A` and `Account_B`, connected via two sockets
- WHEN socket 1 joins `"planning:<Account_A>"` and socket 2 joins `"planning:<Account_B>"`, and a broadcast is pushed to `"planning:<Account_A>"`
- THEN only socket 1 receives the broadcast

### Requirement: Four channels exist; shopping/inventory writes isolate at the controller

The channel modules routed on `UserSocket` are `CalendarChannel` (`calendar:*`), `PlanningChannel` (`planning:*`), `AIChannel` (`ai_chat:*`) and `ShoppingChannel` (`shopping:*`). `CookingChannel` was removed in issue #166: cooking goes over HTTP, where `CookingService` scopes every lookup to the Account. There is no inventory channel. Every `shopping` and `inventory` write MUST go through its HTTP controller, which scopes it to `current_membership.account_id`; the shopping channel only pushes the outcome of those writes and accepts no command.

#### Scenario: Channel modules match the routed channels

- GIVEN the `lib/meal_planner_api_web/channels/` directory
- WHEN its channel modules are listed (the `intent_atomizer.ex` helper and the `serializers/` directory are not channel modules)
- THEN exactly `ai_channel.ex`, `calendar_channel.ex`, `planning_channel.ex` and `shopping_channel.ex` are present, one for each `channel/2` route of `UserSocket`

### Requirement: `ShoppingChannel` pushes Account-scoped shopping and inventory changes

`ShoppingChannel`'s topic is `"shopping:<account_id>"`. `join/3` MUST reject with `{:error, %{reason: "forbidden"}}` unless the socket's membership belongs to the topic's Account, is still `:active` when re-read from the database, and passes `ChannelCapability.authorize/1`. The channel is outbound only: it MUST push exactly `cart_reserved`, `cart_released`, `cart_expired`, `cart_renewed`, `purchase_confirmed` and `inventory_changed`, and it MUST re-check the membership the same way before each push, dropping the push when the check fails. Every inbound command MUST be answered with `{:error, %{reason: "unsupported_command"}}`.

#### Scenario: Cross-Account shopping join rejected

- GIVEN a socket whose membership is scoped to `Account_A`
- WHEN it attempts to join `"shopping:<Account_B_id>"`
- THEN the join is rejected with `{:error, %{reason: "forbidden"}}`

#### Scenario: Push dropped after the membership stops being active

- GIVEN a socket joined to `"shopping:<Account_A_id>"`
- WHEN its membership stops being `:active` and a `cart_reserved` event is broadcast on that topic
- THEN the socket receives no push

#### Scenario: Inbound command rejected

- GIVEN a socket joined to `"shopping:<account_id>"`
- WHEN it pushes any command
- THEN the reply is `{:error, %{reason: "unsupported_command"}}`
