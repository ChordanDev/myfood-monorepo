# Feature: idempotent Shopping item derivation on list reads

Branch: `claude/strange-kepler-5720ad` (from `main` at `2e544f4`). No ticket; related to #39 (S1, open, not merged into this branch).

## Objective

Reading `GET /api/shopping-list` any number of times, from any number of concurrent requests, leaves each planned Shopping item stored once, and a failed derivation is visible in the logs instead of silent.

## Problem

`ShoppingService.ensure_shopping_items_from_schedule/3` derives missing Shopping items on every list read with an unlocked check-then-insert: one `Repo.exists?` per shortage line, then an insert. `shopping_items` has no unique index, so two concurrent reads both insert and the list shows a doubled quantity. The function and `prune_past_items/2` end in `rescue _ -> :ok` and the insert result is discarded, so any failure yields a silently incomplete list. #39 makes the race more likely (a read on every focus and filter change, no 7-day cap on the window).

## Evidence gathered before design

- `shopping_items` (`20260322093000_create_inventory_and_shopping_tables.exs:80-129`): `account_id`, `scheduled_meal_id`, `planned_date`, `ingredient_id`, `unit`, `status` are all NOT NULL; only single-column non-unique indexes exist.
- A plain unique index on `(account_id, ingredient_id, unit, scheduled_meal_id, planned_date)` is wrong: `Cart.purchase_line!` (`cart.ex:417-437`) keeps the purchased row as `:checked_out` and inserts a `:pending` remainder with the same key on a partial purchase. The plan-confirm rebuild (`generation/server.ex:844-902`) also inserts a `:pending` row next to surviving `:checked_out`, `:pending_delivery` or `:archived` rows, because `delete_pending_for_window` only wipes `:pending` and `:in_cart`.
- The only transition back into `:pending` is the cart release (`cart.ex:346-347`, `:in_cart` to `:pending`). A `:pending`-only index would let a `:pending` and an `:in_cart` twin coexist and then make the release raise, and `Cart.expire_account/1` runs on every list read.
- `compute_net_shortages/2` emits one line per recipe ingredient with no grouping. Live recipes are unique on `(recipe_id, ingredient_id, unit)`; a recipe snapshot is not constrained.
- The existing existence check ignores status: a row in any status blocks re-derivation.
- No local or reachable production-like database exists to count duplicates in, so the migration assumes they exist: the race has been reachable since the table was created.
- Four test fixtures insert same-key open duplicates (`test/support/cart_fixtures.ex:49-59`, `shopping_service_test.exs:167-189`, `persistence/shopping_test.exs:179-201`, `shopping_repo_delete_pending_test.exs:50-53`).

## Design

### Invariant

At most one open Shopping item (`status` in `pending`, `in_cart`) per `(account_id, scheduled_meal_id, planned_date, ingredient_id, unit)`. Closed rows (`pending_delivery`, `checked_out`, `archived`) are not constrained.

### T2: index and the paths that must respect it

- Migration `20261009…_add_open_planned_key_index_to_shopping_items.exs`, `up`/`down`:
  - `LOCK TABLE shopping_items IN SHARE ROW EXCLUSIVE MODE` so no insert lands between the dedupe and the index build.
  - Dedupe open rows per key: keep one, delete the rest. Order: `in_cart` before `pending` (keeps a live reservation), then oldest `inserted_at`, then `id`. Quantities are not summed: the extra rows are the bug. Log the deleted row count.
  - Partial unique index `shopping_items_open_planned_key_index` with `where: "status IN ('pending', 'in_cart')"`.
  - Must not reference `checkout_session_id`: the migration that adds it has a 15-digit version and runs later on a fresh database.
  - `down` drops the index; deleted duplicates are not restored (they are derived rows).
- `ShoppingItem.changeset/2` gains `unique_constraint` for the index, so changeset inserts return `{:error, changeset}` instead of raising.
- `Cart.purchase_line!`: update the purchased row to `:checked_out` first, then insert the `:pending` remainder. The current order would violate the index mid-transaction.
- Fixtures that insert same-key open duplicates move to distinct keys without changing what their tests assert.

### T3: derivation, prune, rebuild

- Derivation: one query loads the existing `(scheduled_meal_id, planned_date, ingredient_id, unit)` keys for the Account and the meals in the window (status-agnostic, as today); missing lines go in one `insert_all` with `on_conflict: :nothing`. Duplicate keys inside one derivation keep the first line, as today.
- A line that fails the changeset is logged and skipped. If the batch insert raises, it is logged and the lines are retried one by one, so one bad row does not drop the rest.
- Rescue decision: `prune_past_items/2` becomes one `update_all` and loses its rescue (nothing row-specific can fail; a database outage fails the read on the next query anyway). `ensure_shopping_items_from_schedule/3` keeps a single boundary rescue that logs `Logger.error` with the Account id and the exception, then returns `:ok`: a derivation failure degrades the read to the stored items, loudly. T1 records what the current rescues mask.
- Plan-confirm rebuild: its insert becomes an upsert on the index (rebuild values win). Without it, a list read that commits a row between the rebuild's wipe and its insert would turn today's silent duplicate into a failed confirm.

