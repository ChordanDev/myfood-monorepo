# Voice adjustment of Inventory (issue #44, S6)

## Objective

A User says "I ate half the cream cheese"; the app shows the parsed intent, asks for confirmation when unsure, applies it, and the ledger records the transcript. Part of #5. Blocked-by #42 is merged.

## Scope and constraints

- Subtract only. No migration needed: trigger `voice` and `raw_voice_text` already exist.
- Contract: `POST /api/inventory/voice/preview {transcript}` -> `{confirmationRequired, intent:{operation, ingredientId, name, quantityMilli, unit}, confidence}`; `POST /api/inventory/voice/apply` with the intent. Errors in the envelope: `voice_parse_failed`, `voice_confirmation_required`.
- Mobile never applies a low-confidence intent without the User confirming.

## Decisions

- Confidence is a number in 0..1 computed by the parser from evidence: ingredient name matched + consume verb + explicit amount (fraction or quantity) is high; name matched with a vague amount is low. `confirmationRequired = confidence < 0.8` (named constant).
- Apply body: `{transcript, intent, confirmed}`. The server re-derives confidence from the transcript and never trusts a client-sent confidence: if confirmation is required and `confirmed != true` -> `voice_confirmation_required`.
- No parseable intent -> `voice_parse_failed` (422).

## Tasks

- [x] T1 API: preview/apply contract, confidence, error codes, tests (RED first). Route: delegated writer.
- [x] T2 Mobile: `inventoryApi` voice calls, store action, fixtures, tests. Route: delegated writer.
- [x] T3 Mobile: confirm sheet + screen wiring; low-confidence never applies without confirm (fixture-driven test). Route: delegated writer.

## Acceptance criteria

- [x] preview returns `{confirmationRequired, intent, confidence}` camelCase; `voice_parse_failed` in the envelope.
- [x] apply subtracts with trigger `voice` and the raw transcript; unconfirmed when required -> `voice_confirmation_required`.
- [x] Mobile never applies a low-confidence intent without confirmation; tested against fixtures.

## Checks

API (apps/api): `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix test`. Mobile (apps/mobile): `npm run lint`, `npm run typecheck`, `npm test`.

## Progress

| Task | Commit | Evidence |
| --- | --- | --- |
| merge origin/main (brings #42) | b350518 | api_error_test conflict resolved, format clean |
| T1 API contract | cfd7efc | RED 12 failing service tests; GREEN full suite 1522 passed, 0 failed, 20 skipped; spot check 470 passed |
| T2+T3 mobile | see git log | RED 8 failing store/api tests, GREEN 214 inventory tests; lint 0 errors, typecheck clean, npm test 1700 passed |

## Notes

- Apply also requires `confirmed: true` when the client intent differs from the transcript re-parse.
- FEFO runs per source kind (planned, then extra), not globally.
- Old VoiceParserPort/RuleBased/AI parsers are now unused by the service; removal is a separate decision.
- apply returns `{ingredientId, quantityDeltaMilli (negative), mutationEvents[]}`.
- `authService.test.ts` reads the ApiError rows after the "Planning channel" comment to the end of `@codes`; the channel block now sits last so cooking and voice rows no longer count as channel codes.
- Voice sheet takes a typed transcript; no speech library is wired yet.
- If apply answers `voice_confirmation_required` after a high-confidence preview, the error shows on the entry step (does not move to confirm).

## Review follow-ups

Fixed in this round: C1 (slash fractions), C2 (cuarto de kilo/litro), C4 (comida is not a verb), C5+SP-1 (unit edit needs confirmation).

Not fixed here, tracked as follow-ups: C3, C6/TR-2, TR-1, C7, SP-2, SP-3, SP-4.
