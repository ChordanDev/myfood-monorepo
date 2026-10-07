# recipe-screen-ai-chat

- **Issue:** ChordanDev/progra-3-front#49
- **Branch:** `feat/recipe-screen-ai-chat` (from `origin/Develop` @ db05b87)
- **Worktree:** `../my-expo-app-worktrees/recipe-screen-ai-chat`
- **Engram mirror:** `odd/recipe-screen-ai-chat/tasks`
- **Delivery strategy:** `ask-on-risk`. Forecast is about 1100 authored lines, above the ~400 budget. Work-unit commits are kept per task so either chain strategy can be formed; the chain strategy (`stacked-to-main` vs `feature-branch-chain`) is asked at delivery, before any pull request. No push or PR without request.

## Objective

Rebuild the recipe screen to match `docs/design/screens/Receta.dc.html` and `Receta-Chat.dc.html`: fixed header with back, recipe-name pill, favorite and mark-as-cooked; ingredients resolved from the catalog with their stock state; preparation in a dark card; an assistant chat with the planner composer; the same top gradient as Home.

## Problem and why

`RecipeScreen` prints `{amount}g de ingrediente {id}` (raw ids, fixed unit), its chat is a `tuteo` mock on a plain `TextInput`, "MARCAR COMO COCINADO" sits at the end of the scroll, and the screen colors itself from a legacy `RECIPE_THEMES` shape plus literals instead of the active palette. The route only carries a `recipeId`, so the screen cannot tell which planned meal it was opened for; the same recipe is planned on several days.

## Scope

- Fixed header: back, name pill, favorite, mark-as-cooked check (visual recipe of `PlannerHeader`).
- Ingredient rows with name, quantity and unit from `Ingredient`, and "En stock" / "Falta · agregar" from `useInventoryStore`.
- Preparation card (`colorDark`) with numbered steps.
- Assistant chat: planner composer, replies in `voseo`, quick actions ("Sí, agregalo" / "No hace falta"), enabled only for today's meal.
- Top gradient identical to Home's.
- Remove `features/recipe/hooks/useRecipeTheme.ts`, `types/themes.ts` (`RECIPE_THEMES`).

Out of scope: real AI service, chat history persistence, the leftovers prompt after cooking (PRD §3.3), the food image, tags and description (absent from the mockups), moving the composer out of the planner feature.

## Constraints

- Colors only from the active palette (`docs/THEMING.md`): `useRecipeTheme()` from `@/context/RecipeThemeContext`, tints with `withOpacity`. No literals other than `#000000` shadows.
- Generated artifacts in English; user-facing copy in Rioplatense Spanish as in the mockups.
- Other branches are in flight: #46 (`feat/home-confirm-past-meal`) and #44 (`feat/shopping-list-screen`). Keep edits to `HomeScreen.tsx`, `domain.ts` and `useInventoryStore.ts` minimal.

## Design decisions

1. **Dependencies (owner decision, 2026-10-06): self-contained with seams.**
   - `alert` token: cherry-picked from #46 (`bafe98e`) so both branches carry the identical change.
   - Shopping list: "agregar" goes through a narrow port, `useShoppingRequestsStore` (persisted manual requests). When #44 lands, its `useShoppingListStore` manual items replace this store behind the same call site.
2. **Entry identity:** Home pushes `/recipe/{recipeId}?entryId={entry.id}`. The screen resolves the entry by id and falls back to today's entry for that recipe, then to the first one.
3. **Chat gate:** enabled only when the resolved entry's `date` equals today's date key (PRD_RECIPE_EXPERIENCE §3.2: past and future days are read-only). No entry means disabled.
4. **"En stock":** inventory amount for the ingredient is at least the recipe amount. Otherwise "Falta". An ingredient already requested shows "En la lista" and is not pressable.
5. **Display:** units `gramos` → `g`, `mililitros` → `ml`, `unidades` → `u`; names in sentence case; unknown catalog ids fall back to a neutral label and count as missing.
6. **Palette:** the screen activates the recipe's own `theme` through `setRecipeTheme` while mounted and restores the previous palette on leave, so a future-day recipe is not drawn in the fallback palette.
7. **Composer:** `PlannerChatInput` gains optional props (`placeholder`, `disabled`, `restingBottomGap`, `testIDPrefix`) with defaults that preserve the planner's behavior; the recipe screen imports it across features. Moving it to a shared folder is left out to avoid churn on its mechanism-locked tests.
8. **Mark as cooked:** header check calls `useMealPlanStore.markAsCooked(entry.id)` and goes back, as today. Disabled without an entry or when already cooked.
9. **Top gradient:** new shared `src/components/TopGradientBackground.tsx` built on `useGradientCrossfade`; Home keeps its inline copy for now to avoid conflicts with #46.

