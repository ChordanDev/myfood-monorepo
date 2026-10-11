# Cooking chat for today's meal (issue #36, R5)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/36 (`ready-for-agent`, part of spec #4, blocker #35 closed by PR #124).
Branch: `claude/issue-36-208eb9` (worktree `.claude/worktrees/issue-39-b92a2a`), fast-forwarded to main `84c4e20`.

## Objective
While cooking today's meal the User asks the Cooking chat about the recipe and gets answers that know the current Inventory; the history is kept per meal and reloads after reopening the app; the chat is disabled for other days.

## Problem
#35 left the `ask` route and both error codes in place, but chat writes are stubbed (`:ephemeral_chat_only`), the session read hardcodes `chat_messages: []`, `ask` never checks the Account's today, a finished session answers `cooking_session_not_active`, the stored snapshot holds only step state, and the mobile chat is a local script with no session id.

## Scope
- API: persist both turns of `ask`, return history in the session read, gate `ask` on today and on finished sessions, freeze recipe and inventory in the Context snapshot, let the app find the meal's session.
- Mobile: server-backed chat in the recipe screen replacing the scripted one, history recovered from the session read.
- Out of scope: streaming, new date logic, the web `cooking:*` channel contract (it only inherits the service behaviour).

## Decisions (assistant, from exploration)
- D1 Session discovery: `POST /api/cooking/start` reuses the meal's active Cooking session instead of always inserting a new one. The app keeps no session id; opening the chat calls start then the session read. Mark-as-cooked therefore finishes the same session the chat used (one Cooking session per meal, as the glossary defines it). No new route.
- D2 Context snapshot: recipe and inventory are frozen once when the session is created and survive step updates; the prompt is built from the frozen data plus prior turns, never from live reads.
- D3 `ask` gate order: session not found, then finished (`cooking_already_finished`), then meal not on `AccountClock.today` (`cooking_chat_unavailable`). The existing test pinning `cooking_session_not_active` for a finished session changes with the contract.
- D4 The AI call runs outside any DB transaction; both turns are then written in one transaction. The existing canned fallback on AI error is kept and persisted as the assistant turn.
- D5 History item shape: `{ id, role, content, insertedAt }`, user and assistant turns only, oldest first, under `chatMessages` in the session read.
- D6 "The existing fake" is the configured test client `AI.MockClient`; `CookingBarrierClient` is used where a test needs to observe the prompt.
- D7 Delivery: stacked-to-main (repository precedent), one slice per task.

## Acceptance criteria (from #36)
- `POST /api/cooking/sessions/:sessionId/ask` answers from the Context snapshot and persists both turns; `GET /api/cooking/sessions/:sessionId` returns state and history in camelCase.
- `ask` on a meal not scheduled on the Account's today gives `cooking_chat_unavailable`; on a finished session `cooking_already_finished`.
- Mobile chat screen replaces the local scripted chat and recovers history from the session read.
- Tests cover availability, persistence and recovery with the AI stubbed by the existing fake.

## Tasks
- [x] T1 API: start reuses the active session, frozen snapshot, `ask` gates, turn persistence, history in the session read, tests. Route: delegated writer (several non-trivial files).
- [x] T2 Mobile: `getCookingSession` / `askCookingSession`, server-backed `useRecipeChat`, scripted reply removed, fixtures and tests. Route: delegated writer (several non-trivial files).

## Checks
- API (`apps/api`, `MIX_ENV=test`): `mix compile --warnings-as-errors`, `mix format --check-formatted`, `mix credo --strict`, `mix sobelow --config`, `mix dialyzer`, `mix test`.
- Mobile (`apps/mobile`): `npm run lint`, `npx tsc --noEmit`, `npx jest --ci`.

## Forecast
About 700 authored changed lines (API ~400, mobile ~300); two slices.

