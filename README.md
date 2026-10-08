# MyFood monorepo

Single repository for the MyFood product: the Elixir/Phoenix backend, the Expo
mobile app and the product documentation. Each tree was imported with its
original commit history (`git subtree add`), so `git log -- apps/api` and
friends still show the pre-monorepo commits.

## Layout

| Path          | What it is                                                                                  | Source repository                                                                          |
| ------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/api`    | Phoenix API (`meal_planner_api`): planning engine, catalog, shopping, inventory, AI cooking. | [vicenzogiordana/myfood](https://github.com/vicenzogiordana/myfood) (`meal_planner_api/`) |
| `apps/api/optimizer` | OR-Tools meal optimizer (`optimizador.py`) spawned by the API as a stdio Port.        | same repo (was at the old repo root)                                                       |
| `apps/mobile` | Expo 57 / React Native app.                                                                 | [ChordanDev/progra-3-front](https://github.com/ChordanDev/progra-3-front) (`Develop`)      |
| `docs`        | Glossary and ADRs (specs and maps live in GitHub issues).                                   | [ChordanDev/meal-app-docs](https://github.com/ChordanDev/meal-app-docs) (`develop`)        |
| `odd/tasks`   | Feature task documents (Organic Driven Development).                                        | —                                                                                          |

## Running the API (`apps/api`)

Prerequisites: Elixir ~> 1.15 (CI uses 1.17 / OTP 27), PostgreSQL, Python 3
with OR-Tools.

```sh
cd apps/api

# Python optimizer dependency (used by the planning engine).
pip install -r optimizer/requirements.txt

# Database connection (defaults shown; see config/dev.exs).
export DB_USER=postgres DB_PASSWORD=postgres DB_HOST=localhost DB_NAME=meal_planner_api_dev

# Gemini is the AI client outside tests; the key is read at runtime.
export GEMINI_API_KEY=...   # or put it in .envrc.local (direnv, gitignored)

mix setup            # deps.get
mix ecto.create && mix ecto.migrate
mix run priv/repo/seeds.exs   # optional demo data, see below
mix phx.server       # http://127.0.0.1:4000
```

The reference Plans (`individual`, `family_4`, `family_6`, `trial`) are
inserted by migrations, so sign-up works on a database that only ran
`mix ecto.migrate`. The seeds only add demo data (a demo Account, two Users, a
recipe and a scheduled meal): run them once on a fresh development database
(a second run fails on the duplicate demo User) and never in production.

Optional overrides: `OPTIMIZER_PYTHON` (default `python3`),
`OPTIMIZER_SCRIPT_PATH` (default `apps/api/optimizer/optimizador.py`),
`OPTIMIZER_TIMEOUT_MS`. A bare `OPTIMIZER_PYTHON` name is looked up on `PATH`
and an explicit path is used as given; when that does not lead to an executable
file the API refuses to start and logs which value it tried. `apps/api/.envrc` is a
direnv stub that sets safe defaults and sources `.envrc.local` for secrets.

Tests: `mix test` (uses `postgres`/`postgres` on `localhost`, database
`meal_planner_api_test`; override with `MYFOOD_TEST_DATABASE`). The optimizer
has its own suite: `cd optimizer && python3 -m unittest test_optimizador`.

## Running the mobile app (`apps/mobile`)

Prerequisites: Node 20, npm, Expo tooling (Xcode / Android Studio for native
runs).

```sh
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 npx expo start
```

Checks: `npm run lint`, `npx tsc --noEmit`, `npx jest`.

## Docs

The durable docs are `docs/GLOSSARY.md` (ubiquitous language per bounded
context) and `docs/adr/` (architecture decision records). Specs, maps and plans
are GitHub issues (wayfinder / to-spec) and are disposable once the work ships.
App-specific guides stay next to their app (`apps/mobile/docs/THEMING.md`,
`apps/api/openspec/`).

## CI

`.github/workflows/ci.yml` runs an `api` job (compile with warnings as errors,
`mix test` against Postgres 16) and a `mobile` job (lint, typecheck, jest).
Each job only runs when its `apps/<name>/` tree changes; `docs/`-only changes
trigger neither.

## Pending

The mobile app currently targets the auth / onboarding / preferences API
contract of [ChordanDev/progra-3-back](https://github.com/ChordanDev/progra-3-back)
(email-code auth, onboarding, preferences, slot cooking times). `apps/api`
does not expose those endpoints yet; porting them into `apps/api` is tracked
as separate work (see `odd/tasks/monorepo-bootstrap.md`). Until then the
mobile contract test `apps/mobile/src/services/__tests__/authErrorCodeContract.test.ts`
keeps its api-side assertion skipped.
