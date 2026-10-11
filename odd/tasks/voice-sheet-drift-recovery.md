# Feature: Voice sheet recovers from a drifted auto-apply and shows the applied amount (issue #156)

Ticket: ChordanDev/myfood-monorepo#156, a follow-up of #44 (PR #141).
Base: `main` at `7d4221b`. Branch: `fix/voice-sheet-drift-recovery`.

## Objective

`InventoryVoiceSheet` never leaves the User on a dead end after an auto-apply the server refuses, and its done message states what the server subtracted.

## Problem

Both are in `apps/mobile/src/features/inventory/components/InventoryVoiceSheet.tsx`.

- When the preview needs no confirmation the sheet applies with `confirmed: false`. If the stock changed between preview and apply, the server parses a different quantity and answers `voice_confirmation_required`. The sheet stays on the entry step with "Confirmá el ajuste antes de aplicarlo." and no Confirm button.
- The done step renders the previewed intent, not the API's `quantityDeltaMilli`. When the server caps the subtraction at the stock, the message overstates what was subtracted.

## Scope and constraints

- In scope: the voice sheet, the store's `applyVoice` return value, their tests and fixtures.
- Out of scope: the API (#155, #157), retry safety of apply (#140), other Inventory follow-ups (#116), a length limit on the field.
- No new user-facing copy: the recovery reuses the confirm step.

## Decisions

- **D1 Recovery re-runs the preview.** The issue allows either moving to the confirm step or re-running the preview. On `voice_confirmation_required` from the auto-apply, the sheet previews the same transcript again and shows the confirm step with the fresh intent, whatever its confidence. The intent of the first preview is stale by then, so confirming it would show an amount the server no longer agrees with. The sheet never auto-applies a second time, so it cannot loop.
- **D2 A failed second preview is an ordinary error.** It shows on the entry step like any failed preview.
- **D3 The done step shows the applied amount.** `-quantityDeltaMilli` of the apply result, with the unit and name of the applied intent.

## Tasks

- [x] **T1 `applyVoice` returns the apply result and the done step shows the applied amount.** Route: delegated direct. The done step holds what was subtracted (`name`, `unit`, `-quantityDeltaMilli`) instead of the previewed intent, and both apply paths go through one `apply` helper.
- [x] **T2 The sheet recovers from `voice_confirmation_required` on the auto-apply path.** Route: delegated direct. Only the auto-apply catches the code; the confirm path and every other error behave as before.

Both tasks are in the commit that adds this document, `fix(mobile): recover the voice sheet from a drifted auto-apply`. They share `handlePreview`, so they were not split.

## Acceptance criteria

- On `voice_confirmation_required` from the auto-apply path, the sheet moves to the confirm step with a fresh preview.
- `applyVoice` returns the apply result and the done step shows the applied amount.
- Sheet tests cover both cases.

## Checks

- `npx jest src/features/inventory`
- `npm test`, `npm run typecheck`, `npm run lint` in `apps/mobile`

## Progress

Both tasks done on 2026-10-11.

- RED observed before the change: `npx jest src/features/inventory`, 7 failed of 224 (the store resolved `undefined`; the done step said 500 g for a capped apply on both paths; no second preview after a refused auto-apply, in the sheet and through the screen; a failed second preview).
- GREEN: `npx jest src/features/inventory`, 14 suites and 224 tests passed. eslint and prettier clean on the touched files.
- Environment gap, not this change: `node_modules/phoenix` is missing on this machine, so `npm test` fails two suites of `src/api/socket`, `npm run typecheck` reports three `TS2307` there and `npm run lint` stops at eslint with three `import/no-unresolved`. Everything else passes: 145 of 147 suites, 2210 tests.

## Open questions

- If the API answers `quantityDeltaMilli: 0`, the done step reads "Descontamos 0 g de Arroz de tu inventario.". No copy was added for that case.