## Tasks

- [x] **T0 — `alert` token.** Cherry-pick of `bafe98e` from `feat/home-confirm-past-meal`. Route: inline (mechanical). Commit `a432783`.
- [x] **T1 — Ingredient resolver and stock status.** `src/features/recipe/domain/recipeIngredients.ts` with colocated tests, RED first. Route: delegated writer (with T2, T3). Commit `0597978`.
- [x] **T2 — Shopping requests port.** `src/store/useShoppingRequestsStore.ts` with store tests, RED first. Commit `a42f206`.
- [x] **T3 — Entry resolution, chat gate and chat model.** `src/features/recipe/domain/recipeEntry.ts` and `recipeChat.ts` (messages, quick actions, `voseo` mock replies, inventory-aware offer), colocated tests, RED first. Commit `1f08708`.
- [x] **T4 — Screen layout.** Header, ingredients card, preparation card, `TopGradientBackground`, palette activation, Home passes `entryId`, legacy theme hook and `RECIPE_THEMES` deleted. Route: delegated writer (with T5). Component tests for the ingredient row states and the header actions. Commit `ec06650`.
- [x] **T5 — Assistant chat.** Composer props on `PlannerChatInput`, chat section with bubbles and quick-action chips, disabled state off today. Component tests for the gate and the quick actions. Commit `02d49fc`.
- [x] **T6 — Docs.** Remove `src/features/recipe/` from the known gaps in `docs/THEMING.md`; record progress here.

## Acceptance criteria

- [x] Chat enabled only for today's recipes; disabled on other days.
- [x] Mark as cooked reachable from any scroll position.
- [x] Recipe palette via `useRecipeTheme()` from the context; legacy hook and `RECIPE_THEMES` removed.
- [x] Tests for the ingredient resolver and the inventory status.

## Checks

- `npx jest src/features/recipe src/store/useShoppingRequestsStore.test.ts src/features/planner` — green.
- `npm test` — no new failures against the base (2 known failing tests on the base).
- `npx tsc --noEmit` — no new errors against the base (22 known errors in auth/services tests).
- `npm run lint` — clean for touched files.
- `rg` for color literals in `src/features/recipe` and `src/components/TopGradientBackground.tsx` — none except `#000000` shadows.

## Progress and evidence

- 2026-10-06: worktree created, dependencies installed, CodeGraph initialized. T0 done (`a432783`). RDD is off for this clone (`clone_local`), so verification follows the tier table of `gentle-ai review assess`.

- 2026-10-06: T4–T5 done by one delegated writer. `npx jest src/features/recipe src/features/planner src/store/useShoppingRequestsStore.test.ts`: 14 suites, 275 tests passed (re-run by the parent). `npm test`: 516 passed, 2 failed, both in `src/services/__tests__/authErrorCodeContract.test.ts` (untouched, known on the base). `npx tsc --noEmit`: 22 errors, same as the base, none in touched files. `npm run lint`: 0 errors. Color-literal search: only `#000000` as a shadow. No importer of the legacy theme hook remains. Existing planner composer tests untouched and green; 6 cases added for the new props. `gentle-ai review assess` on `01d3480..02d49fc`: `medium`, `slice_budget_reached`; no native review because RDD is off for this clone.
- 2026-10-06: T6 done: the recipe row was removed from the known gaps in `docs/THEMING.md`.
- Acceptance criteria are checked from automated tests and code reading. **Pending:** no run on a simulator or device yet.

## Known limits

- Not verified visually. To check on device: header shadow and pill ellipsis, the scroll clip under the header, the disabled composer (its placeholder likely wraps to two lines), the bottom fade with a multi-line composer, chips at large font scale, Android elevation order.
- As on the planner, the scroll padding does not grow with the keyboard: with the keyboard open the newest message can sit behind it until dismissed.
- A recipe opened from another day activates its palette for the whole app while mounted; Home, mounted underneath, may crossfade back visibly on pop. Only the top gradient animates; cards switch instantly.
- "Falta · agregar" on an ingredient outside the catalog creates a request named "Ingrediente desconocido".
- Mark as cooked always calls `router.back()`; a deep link without a back stack is not handled.
- `PlannerChatInput` and `PlannerTypingIndicator` are imported across features.
- Assistant replies are a deterministic mock that ignores the question; chat history is not persisted.
- Merge seams: `useShoppingRequestsStore` is to be replaced by #44's store; the `alert` commit is a cherry-pick of #46's.

