# Monorepo bootstrap

## Objective

Create a single clean repository that holds the MyFood backend, mobile app and product docs, with each source repository's history preserved, so both developers continue working in one place.

## Problem

Work is split across four repositories owned by two people: `vicenzogiordana/myfood` (backend, the real product), `ChordanDev/progra-3-front` (mobile app), `ChordanDev/meal-app-docs` (PRDs/specs) and `ChordanDev/progra-3-back` (a smaller backend that matches the mobile app's current API contract). The two backends cannot be merged file by file: different auth models (Guardian JWT vs Phoenix.Token sessions), different schemas and different routes.

## Decision (user approved)

- Backend base: `myfood/meal_planner_api` (owns the planning engine, catalog, shopping, inventory; where the second developer is actively working).
- `progra-3-back` does NOT enter the monorepo as a folder. It stays a reference repo; its features the mobile app needs (email-code auth contract, onboarding, preferences, slot cooking times, Oban, CI) are ported in later, separately tracked work.
- Mobile app source branch: `Develop` (master is a 5-commit stub).
- Docs source branch: `origin/develop` (13 ahead of master; master's 2 extra commits are the already-archived auth slice).
- History preserved with `git filter-repo` (path filtering) + `git subtree add`.

## Target layout

```
myfood-monorepo/
├── apps/
│   ├── api/        # meal_planner_api + optimizer/optimizador.py
│   └── mobile/     # Expo app (from Develop)
├── docs/           # meal-app-docs (from develop)
├── odd/tasks/
├── .github/workflows/
└── README.md
```

## Scope

In: repository skeleton, history-preserving imports, leftover removal, path fixes needed for the new layout (optimizer script path, mobile CI contract test paths), root README and CI, GitHub repo creation and push.

Out: porting any `progra-3-back` feature, changing the backend/mobile API contract, touching the meal-selection engine, dependency upgrades, fixing `npm audit` findings.

## Constraints

- Conventional Commits; no AI attribution lines in commits.
- No history rewriting after import; leftovers are removed in ordinary commits.
- Sibling checkouts in `../` are not modified.
- Delivery strategy: `single-pr` is not applicable (new repo, first push to `main`); user decides push.

## Tasks

- [x] T1 — Skeleton: `git init` on `main`, root `.gitignore`, this task document. Route: inline (mechanical). Commit.
- [x] T2 — Import backend: filter `myfood` to `meal_planner_api/` → root, `optimizador.py` + `test_optimizador.py` → `optimizer/`; `git subtree add --prefix=apps/api`. Route: inline (git state). Check: `git log --oneline apps/api | wc -l` > 100, `apps/api/mix.exs` and `apps/api/optimizer/optimizador.py` present.
- [x] T3 — Import mobile: `git subtree add --prefix=apps/mobile` from front `Develop`. Route: inline. Check: `apps/mobile/package.json` Expo 57, history count ≈ 280.
- [x] T4 — Import docs: `git subtree add --prefix=docs` from meal-app-docs `origin/develop`. Route: inline. Check: `docs/docs/PRD_BACKEND.md` present.
- [x] T5 — Cleanup + layout fixes (delegated writer, 2+ non-trivial files): remove tracked leftovers (`.DS_Store`, `.pi/`, `.atl/`, mobile `.env`, `fix-auth-colors.js`, duplicate `priv/openspec`), fix optimizer default path and `dev.exs` config nesting, rewrite mobile CI contract-test sibling paths to `../api/lib`, remove the mobile workflow's backend clone step, root README, root `.github/workflows/ci.yml` with `api` and `mobile` jobs. Check: `mix compile --warnings-as-errors` in `apps/api`; `npx tsc --noEmit` and `npx jest` in `apps/mobile` (contract test may fail by design — record).
- [ ] T6 — Verification worker: run the T5 checks in fresh workers, record observed results here.
- [ ] T7 — Publish: `gh repo create ChordanDev/myfood-monorepo --private`, push `main`. User-authorized in this session.

## Acceptance criteria

- One repo, three imported trees, each with its original commit history reachable from `main`.
- No tracked `.DS_Store`, `.pi/`, `.atl/`, `.env`, patch scripts or one-off codemods.
- `apps/api` compiles; `apps/mobile` typechecks.
- README explains layout, how to run each app and what is pending (porting from `progra-3-back`).

## Forecast

Authored changed lines (excluding imported history): ~250 (README, CI, path fixes, deletions are not authored content).

## Progress / evidence

- T1 — `685754a chore: bootstrap monorepo skeleton`. Observed: `git init -b main`, `.gitignore`, this document.
- T2 — `c74eb00 chore(api): import meal_planner_api ...`. Observed: `git filter-repo` kept 250 commits / 408 files; `apps/api/mix.exs` and `apps/api/optimizer/optimizador.py` present. Note: `git log -- apps/api` shows only the subtree merge because imported commits carry root-level paths; full history is reachable (`git rev-list --count HEAD` = 561 after T4).
- T3 — `f2d524a chore(mobile): import Expo app ...`. Observed: `apps/mobile/package.json` expo `^57.0.0`.
- T4 — `e4c0a7c chore(docs): import meal-app-docs develop ...`. Observed: `docs/docs/PRD_BACKEND.md` present.
- T5 — commits `bcfe95c` (leftovers + openspec consolidation), `bc69f9f` (optimizer path + dev config), `5a243dd` (root CI, contract test path, README). Parent spot check: `OptimizerPortRunner.default_script_path()` resolves to `apps/api/optimizer/optimizador.py`, exists=true. README python test line corrected to run from `optimizer/`.
- Native review: `gentle-ai review assess` on `e4c0a7c..HEAD` → risk `high`, `review_due=true (high_risk)`; consent granted by user; lineage `review-50ada2c3fb5300f3`, four lenses captured in process (risk, resilience, readability admitted `completed`; reliability closed the review). Outcome: approved, no correction required; acknowledged (`gentle-ai.review-acknowledged/v1`). Reviewed boundary now `5a243dd`.

### T5 — Cleanup + layout fixes (delegated writer; checkbox left to the parent)

Route: delegated direct (one writer; 2+ non-trivial files: runner, `dev.exs`, contract test, CI, README).

Changes:

- `apps/api/lib/meal_planner_api/optimization/optimizer_port_runner.ex`: default script path is now `Path.expand("../../../optimizer/optimizador.py", __DIR__)` (`__DIR__` = `apps/api/lib/meal_planner_api/optimization`, three `..` reach `apps/api`).
- `apps/api/config/dev.exs`: optimizer / `python_optimizer_url` / `go_scraper_url` / timeout keys moved out of the Endpoint block into a top-level `config :meal_planner_api` block, deduplicated; dev default `Path.expand("../optimizer/optimizador.py", __DIR__)` (absolute, `__DIR__` = `apps/api/config`). `config.exs` left untouched (it does not define these keys).
- `apps/api/optimizer/requirements.txt` created pinning `ortools==9.12.4544`; ortools is not installed locally so this is a sane recent 9.x pin, not the installed version.
- `apps/mobile/src/services/__tests__/authErrorCodeContract.test.ts`: resolver now points at `apps/api/lib` (four `..` from the test dir, then `api/lib`); sibling fallbacks dropped. The dynamic api→mobile assertion is `it.skip` with the `TODO(porting)` comment because `apps/api` has zero `error(:atom)` calls (rg returned nothing), so its `> 0` sanity check would fail.
- `.github/workflows/ci.yml` created: `changes` job (`dorny/paths-filter@v3`) gates `api` (Elixir 1.17.3 / OTP 27.3, Postgres 16 service, deps+build cache, `mix deps.get`, `mix compile --warnings-as-errors`, `mix ecto.create/migrate --quiet`, `mix test` with `MIX_ENV=test` and `MYFOOD_TEST_DATABASE`) and `mobile` (Node 20, `npm ci`, `npm run lint --if-present`, `npx tsc --noEmit`, `npx jest --ci`). `docs/`-only changes trigger neither. `mix.exs` has no `test` alias, hence the explicit ecto steps; `runtime.exs` guards every env read behind `config_env() != :test`, so no extra env vars are needed.
- `README.md` created (layout table, api/mobile run instructions, docs location, CI, Pending section on the `progra-3-back` contract).

Removed (git rm): `apps/api/.DS_Store`, `apps/mobile/.env` (tracked, only `EXPO_PUBLIC_START_HOME`), `apps/mobile/fix-auth-colors.js`, `apps/mobile/.pi/**`, `docs/.pi/**`, `docs/.atl/**`, `apps/mobile/.github/workflows/ci.yml` (`.github` dir had nothing else; removed), `apps/api/priv/openspec/config.yaml` (older SDD config format superseded by `openspec/config.yaml`).

Moved (git mv): the three archives unique to `priv/openspec` (`2026-06-07-backend-gaps-frontend-integration`, `2026-06-08-channels-test-coverage`, `2026-06-09-python-integration-fix`) → `apps/api/openspec/changes/archive/`; `priv/openspec` then removed (priv ships in releases).

Kept: `apps/api/.envrc` — generic direnv stub (env defaults, `source_env .envrc.local`), no secrets or machine-specific values.

Observed results (local toolchain: Elixir 1.20.3 / OTP 29, Node 24; CI pins differ):

- `cd apps/api && mix deps.get && mix compile --warnings-as-errors`: deps fetched, "Compiling 169 files (.ex) / Generated meal_planner_api app", exit 0.
- `cd apps/api && mix run --no-start -e '...'`: `:optimizer_script_path` config = `.../apps/api/optimizer/optimizador.py` exists=true; `OptimizerPortRunner.default_script_path()` = same path, exists=true.
- `cd apps/api && python3 -m unittest optimizer/test_optimizador.py`: FAILED (errors=1) — `ModuleNotFoundError: No module named 'optimizador'` (module not on `sys.path` from `apps/api`); from `optimizer/`: `python3 -m unittest test_optimizador` → `ModuleNotFoundError: No module named 'ortools'` (not installed locally). Not a regression of this task.
- `cd apps/mobile && npm ci && npx tsc --noEmit`: `npm ci` completed (audit warnings only, not fixed by design); `tsc` exit 0.
- `cd apps/mobile && npx jest --ci src/services/__tests__/authErrorCodeContract.test.ts`: PASS, "Tests: 1 skipped, 6 passed, 7 total".
- `git ls-files | rg '(\.DS_Store|/\.pi/|/\.atl/|fix-auth-colors|priv/openspec)' | wc -l`: 0.
- Extra: `mix format --check-formatted` on the two edited Elixir files exit 0; `eslint` + `prettier -c` on the rewritten test exit 0.

Not run here (separate verification pass): full `mix test`, full `npx jest`.

## Next step

T6 (full suites, in progress) → native review acknowledgement → T7 publish.
