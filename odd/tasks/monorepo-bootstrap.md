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

- [ ] T1 — Skeleton: `git init` on `main`, root `.gitignore`, this task document. Route: inline (mechanical). Commit.
- [ ] T2 — Import backend: filter `myfood` to `meal_planner_api/` → root, `optimizador.py` + `test_optimizador.py` → `optimizer/`; `git subtree add --prefix=apps/api`. Route: inline (git state). Check: `git log --oneline apps/api | wc -l` > 100, `apps/api/mix.exs` and `apps/api/optimizer/optimizador.py` present.
- [ ] T3 — Import mobile: `git subtree add --prefix=apps/mobile` from front `Develop`. Route: inline. Check: `apps/mobile/package.json` Expo 57, history count ≈ 280.
- [ ] T4 — Import docs: `git subtree add --prefix=docs` from meal-app-docs `origin/develop`. Route: inline. Check: `docs/docs/PRD_BACKEND.md` present.
- [ ] T5 — Cleanup + layout fixes (delegated writer, 2+ non-trivial files): remove tracked leftovers (`.DS_Store`, `.pi/`, `.atl/`, mobile `.env`, `fix-auth-colors.js`, duplicate `priv/openspec`), fix optimizer default path and `dev.exs` config nesting, rewrite mobile CI contract-test sibling paths to `../api/lib`, remove the mobile workflow's backend clone step, root README, root `.github/workflows/ci.yml` with `api` and `mobile` jobs. Check: `mix compile --warnings-as-errors` in `apps/api`; `npx tsc --noEmit` and `npx jest` in `apps/mobile` (contract test may fail by design — record).
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

(filled per task)

## Next step

T1.
