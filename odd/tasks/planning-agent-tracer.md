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
- L7 PR https://github.com/ChordanDev/myfood-monorepo/pull/448 (label `jorge:required`). Independent verifier (sonnet, scratch clone): S1-S14 met, no blockers; advisory 1 (a crashing model call printed the model state with the API key) fixed in `2b7425e3` with a failing-then-passing test; advisory 2 (a killed session keeps its range until the lease lapses) and 3 (per-session caps) left to #432 / the battery. Native review: the user granted it, START refused with `lens_context_budget_exceeded` (11250 lines); no authority created.
- L8 CI fix `b9b170c8`: Dialyzer flagged unreachable `error_code/1` clauses in the channel; the mobile test counting the channel codes now expects 42. Native review split by commit (assess per commit): only the channel commit `f8ce55cf` was due (high); 4-lens review approved and acknowledged (lineage `review-21b1f998f4660c12`, authority burned) with 8 non-blocking findings; the actionable ones go to a follow-up (timeouts reported as `no_active_session`, `session_already_active` replied as `planning_range_locked`, `unknown_error` fallback test). The other commits assessed medium and `under_budget` (not due).
- L9 Jorge round 1 (head `d14e22ce`): 3 confirmed findings, the user chose to fix them here. CD-1 (confirm deleted a meal another Member scheduled during the session) fixed in `82d3894c`: confirm locks the range and refuses with `{:slot_occupied, slots}` (channel `planning_slot_occupied` with details), only inserts, session stays open; the composable Calendar replace was reverted to the base. TR-4 (a database error renewing the lease ended the session) fixed in `db0e7391`: renewal retried next tick, `session_ended` emitted before ending the row; injectable `:lease_store`. CD-3 (client guides documented the removed commands) fixed in the next docs commit. Accepted risks SP-1, SP-6, SP-4 left to the owner; suspects CD-4, TR-1, TR-5 and theoretical findings not fixed.
