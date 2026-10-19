# Feature: API `e2e` environment with a deterministic login code, AI client and seed (issue #376)

Ticket: ChordanDev/myfood-monorepo#376, part of #365. Base: `main` at `8587792b`. Branch: `feat/376-e2e-environment`.
Delivery: one PR, stacked under #377. Test runner: `mix test` in `apps/api`.

## Specs

- **S1** `apps/api/config/e2e.exs`, loaded by the existing `import_config "#{config_env()}.exs"`. `MIX_ENV=e2e mix compile` succeeds with warnings as errors.
- **S2** "`runtime.exs` accepts `AI_CLIENT=mock` only when `config_env() == :e2e`. `dev` and `prod` still raise as today."
- **S3** "In `:e2e` only, requesting a code for `E2E_LOGIN_EMAIL` issues `E2E_LOGIN_CODE` instead of a random code. Any other email behaves as in `dev`. Outside `:e2e` both variables are ignored."
- **S4** "In `:e2e`, the access token TTL can be shortened with `E2E_ACCESS_TOKEN_TTL_SECONDS` (default unchanged, `1 hour` in `config.exs`)."
- **S5** An idempotent seed script (`priv/repo/e2e_seeds.exs`) that creates the Account, a User for `E2E_LOGIN_EMAIL` with onboarding completed and the catalog Recipes the Planning journey needs. After the seed, signing in skips onboarding and a Planning session gets a proposal that can be confirmed.
- **S6** "Running the login flow several times in a row does not hit the email code request limits, or the docs say how the seed resets them."
- **S7** Email delivery uses `Bamboo.LocalAdapter`, as in `dev`.
- **S8** "`apps/mobile/e2e/README.md` backend steps point at `apps/api` with `MIX_ENV=e2e` and the seed script."

## Decisions

- **D1 The fixed code skips the request limits for `E2E_LOGIN_EMAIL` only.** Each Maestro flow signs in, so `all` signs in four times within minutes and the 60-second cooldown would refuse the second. The exemption only exists where `:e2e_login` is set, which `runtime.exs` does in `:e2e` only. Login flow only: sign-up and invite codes are random as before.
- **D2 Proposals come from the real optimizer.** `Generation.Server` calls `OptimizerServer` directly and never the AI client, so `AI_CLIENT=mock` does not drive Planning. The `e2e` environment runs the OR-Tools optimizer like `dev`; `lib/meal_planner_api/generation/` is untouched (#350 may change it in parallel).
- **D3 The seed resets the journey data** of its Account (Planning sessions, Scheduled meals, Shopping list, Cart, Inventory, favorites) and the login codes of its email, and keeps device sessions, so the flows can run again after it.

## Tasks

- [x] **T1** S1-S8. Route: inline (no writer trigger). Commit: `31619a9b`.
- [x] **T4** Jorge second pass F1 and F2 (PR #380). Route: inline. Commit: see `## Log` L10.
- [x] **T3** Jorge SP-1 and SP-2 (PR #380). Route: inline. Commits: see `## Log` L8.
- [x] **T2** Verifier blocker B1 (S2): `MealPlannerApi.AI` refused `MockClient` outside `:test` at call time. Route: inline. Commit: see `## Log` L6.

## Log

- **L1** (2026-10-19) User request: implement #376 then #377, one stacked PR each; prove neither test double can be selected outside `:e2e`; keep request limits and login behaviour unchanged for every other email and environment; do not edit `apps/api/lib/meal_planner_api/generation/`.
- **L2** RED: `test/config/runtime_config_test.exs` 10/23 failed before `runtime.exs` changed; `email_code_login_e2e_test.exs` 5/8 failed before the service changed. GREEN after.
- **L3** Live run on `MIX_ENV=e2e` (port 4100, Python 3.12 venv with `ortools==9.12.4544`): six logins in a row with the fixed code, `/api/me` onboarding complete, `start_planning` → `proposal_ready` from the optimizer, confirm 200, Shopping list with six items. With `E2E_ACCESS_TOKEN_TTL_SECONDS=2` the access token lives 2 s and `/api/me` answers 401 after 3 s. Seed run three times on a fresh database: same rows (timestamps aside).
- **L4** Found while running: OR-Tools 9.12 has no wheels for Python 3.14, and the first start after creating the venv can time out the optimizer handshake. Both documented in the E2E README.
- **L5** RDD: assessed `medium` (`under_budget`); review granted by the user, lenses risk and reliability, approved and acknowledged for `31619a9b`.
- **L6** Independent verifier: S1, S3, S4, S6, S7, S8 met; S5 met but reworded from the issue ("a proposal from `MockClient`") by D2, pending the user's sign-off; blocker B1: `AI_CLIENT=mock` was accepted in `:e2e` but `MealPlannerApi.AI.client/0` answered `:ai_mock_client_forbidden` outside `:test`. Fixed with `AI.mock_client_allowed?/1` (`:test` and `:e2e`), RED then GREEN in `ai_mock_client_env_test.exs`; a live `MIX_ENV=e2e AI_CLIENT=mock` call now answers through the mock. Advisories taken: a test that sign-up codes stay random for the e2e email, and a clearer seed guard message. Full suite: 2265 passed, 40 skipped.
- **L7** (2026-10-19) Jorge review of PR #380: CHANGES REQUESTED. SP-1 (blocker): `config/e2e.exs` read `DB_NAME`, the variable `dev` uses, so a developer with `DB_NAME=meal_planner_api_dev` exported would seed and drop the dev database. SP-2 (theoretical): `e2e_login_code/2` trusted `:e2e_login` with no environment guard of its own. CD-1 rejected. User: "arregla todos".
- **L8** SP-1: `config/e2e.exs` reads `MYFOOD_E2E_DATABASE` (default `meal_planner_api_e2e`); the seed refuses a database whose name does not end in `_e2e`; README updated. RED: `test/config/e2e_config_test.exs` 2/3 failed (`DB_NAME=meal_planner_api_dev` gave `meal_planner_api_dev`). Live: the seed refuses `meal_planner_api_dev` and `meal_planner_api_e2e_376x`, and seeds `check376_e2e`. SP-2: `EmailCodeLogin.e2e_login_allowed?/1` (`:test`, `:e2e`) gates `:e2e_login`; RED 2 failures before. The seed journey test now gives the `start_planning` reply 2 s (it failed at the default 100 ms). Full suite: 2270 passed, 40 skipped; credo, sobelow, compile clean.
- **L9** (2026-10-19) Jorge second pass of PR #380 on `f9368234`: APPROVED, SP-1 and SP-2 hold. F1 (low): the README promised the cleanup could not reach the dev database, but only the seed checked the `_e2e` suffix, so `MYFOOD_E2E_DATABASE=meal_planner_api_dev` plus `ecto.drop --force` would drop it. F2 (low): the seed's `_e2e` guard had no automated test. Option (b) closes both. User: "Si, arregla".
- **L10** `config/e2e.exs` raises when the e2e database name does not end in `_e2e`, so every `MIX_ENV=e2e` command fails before it connects; README sentences now say so. RED: `e2e_config_test.exs` "refuses a database whose name does not end in _e2e" failed (nothing raised), GREEN after. Live: `MIX_ENV=e2e MYFOOD_E2E_DATABASE=meal_planner_api_dev mix ecto.drop --force` raises before connecting. Full suite 2271 passed, 40 skipped; credo, sobelow, compiles clean.
