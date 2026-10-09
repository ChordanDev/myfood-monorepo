# Feature: Recipe theme served with the Recipe (R2)

Ticket: https://github.com/ChordanDev/myfood-monorepo/issues/33 (label `ready-for-agent`, part of spec #4, blocker #32 closed and merged).
Branch: `claude/issue-33` (worktree `.claude/worktrees/issue-33`, from `main` at `0737f6a`).

## Objective

The app's colors follow today's selected meal using a theme that comes with the recipe payload. Derived recipes inherit their base recipe's theme. Past and future days keep the default theme.

## Scope and constraints

- Expand only. Mobile fixtures and the plan store stay; R7 (#38) removes them.
- PRD #4 requires derived recipes to "store a base recipe reference", and no such column exists. This ticket adds a nullable self-FK `base_recipe_id` next to `theme`.
- Access rules (`RecipeAccess`, `RecipeRepo.get_visible_recipe/2`) are not edited.
- Recipe versions are immutable: versions frozen before this ticket have no `theme` key and read as nil. No backfill.
- The mobile CLAUDE.md forbids a palette catalog in the frontend. The olive palette values move to the API seed; `DEFAULT_THEME` stays client-side. No theme tokens are added or renamed.
- Migration version must be above `20261009120000` (note the odd 15-digit `202610081300000`; compare numerically).
- Authored-line heuristic: about 400 lines per task, advisory only.
- RDD is on (global). Review candidate is each work-unit commit, assessed with `--base-ref <last reviewed boundary> --committed-only`. First boundary: `0737f6a`.

## Design

1. `recipes.theme` is a nullable `:map` (jsonb) with camelCase keys: required `colorBlack, colorDark, colorMedium, colorLight, primaryAccent, appBg, icon, textBlack, textDark, textMedium, textLight, primaryAccentIntense, alert`; optional `appBgGradient` (two strings). The changeset validates the keys.
2. `recipes.base_recipe_id` is a nullable self-reference. Only derived recipes (`ai_generated`, `user_created`) use it.
3. The SQL `freeze_recipe_version` uses `to_jsonb(recipe_row)`, so `theme` enters new snapshots with no SQL change. `RecipeVersions.@recipe_fields` (and the `Recipe.changeset` cast) must include `:theme` so decode and `correct/2` successors keep it.
4. `RecipeDetail.project/2` serves `snapshot["theme"]`; when nil and the Recipe row has a base, it serves the base recipe's theme (read live from the base Recipe row); else `nil`.
5. Catalog recipes get the two palettes from `apps/mobile/src/mocks/domainMocks.ts` (r1 "Pollo con Arroz y Tomate", r2 "Pasta con Espinaca"; same olive palette) through `priv/repo/seeds.exs`, upserted by name.
6. Mobile: `useActivateRecipePalette` already applies `recipe.theme` (null means default). Add the missing tests proving the palette comes from the recipe payload and that the global rules (today's meal recolors, other days revert to default) hold.

## Tasks

- [x] T1 API: migration (`theme`, `base_recipe_id`), `Recipe` schema + changeset validation, `RecipeVersions.@recipe_fields`, `RecipeDetail` theme and base inheritance, tests (controller, lifecycle), `frontend_integration_guide.md` lines about `theme`. Test-first on the projection.
- [x] T2 API: seed the catalog recipes with their themes (`priv/repo/seeds.exs`), test or check the seed is idempotent.
- [x] T3 Mobile: tests for `useHomeRecipeTheme` / `recipeThemeSelection` and the palette-from-payload cases; update `docs/THEMING.md`; update `docs/GLOSSARY.md` ("Recipe theme", new "Base recipe").

## Acceptance criteria (from the ticket)

- [x] Nullable JSON `theme` on the Recipe with the app's theme fields, frozen into Recipe versions and snapshots.
- [x] Derived recipe with null theme serves its base recipe's theme; with no base, `null`.
- [x] Catalog recipes seeded with the fixture themes.
- [x] Theme context reads the recipe in view and applies default when null; global rules client-side and tested.

## Checks

- API, from `apps/api`: `mix test`, finish with `mix precommit`. Needs a per-worktree test database and `MYFOOD_TEST_DB_USERNAME` override (see memory `api-local-test-db-env`).
- Mobile, from `apps/mobile`: `npm test`, `npm run typecheck`, `npm run lint`.

## Progress

Route per task: T1, T2, T3 delegated (2+ non-trivial files each; writer trigger).

- T1 done, commit `f5e2ec7`. RED: recipe_controller_test + mobile_casing_contract_test, 9 of 41 failed before the change (theme served as nil, attrs ignored). GREEN: 22/22 controller tests, full `mix test` 1453 passed, 20 skipped; `mix precommit` clean. Decisions: SQL freeze function untouched (to_jsonb already freezes `theme`; `base_recipe_id` does enter new snapshots but no key-set assertion breaks and it is not served). Base theme is read live through `RecipeRepo.get_visible_recipe_theme/2`, scoped to catalog or the derived recipe's own Account, so `RecipeAccess`/`get_visible_recipe/2` are untouched. Migration `20261009130000` also adds a partial index on `base_recipe_id` and `on_delete: :nilify_all`.
- T2 done, commit follows T1 (`feat(api): seed catalog recipes with their themes`). Seeds upsert both catalog recipes by name and source; the catalog block run twice against the test DB left 2 rows with the olive theme. No ingredients or steps added (schema does not require them). One non-reproducible full-suite failure appeared once right after the check and did not recur in two further full runs (1453 passed).
- T3 done, commit: see git log (`test(mobile): prove the app theme comes from the recipe payload`). All new tests are characterization tests (production code unchanged, they passed on first run); a mutation of `useHomeRecipeTheme` (ignore the today check) made 3 of 5 hook tests fail, so they do bite. Real `RecipeThemeProvider` used in `src/context/__tests__/recipePaletteFromPayload.test.tsx` and `useHomeRecipeTheme.test.tsx`. Mobile: `npm test` 1580 passed, typecheck clean, lint 0 errors (4 pre-existing warnings). Docs: THEMING.md and GLOSSARY.md ("Recipe theme", new "Base recipe").

## Next step

Whole-branch review and PR (human decisions).
