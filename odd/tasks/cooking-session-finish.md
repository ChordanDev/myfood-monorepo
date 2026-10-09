# Cooking session finish (issue #35, R4)

## Objective
One tap marks today's Scheduled meal cooked: a Cooking session starts and finishes, Ingredients are consumed from Inventory oldest lot first (FEFO), the meal's open Shopping items leave the list, and the app shows what was consumed and any shortfall. Meals whose day passed uncooked show as skipped.

## Scope
- API: rework the existing legacy cooking start/step/finish (CookingController, CookingService, CookingChannel) to the new contract.
- API: derive `isSkipped` in calendar responses; calendar "today" from `AccountClock.today`.
- Mobile: "mark as cooked" calls start then finish, shows a consumption summary, drops the local mock subtraction.

## Decisions (assistant, from exploration)
- `AccountClock.today/2` (PR #98) already exists; reuse it, no new timezone work.
- Existing FEFO consume (`Persistence.Inventory.apply_delta` -> `subtract_usable_lots_and_log`) is reused; shortage = requested - applied. It still filters `source_kind: :planned`; consuming `:extra` lots is left out of scope (follow-up).
- Mobile plan is still local mocks: mobile calls the API with the plan entry id; tests use fixtures (per the issue). Real ids arrive when the plan is API-backed.

## Acceptance criteria (from #35)
- start refuses a meal not on the Account's today with `cooking_chat_unavailable`.
- finish atomic: `isCooked`, FEFO clamped at zero with shortages, one mutation event per lot (trigger `cooking`), open Shopping items removed; response `{ scheduledMeal, inventoryMutations[], shortages[] }`.
- step records a Cooking step event (camelCase).
- Calendar derives `isSkipped` (date < Account today and not cooked), never with `isCooked`.
- Mobile mark-as-cooked: start then finish, summary shown, mock subtraction gone, fixture tests.
- Error codes `scheduled_meal_not_found`, `cooking_session_not_active`, `cooking_already_finished` in API ApiError and mobile allowlist.

## Tasks
- [x] T1 API: ApiError codes + start refuses non-today (`cooking_chat_unavailable`), ApiError envelope in CookingController. Route: delegated writer.
- [x] T2 API: finish returns `{scheduledMeal, inventoryMutations, shortages}`, removes open Shopping items, FEFO uses Account today. Route: delegated writer.
- [x] T3 API: step camelCase + calendar `isSkipped` + calendar today via AccountClock. Route: delegated writer.
- [x] T4 Mobile: API module, mark-as-cooked wiring, summary UI, error allowlist, fixtures/tests. Route: delegated writer.

## Progress / evidence
T1-T3: commits c7d1bf4, 21dee84 (API suite 1485 passed, format and warnings-as-errors OK; cooking_finish_test 13 passed on spot check). T4: mobile commit (cooking suites 251 passed; full jest fails only on suites missing the phoenix package, an env issue). Limitations: mobile plan ids are mock ids until the plan is API-backed; Home pending confirmation for past meals now errors with cooking_chat_unavailable; :extra lots are not consumed (follow-up).