## Tasks

- [x] T1 (delegated, evidence only): run the shopping suites with both rescues temporarily removed; record which tests fail and why. No commit.
  - Route: delegated. No commit.
  - Observed: with both `rescue _ -> :ok` clauses deleted, `mix test test/meal_planner_api/services/shopping_service_test.exs test/meal_planner_api_web/controllers/shopping_controller_test.exs test/meal_planner_api/cart_test.exs` gave `27 passed`, the same as with the rescues in place. No test fails and no exception surfaces: the rescues mask nothing the existing suites exercise, so removing or narrowing them changes no tested behaviour.
- [x] T2 (delegated, writer trigger: migration + schema + cart + fixtures): index, dedupe, constraint, cart ordering, fixtures.
  - Tests: second open row with the same key is rejected; an open row next to a closed twin is accepted; partial purchase still leaves a `:pending` remainder; `in_cart` to `pending` release still works.
  - Migration check on the per-worktree test database: roll back one step, insert duplicate open rows with SQL, migrate, confirm one row per key survives with the documented keep order.
  - Route: delegated. Commit `d58ff7a`.
  - Closed-to-open transitions: `rg` over `lib` found only `Cart.reserve` (`:pending` to `:in_cart`, same row) and the cart release (`:in_cart` to `:pending`). Nothing moves a closed row back to an open status.
  - RED: `persistence/shopping_test.exs` "rejects a second open Shopping item when the first one is pending" and "... is in_cart" both failed with `match (=) failed ... right: {:ok, %ShoppingItem{...}}` (2 of 7 failed). With the index and the fixtures in place but the old cart order, the partial purchase tests failed (`cart_test.exs` physical and online, plus the three HTTP ones in `cart_lifecycle_test.exs` and `mobile_casing_contract_test.exs`) with the remainder insert rejected by `shopping_items_open_planned_key_index`.
  - GREEN: `mix test` gave `1319 passed, 20 skipped`. The partial purchase tests still find the `[200, 700]` `:pending` remainders, and the cancellation and expiry tests still release `:in_cart` to `:pending`.
  - Green before and after (guards, not RED-able without a non-partial index): "accepts an open Shopping item next to closed twins" and "accepts open Shopping items that differ in one part of the planned key".
  - Migration check, rows as `id suffix | planned_date | unit | status | inserted_at`, `deleted_rows=3` logged:
    - Before: `a1|2026-10-20|g|pending|10:00`, `a2|2026-10-20|g|pending|11:00`, `b1|2026-10-20|ml|pending|09:00`, `b2|2026-10-20|ml|in_cart|12:00`, `c1|2026-10-20|unit|pending|10:00`, `c2|2026-10-20|unit|checked_out|09:00`, `d1|2026-10-21|g|pending|10:00`, `d2|2026-10-21|g|pending|10:00`.
    - After: `a1` (oldest of two `pending`), `b2` (`in_cart` wins over an older `pending`), `c1` and `c2` (open next to closed, both kept), `d1` (same `inserted_at`, lowest id).
    - The parent rows created for the check were deleted; every table involved was back to 0 rows.
  - Deviations:
    - The rollback used `Ecto.Migrator.down/4` for version `20261009120000` instead of `mix ecto.rollback --step 1`: the highest version by number is the 15-digit `202606070000000`, which is the one `--step 1` would have rolled back.
    - `test/support/cart_fixtures.ex` plans its second Shopping item for a second Scheduled meal, tomorrow's dinner. A second meal today broke three tests in `mobile_casing_contract_test.exs` (outside the edit surface) that expect one meal today and a free lunch slot.
    - The constraint error is attached to `:ingredient_id`.
- [x] T3 (delegated, same writer): idempotent derivation, prune, logged rescue, rebuild upsert.
  - Tests: two derivations of the same schedule store each item once (deterministic, bypassing the existence check); concurrent list reads on real connections store each item once; a failing line does not drop the others and is logged; the list read survives a derivation failure; rebuild upsert replaces a conflicting open row.
  - Route: delegated. Commit `74598e7`.
  - New functions: `Persistence.Shopping.planned_item_keys/2` and `insert_planned_items/2` (the set-based insert), `Data.ShoppingRepo.upsert_open_shopping_item/1` (used by `insert_cart_items`). `insert_all/3` on the schema generates the binary id; the timestamps are set by hand.
  - RED: 11 of 20 failed before the implementation. The five `insert_planned_items/2` tests and the five `upsert_open_shopping_item/1` tests failed with `UndefinedFunctionError`; "still answers with the stored Shopping items when the derivation fails" failed with `Assertion with =~ failed, left: "", right: "shopping item derivation failed"`.
  - RED, concurrent reads: with the index rolled back (the behaviour of the base), "read at the same time stores each planned Shopping item once" failed 3 runs out of 3 on `assert Enum.sort(keys) == Enum.sort(expected)`, with duplicated keys stored. With the T2 index alone the test is already green, because the old derivation discards the rejected inserts; T3 keeps it green without relying on discarded errors.
  - GREEN: the three new files and `server_test.exs` gave `83 passed`; `shopping_derivation_test.exs` passed 8 runs out of 8 and left 0 rows in every table it writes, with `immutable_recipe_version_delete` enabled.
  - Green before and after (guard): "derives each planned Shopping item once and a second read adds none".
  - Deviations and additions:
    - The concurrent test runs on `Sandbox.checkout(Repo, sandbox: false)` connections, as preferred. Scheduling a meal freezes a recipe version that a trigger makes undeletable, so its cleanup disables `immutable_recipe_version_delete` inside its own transaction to delete the recipe it created.
    - The one-by-one retry has no rescue of its own: a line the changeset maps to an error is logged and skipped, anything else is raised to the boundary rescue, which logs it and ends that derivation.
    - The rows are sorted before the batch insert so concurrent reads take the index entries in the same order.
    - `upsert_open_shopping_item/1` passes `returning: true`, so the returned struct is the stored row.
