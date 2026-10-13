# Feature: Planning context carries onboarding signals and preselected favorites (P7)

Ticket: ChordanDev/myfood-monorepo#29 (part of #3). Review level set by the owner on the issue: RDD is enough.
Branches: `feat/planning-context-1-api`, `feat/planning-context-2-mobile`.

## Objective

Starting a plan hands the engine a Planning context with the User's Diet, Hard restriction codes, Soft preferences, Cooking skill, Household size, Slot cooking times and the Favorite recipes they preselected, and the Planner screen lets the User pick those favorites before starting.

## Problem

`start_planning` hands the engine only the date range and the free-text request, so proposals ignore everything the User set up during onboarding and every recipe they starred.

## Scope and constraints

- Engine off-limits: the Planning candidate builder, the Optimizer port and fallback, the Generation run server internals and the Planning session server internals belong to another developer. This ticket only assembles the map handed to `Generation.Server.start_generation/4`.
- The strict candidate filter does not change (O5 pending). Hard restriction codes travel as text only.
- Prepared leftovers are not part of the context (S9).
- In scope: the planning channel handler, a new context assembly module, CHANNELS.md, the frozen fixture, and the mobile planner feature.

## Evidence (exploration, 2026-10-13)

- `start_planning` is `apps/api/lib/meal_planner_api_web/channels/planning_channel.ex:412-493`. Inbound keys are snake_cased, so `favoriteRecipeIds` arrives as `"favorite_recipe_ids"`. Everything that can fail sits in the `with` before `start_session`.
- The constraints map has snake_case string keys (`"date_from"`, `"date_to"`, `"request"`), built by `start_constraints/3` (:789).
- Extra keys survive untouched: `PlanningRequestValidator.validate_request/3` only rewrites `participant_ids`, `Server.put_window` only rewrites date and slot keys, and `create_run` stores the whole map under `input_context.constraints`. Nothing in the engine matches the map exactly.
- Signals: `UserPreferencesService.get/1` (Diet, Hard restriction codes as text, Soft preferences); `users.household_size` and `users.cooking_skill` (`AccountRepo.get_user/1` for a fresh read, `socket.assigns.current_user` is a connect-time snapshot); `AccountRepo.list_slot_cooking_times/1` (breakfast, lunch and dinner only, minutes 0..240, plus Hunger level); `RecipeRepo.list_favorite_ids/1` (scoped by Account and User).
- The stored Slot cooking times never hold a snack, so the snack is always missing.
- `PlannerFixtures.check!/3` (`apps/api/test/support/planner_fixtures.ex`) writes its JSON into `apps/mobile/src/features/planner/fixtures/`. The eight existing fixtures are payloads the client receives; the context is the first one the client never sees.
- The strict candidate filter reads only Excluded ingredients and slot suitability. It never reads Hard restrictions, Diet or favorites.
- Mobile: `buildStartPlanningParams` (`domain/startPlanning.ts`), `usePlanningDraft.start(range, request, onAccepted?)` with `lastStartRef` feeding `retry`, `PlanningDraftPanel` idle state is only the start button, the favorites store (`useFavoritesStore`, `load()`) is loaded only by the favorites screen. `PlannerScreen.planning.test.tsx` mocks the planner components barrel, the icons and the theme tokens explicitly and compares the pushed payload with `toEqual`.
- CodeGraph refused this worktree root as unsafe, so the mapping used plain search.

## Design

### Where the context sits

The context is one nested map under the `"planning_context"` key of the constraints, next to `"date_from"`, `"date_to"` and `"request"`. It is persisted at `input_context.constraints.planning_context`. Its own keys are camelCase strings, which is the documented contract for the engine owner.

### Shape

```json
{
  "diet": "vegetarian",
  "hardRestrictionCodes": ["gluten", "peanut"],
  "softPreferences": ["quick_meals"],
  "cookingSkill": "intermediate",
  "householdSize": 3,
  "slotCookingTimes": {
    "breakfast": {"cooking": "limited", "maxMinutes": 15, "hungerLevel": "light"},
    "lunch": {"cooking": "do_not_cook", "maxMinutes": 0, "hungerLevel": "normal"},
    "snack": {"cooking": "no_constraint", "maxMinutes": null, "hungerLevel": null},
    "dinner": {"cooking": "limited", "maxMinutes": 45, "hungerLevel": "strong"}
  },
  "favoriteRecipeIds": ["<uuid>"]
}
```

- Every key is always present. `diet`, `cookingSkill` and `householdSize` are `null` until the User sets them.
- `slotCookingTimes` always has the four Meal slots. A slot with no stored time is `no_constraint`, a stored 0 is `do_not_cook`, anything else is `limited`. The snack is never stored, so it is always `no_constraint`; a User who saved no times gets `no_constraint` on all four.

### Favorites from the client

- `favoriteRecipeIds` is optional. Absent means none. Anything that is not a list of strings replies `invalid_payload` before a session starts.
- The ids are intersected with the caller's own favorites and deduplicated, keeping the client's order. An id that is not a favorite of the caller is dropped, because a stale client cache is a normal condition and the engine must never receive a recipe id the caller does not own.

### Mobile

