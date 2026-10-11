# Feature: Voice endpoints cap the transcript, keep it out of the logs and load stock once (issue #157)

Ticket: ChordanDev/myfood-monorepo#157, a follow-up of #44 (PR #141).
Base: `main` at `7d4221b`. Branch: `fix/voice-endpoint-hardening`.

## Objective

`POST /api/inventory/voice/preview` and `/apply` refuse an oversized transcript, the request log never prints the spoken text, and an apply reads the Account's usable lots once.

## Problem

- Only the Plug default (8 MB) bounds `transcript`. The parser works in proportion to stock entries times length, and the text is stored once per lot in `inventory_mutation_events.raw_voice_text`.
- `transcript` is not in `:phoenix, :filter_parameters` (`apps/api/config/config.exs`), so Phoenix prints it in request logs.
- `voice_apply` loads the whole Account inventory three times: `usable_stock` once and `source_total` per source kind inside the transaction.

## Scope and constraints

- In scope: `InventoryService` voice functions, the log filter, the integration guide lines that list the voice validation errors, tests.
- Out of scope: retry safety of apply (#140), the parser rules (#155), the mobile sheet (#156), other Inventory follow-ups (#116).
- An apply racing another write must not behave worse than today: inventory never goes negative and a failed subtraction writes nothing.

## Decisions

- **D1 Cap.** 500 characters, counted on the transcript as sent. The issue asks for "a few hundred". Above it the endpoints answer the existing `validation_error` (422), as for a missing transcript. The count is in codepoints: with graphemes, one letter under a run of combining marks counts as one character and an 8 MB transcript would still pass. A transcript above 2,000 bytes is refused without walking it.
- **D2 The mutation event holds the same bound.** `validate_length(:raw_voice_text, max: 500, count: :codepoints)` as a backstop. In `lib`, only the voice path writes `raw_voice_text`.
- **D3 Apply stops reading per-source totals.** `subtract_usable_lots_and_log/1` takes the advisory lock, selects the usable lots of the source kind `FOR UPDATE` and takes `min(lot, remaining)` per lot, so it already caps under lock and reports what it applied. `source_total` read the same lots unlocked and was redundant. Each source kind is now asked for all that remains and the returned `delta` carries the rest to the next one. The read left is `usable_stock`, before the transaction, for the parse and the overall cap.
- **D4 `text` is not filtered.** No voice endpoint reads a `text` parameter any more, and Phoenix matches filter keys by substring, so `"text"` would hide unrelated keys.

## Tasks

- [x] **T1 Transcript cap.** Preview and apply refuse a transcript above the cap before parsing; the integration guide lists it. Route: delegated direct. Commit `ba9e502`.
- [x] **T2 Transcript out of the request log.** `transcript` joins `filter_parameters`; a test captures the log of a voice request and asserts the spoken text is absent and the filtered marker is present. Route: delegated direct. Commit `8f3a17e`. The test raises `Phoenix.Logger` to `:debug` with `Logger.put_module_level/2`, because `config/test.exs` runs at `:warning` and the parameters line would not be emitted otherwise.
- [x] **T3 One load of usable lots in apply.** Route: delegated direct. Commit: the one that adds this document, `refactor(api): read the usable lots once in voice apply`. See D3.

## Acceptance criteria

- A transcript above the cap is rejected with a validation error; a test sends a very long input.
- `transcript` is in `filter_parameters`; a test captures the log and asserts the text does not appear.
- `voice_apply` loads usable lots once.

## Checks

- `mix test test/meal_planner_api/services/inventory_service_test.exs test/meal_planner_api_web/controllers/inventory_controller_test.exs test/meal_planner_api/inventory_concurrency_test.exs`
- `mix test` (full API suite)
- `mix format --check-formatted`, `mix credo`

## Progress

All three tasks done on 2026-10-11.

- RED observed. T1: three tests failed, preview answered 200 for a 501 and a 9,900 character transcript. T2: both tests failed with the spoken text in `Parameters: %{"transcript" => ...}`. T3: the read-count test failed on the old code.
- GREEN: the three inventory test files plus `inventory_voice_log_test.exs`, 67 passed, 2 skipped (58 passed, 2 skipped before). `mix test`, 1781 passed, 22 skipped, 0 failures. `mix format --check-formatted` and `mix credo` clean.
- Not run: `inventory_concurrency_test.exs` stays skipped, it only runs on a `meal_planner_api_t1_verify_*` database. The stale-read case is covered in `inventory_service_test.exs` by lowering the stock right after the apply's read.

## Open questions

- Ecto's `:debug` query log prints the `raw_voice_text` parameter of the event INSERT. Production runs at `:info`, so this reaches development logs only.
- An apply's `intent.name`, the catalog name of the Ingredient, still shows in the parameter log.
- The mobile sheet does not limit the field, so a transcript above the cap comes back as the generic validation message.