- [x] T4: `mix format --check-formatted`, `mix compile --warnings-as-errors`, `mix test` in `apps/api`; this document updated with evidence.
  - `mix format --check-formatted`: exit 0, no output.
  - `mix compile --warnings-as-errors`: exit 0.
  - `mix test`: `1332 passed, 20 skipped`. The skipped tests are the suites gated on a fresh isolated database (`cart_concurrency_test.exs` among them); they use `CartFixtures`.
  - Parent spot check: the three commands re-run with the same results. The gated suites were then run with `MIX_ENV=test mix run --no-start test/support/issue38_concurrency_runner.exs` on a fresh database it created and migrated from zero (`cooking_atomicity_test.exs` and `cart_concurrency_test.exs`): `18 passed`, with the changed fixture and the new purchase order.
- [x] T5 (inline, one mechanical line plus its test): the rebuild upsert also replaces `reservation_token`, so a reserved item it turns back to `pending` does not keep a stale reservation, as the cart release already does.
  - RED: both "replaces the … Shopping item that has the same planned key" tests failed on `assert stored.reservation_token == nil` (`3/5 passed`). GREEN: `mix test` gave `1332 passed, 20 skipped`; format and compile checks exit 0.
- [x] T6 (inline, two test files): the two advisory findings of the first review, accepted by the user.
  - `R3-batch-path-unproved`: "stores each planned line once when called twice with the same lines" now refutes the `shopping planned items batch insert failed` log, so a batch that always falls back to the one-by-one retry fails the test.
  - `R3-prune-failure-untested`: "archives past-dated pending items on every call" now asserts the same row is archived in place with its quantity and `inserted_at` kept and `updated_at` advanced.
  - RED by mutation (reverted with `git checkout -- lib`): with the batch statement replaced by a raise and `updated_at` dropped from the prune update, both tests failed (`16/18 passed`). GREEN on the real code: `mix test` gave `1332 passed, 20 skipped`; format and compile checks exit 0.

## Checks

Run in `apps/api` with `MYFOOD_TEST_DB_USERNAME=luccagiordana MYFOOD_TEST_DB_PASSWORD="" MYFOOD_TEST_DATABASE=meal_planner_api_test_shopping_dedupe`.

Test-first applies to T2 and T3: each new test is observed failing before its implementation.

## Review

RDD is on (global). One whole-branch review at the end, base `2e544f4`.

- First review, at `66deff2`: granted, lens `review-reliability`, approved and acknowledged (lineage `review-3bd4efcaa8836950`). Two advisory findings, both applied in T6. The T6 commits change the candidate, so the branch asks for a review again.

## Out of scope, noted

- Stale Shopping items after a scheduled meal is moved or its recipe swapped (`Calendar.upsert_scheduled_meal` updates in place).
- Dead code: `ShoppingCheckout.sync_from_planning`, `ShoppingRepo.upsert_shopping_item`, `ShoppingService.build_shopping_list_from_schedule`.
- Controller tests that send `start_date`/`end_date` while the service reads `from_date`/`to_date`.

## Noticed, left alone

- The dedupe keeps one row per key even when two twins are both `in_cart`: the deleted one disappears from a live Cart, and a purchase that still names it answers `:item_not_found`.
- The existence check counts every status and the insert only skips open rows: a key stored, reserved and fully bought between the two steps of one read would be derived again.
- `prune_past_items/2` still takes a `from_date` it does not use.

## Progress

T1 to T6 are done on `claude/strange-kepler-5720ad`: `d58ff7a` (index, constraint, cart order, fixtures), `74598e7` (derivation, prune, logged rescue, rebuild upsert) and the follow-up commit that clears the reservation token in the rebuild upsert, plus the commits that record this document. All three checks pass on the per-worktree test database. Nothing is pushed.

Authored changed lines are 937 against the 400 heuristic (882 added, 55 deleted): 327 in `lib` and the migration, 610 in tests.

Next step: the review of the branch with T6 on top, then the pull request, which is the user's decision.
