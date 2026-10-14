# Feature: a Slot favorite can be created, and `save_plan` logs its failure

Issues: #208 (bug) and #210, one lane because both change `apps/api/lib/meal_planner_api/services/planning_service.ex`. Base: `main` at `63427df`.

## Objective

1. `PUT /api/planning/slots/favorite` creates a Slot favorite on a slot that holds a Scheduled meal with a recipe, and answers a defined error otherwise.
2. `PlanningService.save_plan/4` reports its failure through `Logger`, without printing the reason.

## Problem

- #208: `PlanningService.toggle_slot_favorite/2` passes `account_id`, `user_id`, `date` and `slot` to `PlanningRepo.toggle_slot_favorite/1`. `SlotFavorite.changeset/2` also requires `scheduled_meal_id` and `recipe_id`, so the insert always returns an invalid changeset, which the service wraps as `{:ok, {:error, changeset}}` and the controller hands to `json/2`. Nothing in the mobile app calls the route.
- #210: the error path of `save_plan/4` runs `IO.puts("DEBUG save_plan final error: #{inspect(reason)}")` (`planning_service.ex:176`). The reason can hold a changeset with plan data, and the line bypasses the logger and its level. Neither caller logs the failure.

## Decisions (triage comments of 2026-10-13, confirmed by the owner)

- A slot with no Scheduled meal answers `meal_not_found` (404). A meal with no recipe answers `meal_without_recipe` (422).
- The controller keeps its flat `{error: "<reason>"}` body. The service returns `{:error, atom}`, never `{:ok, {:error, _}}`.
- #210: replace the line with a `Logger` call rather than delete it.

## Scope and constraints

- Paths this lane owns: `planning_repo.ex`, `planning_service.ex`, `planning_controller.ex` and their three test files, plus this document. Six other lanes run at the same time; their paths (among them `calendar_controller.ex` and its test) are not to be modified.
- The move of #144 and its locking are out of scope (follow-ups of #144).
- Conventional commits, no attribution lines. Push and pull requests are asked for; no merge.

## Tasks

- [x] T1 (#208) — the toggle resolves the Scheduled meal at `(account, date, slot)` and passes `scheduled_meal_id` and `recipe_id` to the repo; `meal_not_found` and `meal_without_recipe` as error tuples; `error_status/1` maps `meal_not_found` to 404. Route: delegated direct (three `lib` files and their tests). Test-first: controller tests for the round trip through `GET /api/calendar`, the slot without a meal and the meal without a recipe; a repo test for the lookup.
- [x] T2 (#210) — `Logger.error` naming the failure without the reason in place of the `IO.puts`. Route: inline (one line and one test). Test-first: a `capture_log` / `capture_io` test on the error path of `save_plan/4`.

Forecast: about 150 authored changed lines. Delivery: two pull requests, the second stacked on the first (`fix/208-slot-favorite-toggle` from `main`, then `chore/210-save-plan-logger` from it), as the lane prompt asks.

## Checks

From `apps/api`, with `MIX_ENV=test`, `MYFOOD_TEST_DB_USERNAME` set to the local role and `MYFOOD_TEST_DATABASE=meal_planner_api_test_issue208`:

- `mix compile --warnings-as-errors`
- `mix format --check-formatted`
- `mix credo --strict`
- `mix test` on the touched test files, then the full suite

## Progress and evidence

- 2026-10-13 — Document created.
- 2026-10-13 — T1 (its commit is the one that adds this line). RED: the three new controller tests failed with `Protocol.UndefinedError` (`Jason.Encoder` not implemented for the tuple `{:error, #Ecto.Changeset<errors: [scheduled_meal_id: ..., recipe_id: ...]>}`), which is the reported bug; the repo test failed on the missing `PlanningRepo.get_scheduled_meal_at/3`. GREEN: the three touched test files 57 passed; full suite 1849 passed, 23 skipped, 0 failed; `mix compile --warnings-as-errors`, `mix format --check-formatted` and `mix credo --strict` clean. The 200 body reaches the client as `{"isFavorite": bool}` (the camelizing plug), unchanged. Not covered by a test: the `{:error, %Ecto.Changeset{}} -> :invalid_payload` branch, reachable only when two toggles of the same slot race on the unique index. Known edge, left as is: the meal is resolved before the favorite, so a favorite on a meal that later lost its recipe answers `meal_without_recipe` and cannot be turned off through this route.
- 2026-10-13 — T1 commit: `b752f2c` on `fix/208-slot-favorite-toggle`. Review assessment of `63427df..b752f2c`: `medium` (`executable_change`), 204 changed lines, `review_due: false` (`under_budget`).
- 2026-10-13 — T2 (its commit is the one that adds this line), on `chore/210-save-plan-logger`. RED: the new `planning_service_test.exs` case failed on `assert printed == ""`, standard output holding `DEBUG save_plan final error: #Ecto.Changeset<...>`. GREEN: `Logger.error("save_plan failed account_id=... failure=...")`, where the failure is the schema and the invalid field names of a rejected changeset, an atom as is, and `unexpected` otherwise. The service test file 17 passed; full suite 1850 passed, 23 skipped, 0 failed; `mix compile --warnings-as-errors`, `mix format --check-formatted` and `mix credo --strict` clean. No `IO.puts` or `IO.inspect` is left under `apps/api/lib`. Not covered by a test: a failure at the proposal step (the changeset that would hold the meals), which the public interface cannot provoke; the generation run failure goes through the same line. Next step: push and the two pull requests.
- 2026-10-13 — T2 commit: `db1a44c`. Pull requests: #250 (`fix/208-slot-favorite-toggle` into `main`) and #251 (`chore/210-save-plan-logger` into the first branch). Next step: the owner reviews and merges.

## Review

- 2026-10-13 — Candidate `63427df..db1a44c` (T1 and T2 in one slice), assessed `medium` (`executable_change`: `planning_repo.ex`), 242 changed lines. The slice was under the budget, and the session stop hook asked for the review anyway. Consent granted by the owner; one lens ran (`review-reliability`); outcome `approved`, acknowledged (lineage `review-109f7b79af5fa43f`). Reviewed boundary: `db1a44c`.
- Advisory findings, none blocking, none applied (later work, to be accepted or dropped by the owner):
  - WARNING — the remove direction is gated on the meal as well, so a favorite on a meal that lost its recipe cannot be turned off through the route, and no test covers it. A favorite cannot outlive its meal: `slot_favorites.scheduled_meal_id` deletes on cascade.
  - SUGGESTION — the branch that maps a repo changeset to `invalid_payload` has no test. `SlotFavorite.changeset/2` declares the unique constraint, so a racing insert does return a changeset.
  - SUGGESTION — in the `save_plan/4` test, `assert log =~ "account_id"` always holds because the message prefix contains `account_id=`; asserting on the `fields=` fragment would prove the field names. The atom and `unexpected` clauses of `failure_name/1` are not exercised, and `capture_log` in an async module can pick up lines of other tests.