- `StartPlanningParams` gains optional `favoriteRecipeIds`, omitted when nothing is selected.
- `usePlanningDraft.start` takes the selected ids and `retry` replays them.
- The idle state of the planner shows the favorites as selectable chips above the start button. The step is hidden when the User has no favorites. The planner loads the favorites store itself.

## Tasks

- [x] T1 (API, route: delegated direct, 2+ non-trivial files): `MealPlannerApi.Services.PlanningContext` assembles the context from already-read signals (pure) and reads them for a User; unit tests cover every signal, the nil cases and the three cooking modes.
- [x] T2 (API, route: delegated direct, same writer): `start_planning` parses `favoriteRecipeIds`, keeps only the caller's favorites and hands the context to the generation; channel tests read it back from the persisted Generation run; fixture `planningContext.json` recorded through `PlannerFixtures.check!`; CHANNELS.md documents the param and the context.
- [ ] T3 (mobile, route: delegated direct, 2+ non-trivial files): `StartPlanningParams`, `buildStartPlanningParams` and `usePlanningDraft.start`/`retry` carry `favoriteRecipeIds`; unit tests.
- [ ] T4 (mobile, route: delegated direct, same writer): favorites preselect step on the Planner screen fed by the favorites store; integration test in `PlannerScreen.planning.test.tsx`.

## Acceptance criteria

- [ ] `start_planning` accepts `favoriteRecipeIds` and the context payload persisted on the Generation run includes every listed signal with camelCase keys documented as a frozen fixture.
- [ ] A missing `snack` Slot cooking time is passed as "no constraint", a slot with 0 minutes as "do not cook".
- [ ] Hard restriction codes reach the context as text; the strict candidate filter is unchanged (O5 pending).
- [ ] Planner screen offers the favorites list (R3) as a preselect step; integration test covers it.

## Checks

API (from `apps/api`, with `MYFOOD_TEST_DB_USERNAME` and a per-worktree `MYFOOD_TEST_DATABASE`): `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix credo --strict`, `mix sobelow --config`, `mix dialyzer --format short`, `mix test`. Mobile (from `apps/mobile`): `npm run verify`.

## Delivery

Forecast: about 500 authored lines for the API half and about 400 for the mobile half, over the 400-line review budget as one PR. Strategy: a stacked-to-main chain of two PRs, the same shape as the #46 stack (PRs #238 to #241). Slice 1 holds T1 and T2 (`b5b7996`, `29c0f13`; 926 authored lines, about 670 of them tests, so it carries a size exception), slice 2 holds T3 and T4. Each half is safe alone: the API treats an absent `favoriteRecipeIds` as none, and an API without this change ignores the extra key.

## Progress

Exploration done. Feature document created.

- T1 (delegated writer): `PlanningContext.assemble/1` (pure) and `PlanningContext.read/3` (loads the signals; a deleted User gives `null` skill and size; a stored `snack` row would be ignored). RED: 0 of 18 passed, `PlanningContext.assemble/1 is undefined`. GREEN: 18 passed. Commit `b5b7996`, 488 authored lines, 352 of them tests.
- T2 (delegated writer): `parse_favorite_recipe_ids/1` and the context read sit in the `with` before `start_session`; `start_constraints/4` adds `"planning_context"`. RED: 8 failures in the new `planning context (#29)` block (context absent; a malformed list was accepted). GREEN: `planning_start_test.exs` 44 passed, `planner_fixtures_test.exs` 5 passed. Tampering `householdSize` in the fixture made the fixture test fail with the drift message. Commit `29c0f13`, 438 authored lines, 315 of them tests.
- Checks observed on `29c0f13`: `mix format --check-formatted` clean, `mix compile --warnings-as-errors` clean, `mix credo --strict` no issues, `mix sobelow --config` exit 0, full `mix test` 1872 passed and 23 skipped. Parent spot check: the two new test files, 23 passed.
- `mix dialyzer --format short` failed locally with 9 `call_without_opaque` errors, none in a file this work touches (`accounts.ex`, `planning_repo.ex`, `generation/server.ex`, `persistence/calendar.ex`, `onboarding_service.ex`, `shopping_service.ex`, `user_preferences_service.ex`). The local toolchain is Elixir 1.20.3 on OTP 29 and CI pins 1.17.3 on OTP 27.3, so CI is the check of record for dialyzer. Not verified on a clean base locally.
- Native review of slice 1 (`6812bd0..29c0f13`): assessed medium, `slice_budget_reached`; consent granted by the user; one reliability lens; approved and acknowledged (lineage `review-9ec5a049a18f936d`). Reviewed boundary is now `29c0f13`.

## Notes and follow-ups

Advisory findings of the slice 1 review, none blocking and none applied:

- Favorite ids are matched by exact string, so an id in upper case is dropped. The mobile client sends the ids the API gave it, which are lower case.
- `favoriteRecipeIds` has no length cap; the frame size is the only bound. A cap is a contract decision that was not taken here.
- The fixture pins `hardRestrictionCodes` in catalog order while two tests compare sorted. The order is deterministic (`UserPreferencesService` filters the catalog list), so the fixture is stable; the tests are only looser than they could be.