## Progress / evidence
T1 (delegated writer, one work-unit commit `feat(api): persist the Cooking chat and gate it on today's meal (#36)`):
- Start locks the meal row, then reuses its active session or creates one, so two concurrent starts cannot leave two active sessions. A completed session is not reused: starting that meal again creates a new, empty one.
- The Context snapshot lives under `"frozen"` in `cooking_sessions.context_snapshot` (recipe name, ingredients, steps; usable Inventory summed per ingredient and unit on the Account's today). `context_snapshots` rows keep only step state, and no payload serializes the frozen part. No migration.
- `ask` gates: session not found, `cooking_already_finished`, planned meal, `cooking_chat_unavailable`; a blank or over 2000 character message is `validation_error`. The provider call runs outside any transaction; both turns are then written under the session row lock (user first, assistant one microsecond later), and nothing is written if the session finished meanwhile.
- Session read and start return `chat_messages: [%{id, role, content, inserted_at}]`, oldest first. `ask` keeps `session_id`, `message`, `content_type`, `step_context` and adds `turns` (the two stored turns, same item shape).
- Removed the `:ephemeral_chat_only` stubs (`PlanningRepo.add_chat_message` is now the real insert; `Persistence.Planning.add_cooking_message` and `PlanningService.add_chat_message` had no callers and are gone).
- Contract changes in existing tests: a finished session answers `cooking_already_finished` to `ask` (was `cooking_session_not_active`); the "no durable transcript" test now asserts the stored history.
- RED observed first: 18 failures (HTTP: 200 instead of 409/422 and `chatMessages: []`; service: `answer_question/5` undefined, prompts never observed).
- Checks (`apps/api`, `MIX_ENV=test`): `mix compile --warnings-as-errors` clean; `mix format --check-formatted` clean; `mix credo --strict` no issues; `mix sobelow --config` clean; `mix test` 1714 passed, 20 skipped, 0 failures; `mix dialyzer` exits 2 with 9 `call_without_opaque` warnings, the same 9 on the untouched base (none in changed code).
- Size: 12 files, +819/-88 (`git show --stat 03cd8ba`), over the 400 heuristic because the availability, recovery and frozen-snapshot tests are about 500 lines on their own.

T2 (delegated writer, one work-unit commit `feat(mobile): back the Cooking chat with the session API (#36)`):
- API client (`features/cooking/api`): `startCookingSession` now parses `chatMessages`; new `getCookingSession` (GET, auth, default retry) and `askCookingSession` (POST, never retried). A session without a well-formed history, or an answer whose `turns` are not exactly the user turn then the assistant turn, is `unknown_error`.
- `useRecipeChat({ scheduledMealId, isEnabled, isCooked })` is server-backed: on mount it calls start, then the session read, and maps the history to the UI messages. A question is shown optimistically, then swapped for the two stored `turns` (server ids as keys). A failed question is removed, goes back to the composer and the error is shown under the conversation; a failed opening is retried by the next question.
- Availability is `available | unavailable | finished`: `cooking_chat_unavailable` and `cooking_already_finished` close the chat, and so does a meal marked as cooked (history stays on screen). A disabled chat (other day, no planned meal, already cooked) makes no request.
- Guards: a ref stops a double submit; answers for a meal that is no longer on screen, or after unmount, are dropped; state is keyed by meal id.
- Removed with the script: `buildAssistantReply`, the 1200 ms timer, the offer / quick-action flow (`RecipeChatOffer`, `RecipeChatAction`, `resolveQuickAction`, `onAddOffer`, `answerQuickAction`) and the `RecipeQuickActions` component. The quick actions only answered the scripted "add to shopping list" offer, which the server does not make.
- Copy: new composer placeholder `Chat cerrado: la comida ya está cocinada`. `cooking_chat_unavailable` in `src/api/errors.ts` is unchanged: the chat tells both refusals through the composer placeholder, so that message is still shown only by mark-as-cooked.
- Mark-as-cooked is unchanged: its start returns the session the chat opened, so the screen test now sees two starts (chat, then cooking) and one finish.
- Limitation: the app keeps no session id and does not open a session for a cooked meal (start would create a new, empty one), so the history of a cooked meal is not shown after the screen is reopened. The chat availability on the device still uses the device-local date; the server's today is authoritative and closes the chat when they differ.
- RED observed first: API suite 9 failures (`askCookingSession` / `getCookingSession` not a function, history not parsed); chat domain and hook suites 20 failures; screen suite 4 failures against the old tests once the script was gone.
- Checks (`apps/mobile`): `npm run lint` 0 errors (4 warnings in untouched files), prettier clean; `npx tsc --noEmit` exit 0; `npx jest --ci` 142 suites, 2086 tests passed, 0 failed (no `phoenix` resolve failure this time).
- Size: 16 files, +948/-785 before this document, over the 400 heuristic because the scripted chat's tests (about 600 lines) were replaced by the server-backed ones.

## Next step
whole-branch native review, then delivery decision
