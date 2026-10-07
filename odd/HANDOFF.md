# Handoff — monorepo bootstrap → next session

Disposable: delete this file once the next session has read it. Durable knowledge belongs in `docs/GLOSSARY.md` and `docs/adr/`.

## State (2026-10-07)

- Repo: https://github.com/ChordanDev/myfood-monorepo (private, `main`). Local: `~/Documents/proyectoMyFood/myfood-monorepo`. The four source clones were deleted; originals remain on GitHub untouched.
- `apps/api` — `meal_planner_api` (Phoenix 1.8, Guardian JWT, Postgres) imported from `vicenzogiordana/myfood` with history. OR-Tools script at `apps/api/optimizer/optimizador.py` (path fixed in `optimizer_port_runner.ex` and `config/dev.exs`).
- `apps/mobile` — Expo 57 app imported from `ChordanDev/progra-3-front` branch `Develop` with history.
- `docs/` — only `GLOSSARY.md` (70 terms, code names canonical, old PRD words as aliases) and `adr/` (3 ADRs). PRDs/openspec were removed in `b0bda9e`; recover from history if ever needed.
- CI: root `.github/workflows/ci.yml` (`api` on Elixir 1.17.3/OTP 27.3 + Postgres 16, `mobile` on Node 20, path-filtered). First run: mobile green; api compiles, `mix test` = 912 tests, **3 pre-existing failures** in `planning_candidate_builder_test.exs` (`{:error, :plan_not_found}`), untouched by the bootstrap.
- Native review (RDD): bootstrap commits approved and acknowledged. Docs deletion commit `b0bda9e` could not be reviewed (`lens_context_budget_exceeded`, deletion-only, no authored content); glossary commit `b6d169f` assessed `passive`.

## Decision already taken (do not reopen)

`apps/api` is the backend base. `ChordanDev/progra-3-back` (branch `develop`) is a reference repo only: its features get ported, not merged.

## The real next work: unify the mobile ↔ api contract

The mobile app only calls these endpoints, all designed against `progra-3-back`:

- `POST /api/auth/{signup,login}/request-code`, `POST /api/auth/{signup,login}/verify-code` (`{email, code, deviceId}`), `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/me`
- `POST /api/onboarding/complete` (`{profile, preferences, slotCookingTimes}`)
- `GET/PUT /api/me/preferences`, `GET/PUT /api/me/slot-cooking-times`, `PUT /api/me/profile`
- Error envelope `{ error: { code, message } }`; access token Bearer + rotating refresh token tied to `deviceId`; response keys camelCase.

`apps/api` has email-code auth at different paths (`/api/auth/email-code/{request,verify}`), Guardian JWT with `access`/`access_v2` token types, a different `me` shape, and models preferences as `UserDietaryProfile` + `UserExcludedIngredient` (no slot cooking times, no hunger level). Planner, recipes, shopping and inventory in the mobile app are still local mocks; `apps/api` already has real endpoints for all of them.

This is a multi-session effort with open decisions — exactly a wayfinder map. Suggested first steps in the new session:

1. `claude plugins install mattpocock-skills` (or `npx skills@latest add mattpocock/skills`), then `/setup-matt-pocock-skills` (GitHub tracker). The brother's repo used wayfinder issue templates; copies are not in this repo, re-create via the setup skill.
2. Open a map issue: **Destination** "the mobile app runs end to end against `apps/api` for auth, onboarding and preferences". Candidate decisions: adapt the api routes/shape to the mobile contract vs adapt the mobile `src/api` layer to the api; where slot cooking times / hunger level live; whether to keep Guardian or port `progra-3-back` sessions; 7-day (code) vs 10-day (old PRD) trial.
3. Re-enable `apps/mobile/src/services/__tests__/authErrorCodeContract.test.ts` (currently `it.skip`, `TODO(porting)`) once the api emits the agreed error codes.

## Known issues / loose ends

- `apps/api/config/test.exs` hardcodes `postgres/postgres`; this Mac only has role `luccagiordana`, so local `mix test` cannot run. Create the role or make credentials env-driven.
- `ortools` is not installed locally; `pip install -r apps/api/optimizer/requirements.txt` (pinned 9.12.4544, unverified against the script).
- `apps/mobile/src/features/preferences/constants/catalog.ts` still comments that its source of truth is `my_food_back/.../catalog.ex` (pre-monorepo path).
- Mobile lint: 4 pre-existing unused-var warnings (`AddCircleButton.test.tsx`, `FoodCard/icons.tsx`).
- `npm audit` reports 57 vulnerabilities in `apps/mobile`; not addressed.
- Second docs pass not done: `apps/api/docs`, `apps/api/openspec`, `apps/api/ARCHITECTURE.md` (says `System.cmd`; the optimizer actually runs over a long-lived Port), `apps/api/frontend_integration_guide.md`, `apps/mobile/docs/design`, `apps/mobile/odd/tasks`.
- `apps/api` prod config has no `DATABASE_URL`/Repo block and no prod mailer adapter.
- Engram memory for this session was not saved (ambiguous project detection in the parent folder). The feature log is `odd/tasks/monorepo-bootstrap.md`.
