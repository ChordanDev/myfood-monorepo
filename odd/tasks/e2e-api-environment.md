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

- [x] **T1** S1-S8. Route: inline (no writer trigger). Commit: see `## Log`.

## Log

- **L1** (2026-10-19) User request: implement #376 then #377, one stacked PR each; prove neither test double can be selected outside `:e2e`; keep request limits and login behaviour unchanged for every other email and environment; do not edit `apps/api/lib/meal_planner_api/generation/`.
- **L2** RED: `test/config/runtime_config_test.exs` 10/23 failed before `runtime.exs` changed; `email_code_login_e2e_test.exs` 5/8 failed before the service changed. GREEN after.
- **L3** Live run on `MIX_ENV=e2e` (port 4100, Python 3.12 venv with `ortools==9.12.4544`): six logins in a row with the fixed code, `/api/me` onboarding complete, `start_planning` → `proposal_ready` from the optimizer, confirm 200, Shopping list with six items. With `E2E_ACCESS_TOKEN_TTL_SECONDS=2` the access token lives 2 s and `/api/me` answers 401 after 3 s. Seed run three times on a fresh database: same rows (timestamps aside).
- **L4** Found while running: OR-Tools 9.12 has no wheels for Python 3.14, and the first start after creating the venv can time out the optimizer handshake. Both documented in the E2E README.