## Slices for delivery

Chain strategy not chosen yet. Natural boundaries: A = `a432783` (token, shared with #46); B = `0597978`, `a42f206`, `1f08708` (domain and port, 1239 lines, mostly tests); C = `ec06650` (screen); D = `02d49fc` (chat and composer props).

## Feature-first restructure (owner request, 2026-10-06)

The owner asked for everything in this work to be organized feature-first. Scope: what this branch added or made cross-feature. Pre-existing shared layers (`src/store`, `src/context`, `src/utils`, `src/types`, `src/components`) are not moved here: five sibling branches are in flight on them.

Evidence before the change: the branch added `src/store/useShoppingRequestsStore.ts` and `src/components/TopGradientBackground.tsx` to horizontal layers, and the recipe feature deep-imported planner internals (`PlannerChatInput`, `PlannerTypingIndicator`, `planner/constants`).

Decisions (they supersede design decisions 1, 7 and 9 on file placement only):

- The shopping requests port is the recipe's seam, so it lives in `src/features/recipe/store/`. `src/features/shopping/` belongs to #44 and is not touched.
- The top gradient has one consumer, so it lives in the recipe feature as `RecipeTopGradient`.
- The composer and typing indicator are used by two features, so they become their own feature, `src/features/assistant-chat/`, with a public barrel. Neutral names (`ChatComposer`, `ChatTypingIndicator`, `CHAT_COMPOSER_*`). The composer no longer knows the tab bar: the planner passes its resting gap.
- Features are consumed through their root barrel (`@/features/recipe`, `@/features/assistant-chat`).
- Left as is: `formatDateKey` stays in `home/utils` because #46 edits that file; Home's import of `recipe/utils/recipeImageSource` is pre-existing and `HomeScreen` is in flight in #46.

Tasks:

- [x] **T7 — Recipe owns its seams.** Move the shopping requests store and its test to `src/features/recipe/store/`, move the gradient into the recipe components, add `src/features/recipe/index.ts`, route imports the barrel. Route: delegated writer (with T8). Commit `68ebdbf`.
- [x] **T8 — `assistant-chat` feature.** Move and rename the composer, typing indicator, layout resolver, constants and their tests; planner and recipe consume the barrel; planner passes the resting gap and its test id prefix. Planner behavior and e2e test ids unchanged. Commit `1dbf285`.
- [x] **T9 — Docs.** Update names in `docs/THEMING.md`; record progress here.

Evidence (2026-10-06): behavior-preserving refactor, all nine moves detected as renames. `npx jest src/features/recipe src/features/planner src/features/assistant-chat`: 14 suites, 277 tests passed (275 before, plus 2 new tests pinning the composer defaults and the planner's gap and test id prefix; re-run by the parent). `npm test`: 518 passed, the same 2 known failures. `npx tsc --noEmit`: 22 errors, same as the base. `npm run lint`: 0 errors. No deep cross-feature import remains in recipe, planner or assistant-chat except `formatDateKey` from `home/utils`. The Maestro ids `planner-composer-input`, `planner-composer-submit` and `planner-typing-indicator` still resolve on the planner screen.

Left open by the restructure:

- Two screen tests reach `@/features/assistant-chat/constants` through `jest.requireActual`, because requiring the real barrel crashes under their partial reanimated mock.
- `ChatComposer` keeps the planner's default placeholder and `ChatTypingIndicator` keeps planner-prefixed test ids (Maestro depends on them).
- `CUSTOM_TAB_BAR_CONTENT_HEIGHT` stays in `planner/constants` because `app/(tabs)/_layout.tsx` imports it from there.

## Simulator findings (2026-10-07)

First run on the iOS simulator (iPhone 17 Pro, Metro on 8084 from this worktree). Working: navigation from Home, layout against the mockup, "Falta · agregar" → "En la lista", send, `voseo` reply and quick-action chips. Three defects found, fixes requested by the owner:

- [x] **T10 — Keyboard hides the conversation.** With the keyboard open, the message just sent and the reply sit behind the composer and the keyboard. The scroll content must clear the lifted composer and scroll to the end when the keyboard opens. Route: delegated writer (with T11, T12). Commit `19c5074`.
- [x] **T11 — Hard line under the header.** The scroll viewport is clipped with a hard edge that cuts the cards' shadows. Content must fade out under the header instead. Commit `7ff37f4`.
- [x] **T12 — Composer blends into the dark card.** While typing, the composer overlaps the preparation card, which has the same color. The bottom scrim must travel with the composer. Commit `d8937fe`.

Evidence for T10–T12 (2026-10-07): `useKeyboardAnimation` additionally returns the commanded lift, `ChatComposer` forwards it (`onKeyboardLiftChange`) and renders an optional `backdrop` inside its lifted wrapper; the scroll viewport is wrapped in the shared `TopFadeMask`. `npx jest src/features/recipe src/features/planner src/features/assistant-chat src/hooks`: 16 suites, 326 tests passed (re-run by the parent). `npm test`: 540 passed, the same 2 known failures. `npx tsc --noEmit`: 22, same as the base. Second simulator pass by the parent on iOS: with the keyboard open the sent bubble and the reply rest above the composer, the composer sits on the ground scrim, and the card fades under the header. Not verified: Android, and the scroll position after dismissing the keyboard at the end of the list.

- [x] **T13 — Confirm before marking as cooked (owner request, 2026-10-07).** The header check opens a themed sheet "¿Cocinaste la receta?" with "Sí" / "No". "Sí" marks the entry as cooked and goes back, as before; "No" closes the sheet. Same visual recipe as Home's `EatTodaySheet`, owned by the recipe feature. Route: delegated writer. Commit `923abe5`.

Evidence for T13 (2026-10-07): `npx jest src/features/recipe`: 11 suites, 157 tests passed (re-run by the parent). `npm test`: 554 passed, the same 2 known failures. `npx tsc --noEmit`: 22, same as the base. Simulator (iOS): the check opens the sheet "¿Cocinaste la receta?" with "Sí" / "No"; "No" closes it and leaves the check enabled. "Sí" is covered by tests only. Also seen on the simulator: a recipe opened from a future day shows the composer disabled, and its placeholder "El chat se habilita el día de la receta" is cut off by about three characters.

Follow-ups after T13 (2026-10-07, inline, owner approved the shorter copy):

- [x] Disabled placeholder is now "Chat disponible el día de la receta" (`e6d8d57`). It was still cut by a hair on a 402pt screen, so the composer placeholder stays on one line and shrinks to 80% before it is cut (`489d28b`). The shrink was applied before its test was written, so it has no observed RED; the test pins the props.
- [x] `useActivateRecipePalette` activates and restores in a single layout effect (`44ac417`). With two effects, a hot reload left the screen in the fallback palette; a recipe that stops having a palette now hands the previous one back. RED observed (2 failing tests), then GREEN.

Evidence: `npx jest src/features/recipe src/features/assistant-chat src/features/planner`: 16 suites, 309 tests passed. `npx tsc --noEmit`: 22, same as the base. Simulator (iPhone 17 Pro): on a future day the placeholder shows complete and, after reopening the recipe, the screen is drawn in the recipe palette.

## Update with Develop (2026-10-07, owner request)

`origin/Develop` (0c30b24, 55 commits: issues #44 to #48) merged into the branch. One textual conflict, `docs/THEMING.md`. The domain changed under the recipe feature (41 type errors after the merge), adapted by one delegated writer inside the merge commit: `UnitType` is `g | ml | unit`; `useInventoryStore` and `InventoryItem` come from `@/features/inventory`, stock is the summed `quantity` of the items linked to the ingredient; `canMarkAsCooked` refuses a skipped entry.

Evidence: `npx tsc --noEmit`: 0 errors (Develop: 0). `npx jest src/features/recipe src/features/assistant-chat src/features/planner`: 16 suites, 315 tests passed (re-run by the parent). `npm test` in the worktree: 1205 passed, 2 failed, both in `src/services/__tests__/authErrorCodeContract.test.ts`; that suite looks for the backend as a sibling of the checkout and passes in the main checkout (Develop there: 70 suites, 1021 tests passed). `npm run lint`: 0 errors. Not re-run on the simulator after the merge.

Open decision for the owner: the shopping list of #44 is derived from the plan (planned amount minus inventory), so a missing ingredient of a planned recipe is already on that list. "Falta · agregar" and the chat's "Sí, agregalo" still write to the recipe's own `useShoppingRequestsStore`, which the Carrito screen does not read. The replacement is not a mechanical swap: `useShoppingListStore` only adds name-only manual items and the shopping barrel exports the screen alone. Requests persisted before this merge keep the retired unit names.

## Next step

Merge into `Develop` (owner request). Then the owner decides how "agregar" should relate to the derived shopping list.
