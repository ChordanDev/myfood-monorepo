# Feature: planning agent tracer bullet (#423)

Objective: a Member plans a date range by talking to the planning agent and confirms the Proposal into Scheduled meals, from the terminal chat and over `planning:<account_id>`.
Branch: `feat/423-planning-agent-tracer` from `origin/feat/planning-agent` (`da141356`); PR into `feat/planning-agent`. Delivery: one PR, work-unit commits (owner asked for one PR). Test runner: `mix test` in `apps/api`.
Source: `vicenzogiordana/myfood` at `d9b965a` (frozen, read-only reference).

## Specs

Quoted from issue #423 (acceptance criteria and owner decisions).

- S1 "A Member can run the whole path from the terminal chat against a real Account and get Scheduled meals saved."
- S2 "The `planning:<account_id>` channel supports start session, consent, send message and confirm, with channel tests. The agent replaces the old handlers on the branch; there is no `planning_agent:*` topic."
- S3 "The model is Claude Haiku 5.5. It is set through configuration, so a cheaper model can be swapped in later after the quality battery (#435) is re-run."
- S4 "AI-processing consent is asked once per User, the first time they plan, and stored. A User who already consented is not asked again, in any Account."
- S5 "Spend caps are read from configuration and are the same for every Account. The values are placeholders until the quality battery measures the real cost per session."
- S6 "Eligibility (#397): a Planning session can be joined and started only by an eligible Account, whatever `REVENUECAT_ACCESS_ENFORCEMENT` says. The check runs at join and at start."
- S7 "Restrictions of every Participant are read from `ingredients.allergens` plus the diet marks (#441, Part A). An unreviewed Ingredient (`allergens` NULL) counts as carrying every code. The agent never pins or proposes an excluded recipe."
- S8 "Only breakfast, lunch and dinner are planned."
- S9 "The session budget follows #430's rule: `BudgetService.weekly_limit_cents(account_id)` (the Account's budget, or the tier default when it is 0) x days / 7. The core exposes it to the proposal validator. There is never "no budget"."
- S10 "Confirming writes Scheduled meals; the Shopping list is derived from them by the existing rebuild."
- S11 "Confirmed plans respect this repo's rules for final meals (cooked or confirmed not cooked) and the Budget's owner minimum."
- S12 "Agent migrations (consents, confirmations, agent flag on Planning sessions) use new timestamps. The consent text has a legal review before release (Argentina, Ley 25.326, health data); until then it is a placeholder."
- S13 Tools: "four tools: search recipes, run optimizer, present proposal, ask human."
- S14 Owner decision (2026-10-22, from planning): consent, confirm and the approvals go over the `planning:<account_id>` channel, as in myfood; confirmation is idempotent through the confirmations table and `confirmation_status`. Recorded as ADR 0007, the planning exception to ADR 0004.

## Tasks

- [x] T1 Import the agent core from myfood@d9b965a (S3, S5, S13). Route: inline. Commit `590cbfe0`.
- [x] T2 Adapt the core to this repo: consent per User, household context with restrictions and diet marks, budget rule, meal slots, optimizer v2, Claude Haiku 5.5 config (S3-S9, S13). Route: inline. Commit `ffa1fda8` (with T4).
- [x] T3 Terminal chat mix task (S1). Route: inline. Commit `99e25d41`.
- [x] T4 Confirmation into Scheduled meals, idempotent (S10, S11, S12, S14). Route: inline. Commit `ffa1fda8`.
- [x] T5 `planning:<account_id>` channel: replace old handlers, eligibility at join and start (S2, S6, S14). Route: inline. Commit `f8ce55cf`.
- [x] T6 Docs: CHANNELS.md, ADR 0007, GLOSSARY, README (S2, S12, S14). Route: inline. Commit `c96ed946`.

## Log

- L1 (2026-10-22) User request: "Implement issue #423 of ChordanDev/myfood-monorepo: "Planning agent: tracer bullet from "plan my week" to a confirmed plan". [...] The issue and its comments are the source of truth; where they disagree with it, follow the issue. [...] Open the pull request and report the link. Do not merge."
- L2 Size: large (several deliverables, does not survive compaction). Writer trigger: none, parent writes inline.
- L3 Decisions while adapting (2026-10-22): thin port modelled on myfood's tracer commit `b6675a2` plus the mature `d9b965a` leaf modules (Claude adapter, spend ledger, call bounds, concurrency limiter, allowance, loop). Recovery after restart, absence grace and idle expiry left to #432. Dislikes are preferences (#421 decision 13); allergy exclusions are hard. Estimated cost comes from the frozen recipe version (`recipe_daily_costs`), same source as the legacy planner, until #430. Over-budget Proposal is `requires_approval` and confirm refuses `approval_required` (approval arrives with #430). Start refuses a range with any Scheduled meal (legacy rule); confirm replaces the range through `Calendar.replace_scheduled_meals_multi/4`, which keeps final meals. Session renews its lease every minute up to the 30-minute cap and ends when its last subscriber leaves. Haiku 5.5 long-context tier (x5 over 100K prompt tokens) added to the adapter.
- L4 Evidence: `mix test` 2567 passed, 46 skipped (before the channel work); `mix credo --strict` no issues; `mix compile --warnings-as-errors` clean.
- L5 Channel (2026-10-22): commands `start_session`, `give_consent`, `send_message`, `stop`, `cancel_session`, `confirm`, `confirmation_status`; events pushed as `agent_event` to the socket that started the session. Join and start check `AccountAccess.eligible?/1` always. New `ApiError` codes added in lockstep to the mobile allowlist. Known break on this branch until #424: the mobile planner screen and its Maestro flows still send `start_planning`; the fixtures recorded from it stay frozen.
- L6 Evidence: `mix test` 2514 passed, 46 skipped; `mix credo --strict` no issues; `mix format --check-formatted` ok; `mix compile --warnings-as-errors` ok; mobile `jest` (errors contract, api, auth) 276 passed and `tsc --noEmit` clean; local dialyzer shows 6 `call_without_opaque` on `Ecto.Multi.new()`, 5 of them already on the base (same pattern). S1 run by hand: `mix planning.chat --scripted` against a dev Account saved 9 Scheduled meals, committed the session and stored the consent and the confirmation.
