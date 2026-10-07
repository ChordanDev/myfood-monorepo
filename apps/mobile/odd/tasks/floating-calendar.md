# floating-calendar

- **Branch:** `feat/floating-calendar` (from `Develop` @ 9ffb79a)
- **Engram mirror:** `odd/floating-calendar/tasks`
- **Delivery strategy:** `ask-on-risk`. Forecast is about 900 authored lines, tests included, above the ~400 budget. Work-unit commits are kept per task. The owner's practice in this repository is a direct `--no-ff` merge into `Develop` on confirmation, without a pull request; nothing is pushed or merged without that confirmation.

## Objective

Give the Planner and the shopping list a small floating calendar, the Home calendar in a popover, opened from the date pill each screen already shows.

- **Planner:** pick the range of days to plan, from one date to another.
- **Shopping list:** pick, among the days already planned, the last day to buy for. The list shows what is needed up to that day.

## Problem and why

Both pills are display only. The Planner header prints a hard-coded `16 - 24 Septiembre` (`src/features/planner/components/PlannerHeader.tsx`). The shopping pill prints the last planned date and says so in its own comment: "no date picker is designed yet" (`src/features/shopping/components/ShoppingDatePill.tsx`). The shopping domain already accepts an inclusive `untilDate`, but nothing sets it: `useShoppingList` always uses `getDefaultUntilDate`.

The Home calendar (`src/features/home/components/Calendar.tsx` with `useCalendarState`) is the visual reference, but it only knows one rule: a single selected day, selectable when it has a plan, months limited to the ones with a plan. Neither new use fits that rule as is.

## Scope

- The Home calendar accepts its selection rule, its month bounds and an optional range from outside. Home keeps its current behavior by default.
- A floating calendar: the same calendar in a popover anchored under the element that opens it.
- Shopping: the pill opens it; the chosen day becomes the list's `untilDate`.
- Planner: the pill opens it; the chosen range replaces the hard-coded label.
- Local only: no backend call.

Out of scope: sending the Planner range to the assistant or the backend (the Planner chat is still a mock), any change to the Home screen, new palette tokens.

## Constraints

- Feature-first: Planner and shopping import the calendar only through `@/features/home`.
- Colors only from the active palette (`docs/THEMING.md`): tokens by role, tints through `withOpacity`, palette changes through `useAnimatedThemeStyle`. The only literals allowed are `#000000` shadows and a black backdrop.
- No token is added, renamed or removed.
- Home's calendar behavior and its tests stay as they are.
- UI copy stays in Spanish, as the screens already are.

## Design decisions

1. **One calendar, three rules.** `Calendar` takes optional props for the selectable-day rule, the month bounds and a range (`rangeStart`, `rangeEnd`). Without them it behaves as today. No second calendar component.
2. **Floating means a popover.** It opens right under the pill, aligned to it, over the rest of the screen. A tap outside closes it. It respects reduced motion.
3. **Shopping, selectable days:** days from today on that have at least one planned meal. Picking one closes the popover.
4. **Shopping, one derivation.** The chosen day lives in the shopping store and every reader of the derived list follows it, the recipe screen included. This replaces decision 5 of `recipe-shopping-link` ("Hasta" not applicable): an ingredient of a meal after the chosen day is not on the list, so its recipe row reads "Falta · agregar".
5. **Shopping, fallback.** With no chosen day, or a chosen day that is no longer a selectable one (it passed, or its meals were removed), the list goes back to the last planned date. The chosen day is a view preference: it is not queued for sync.
6. **Planner, selectable days:** only days after the last day that already has a plan, and never before today. Every day up to that last planned day is blocked: the user plans days that are not planned yet. Planned days keep their mark. Months go from the month of the first plannable day forward. (Owner's rule, 2026-10-07. It replaces the first version, "any day from today on".)
7. **Planner, range gesture.** First tap sets the start. A second tap on that day or a later one sets the end and closes the popover. A tap before the start moves the start. A tap with a complete range starts a new one.
8. **Planner, default range:** the seven days starting on the first plannable day, so the pill always reads as a range.
9. **Planner, label.** Same month: `16 - 24 Septiembre`. Across months: `28 Sep - 3 Oct`. Start only: `Desde 16 Septiembre`.
10. **Planner, state.** The range is held by the Planner (its store if it has one, otherwise screen state). Nothing consumes it yet besides the pill.

11. **Shopping, the range is visible.** The calendar draws the stretch the list buys for, from its first day to the chosen day, with the range drawing the Planner uses. (Owner's request, 2026-10-07.)
12. **Screen titles.** "INVENTARIO" and "AJUSTES" are the same size as "COMPRAS". (Owner's request, 2026-10-07. Outside the calendar, kept in this feature as its own task and commit.)

Decisions 3, 4, 5, 7 and 9 are assumptions taken from the request, not confirmed one by one. Decisions 6, 8, 11 and 12 come from the owner.

## Tasks

- [x] **T1 — Calendar rules.** `Calendar` and `useCalendarState` accept the selectable-day rule, the month bounds and a range; `DayCell` draws the range (ends as selected, days between as a tint). Pure range helpers. Home unchanged. Tests RED first. Route: delegated writer (2+ non-trivial files). Commit `423cf0d`.
- [x] **T2 — Floating calendar.** Popover wrapper anchored under its trigger, exported from `@/features/home`. Tests for open, pick and dismiss. Route: delegated writer (with T1). Commit `9c996c7`.
- [x] **T3 — Shopping "Hasta".** Chosen day in the store with its fallback; the derivation, the hook and the pill use it; the pill becomes a button that opens the floating calendar. Tests RED first. Route: delegated writer. Commit `a66bb17`.
- [x] **T4 — Planner range.** Range helpers and label formatter; the header pill opens the floating calendar in range mode and shows the label. Also the test the T1/T2 review asked for: pressing a range end completes a one-day range. Tests RED first. Route: delegated writer. Commit `97248dd`.
- [x] **T5 — Shopping follow-ups from the T3 review.** With no selectable day (every planned meal is in the past) the pill is not a button and opens nothing; the default-argument test of `getTodayKey` uses a fixed clock. Tests RED first. Route: delegated writer (before T4, same run). Commit `5724519`.
- [x] **T6 — Planner blocks the days already planned.** The selectable rule, the month bounds and the default range start after the last planned day. `selectDate` no longer depends on the range captured at render (T4 review). The pill's shadow sits on a view with a fill (T4 review). Tests RED first. Route: delegated writer. Commit `5a74ee8`.
- [x] **T7 — Shopping shows the range.** The calendar draws from the first day the list buys for to the chosen day. Tests RED first. Route: delegated writer (same run). Commit `5505284`.
- [x] **T8 — Screen titles.** "INVENTARIO" and "AJUSTES" at the size of "COMPRAS". Route: delegated writer (same run). Commit `90f64c8`.

## Acceptance criteria

- [x] Pressing the shopping pill opens a calendar under it; only planned days from today on can be picked. (Simulator.)
- [x] Picking a day updates the pill label, the cards and the counters to what is needed up to that day. (Simulator.)
- [x] Pressing the Planner pill opens the same calendar; two taps select a range and the pill shows it. (Simulator.)
- [x] A tap outside closes the calendar on both screens. (Simulator.)
- [x] The Home calendar looks and behaves as before. (Existing Home tests untouched and green; seen on the simulator.)
- [x] No color literal outside the allowed ones in the touched code. (Writer's `rg` per task; the only match is the pre-existing `#000000` shadow in `PlannerHeader.tsx`.)
- [x] In the Planner calendar no day up to the last planned day can be picked. (Simulator.)
- [x] The shopping calendar shows the stretch from the first day to the chosen day. (Simulator.)
- [x] "INVENTARIO" and "AJUSTES" are the size of "COMPRAS". (Font size 28 on both; "INVENTARIO" seen on the simulator, "AJUSTES" by tests only.)

## Checks

- `npx jest src/features/home src/features/shopping src/features/planner src/features/recipe`
- `npx tsc --noEmit`
- `npm run lint`
- `rg` for color literals in the touched feature code.
- iOS simulator: open both pills, pick, dismiss.

## Progress and evidence

- 2026-10-07: branch created from `Develop` 9ffb79a. Exploration by the parent (CodeGraph): the Home calendar's single rule in `useCalendarState`, the unused `untilDate` of the shopping derivation, the hard-coded Planner label.

- 2026-10-07: review assessment of `69a9181` from boundary `9ffb79a`: `passive`, not due. The stop hook's default candidate (all of `Develop` against `master`) was not started: it is the one that exceeded the reviewers' budget before; the owner confirmed the scoped approach.
- 2026-10-07: **T1** `423cf0d` (11 files, +723/−77) and **T2** `9c996c7` (7 files, +578/−2), one delegated writer. Both pass the ~400 heuristic because of their tests (about 457 and 396 lines).
  - Public API from `@/features/home`: `Calendar` gains `isDateSelectable`, `monthBounds` (`{ months }` or `{ from }`), `rangeStart`, `rangeEnd`, `sizing` (`'fill'` default, `'content'`). `FloatingCalendar` takes the calendar props plus `anchor` (open while not null) and `onClose`. `useFloatingCalendarAnchor()` returns `{ anchorRef, anchor, open, close }`. Range helpers: `selectRangeDate`, `isDateInRange`, `isRangeEdge`, `isBetweenRangeEdges`, `isRangeComplete`, `EMPTY_CALENDAR_RANGE`.
  - RED/GREEN as reported by the writer: range helpers RED on a missing module, GREEN 12/12; Calendar and DayCell RED 15 failed, GREEN; floating calendar RED 12 failed against a skeleton, GREEN 20/20. The default-behavior guards are characterization tests with no RED.
  - Checks reported by the writer: `npx jest src/features/home` 126 passed; `npx jest src/features/shopping src/features/planner src/features/recipe` 542 passed; `npx tsc --noEmit` exit 0; `npm run lint` 0 errors, 7 warnings in untouched files; no color literal in touched sources.
  - Parent spot check: `npx jest src/features/home` 12 suites, 126 passed.
  - Decisions taken by the writer: a caller that passes `rangeStart` owns the selection; a day inside the range is `primaryAccent` at 30%; no scrim, the backdrop is a transparent pressable labelled "Cerrar"; the popover is 304 wide with a 36pt day and reserves six week rows.
- 2026-10-07: review of `9ffb79a..9c996c7`: medium (`slice_budget_reached`), consent **granted** by the owner, one lens (reliability), **approved** and acknowledged (lineage `review-518db616dc2e782f`). The reviewed boundary is now `9c996c7`. Non-blocking findings:
  - WARNING: no test presses a range end, so the one-day range (second tap on the start day) is proved only in the helper. Parent read `DayCell.tsx`: `onSelect` runs outside the `!isSelected` guard, so the behavior holds. The missing test goes into T4.
  - SUGGESTION: the popover is clamped horizontally only. Latent: both pills sit at the top of their screen. Follow-up, not in this feature.
  - SUGGESTION: the anchor's open path has no assertion for an unset ref or an unmeasurable view, and a translucent status bar can offset the popover on Android. Follow-up: check on Android.

- 2026-10-07: review assessment of `ccefe1f` from boundary `9c996c7`: `passive`, not due.
- 2026-10-07: **T3** `a66bb17` (20 files, +1165/−50; source +239/−45, tests +926/−5), same delegated writer.
  - Store: `chosenUntilDate` and `setChosenUntilDate`, persisted through `partialize`, version unchanged. Domain: `getSelectableUntilDates`, `resolveUntilDate`, `getUntilCalendar`, `formatUntilButtonLabel`; `deriveFullShoppingList` became `deriveCurrentShoppingList(sources, todayKey)`. Hook: `untilDate` is now the effective date, plus `untilCalendar` and `setUntilDate`. The pill owns the popover.
  - RED/GREEN as reported by the writer: domain RED 20 failed, GREEN; store RED on the new tests, GREEN; `readShoppingListItems` unwired to observe RED (3 failed), then restored; `useShoppingList` RED 11 failed, GREEN; pill RED 7 failed, GREEN 9/9. `useShoppingListItems` had no behavioral RED (the file was mid-rename).
  - Checks reported by the writer: `npx jest src/features/shopping` 393 passed; `npx jest src/features/home src/features/recipe src/features/planner` 338 passed, no recipe test changed; `npx tsc --noEmit` exit 0; `npm run lint` 0 errors, the same 7 warnings; no color literal in the 11 touched sources.
  - Parent spot check: `npx jest src/features/shopping` 17 suites, 393 passed.
  - Cart consistency: no code change needed. Count, sheet and purchase derive from the list, so a row the chosen day leaves out is not counted, shown or bought; its id stays in `cartIds`, so widening the range brings it back in the cart.
  - Existing tests changed: the screen test that asserted the pill is not a button now asserts it is; the `deriveFullShoppingList` test follows the rename.
  - Decisions taken by the writer: picking the last planned day clears the choice, so the list follows the plan as it grows; a day whose meals are all cooked is still selectable; the calendar marks only planned days from today on.
- 2026-10-07: review of `9c996c7..a66bb17`: medium (`slice_budget_reached`), consent **granted** by the owner, one lens (reliability), **approved** and acknowledged (lineage `review-fbf1fc69dde821da`). The reviewed boundary is now `a66bb17`. Non-blocking findings:
  - WARNING: with every planned meal in the past the pill is still a button and opens a calendar with no month and no selectable day. Accepted: **T5**.
  - WARNING: the rendered list reads today once per render, while an action reads it on every call (parent confirmed: `readShoppingListItems` calls `getTodayKey()`). If the chosen day passes at midnight with the screen mounted, a purchase could buy a carted row the screen still hides. Not fixed here: it needs a day-change subscription. Known limitation.
  - SUGGESTION: the stored date key is only validated inside the migration, which stored states at the current version never run. Low risk: `resolveUntilDate` ignores any value that is not a selectable day. Not acted on.
  - SUGGESTION: the default-argument test of `getTodayKey` reads the real clock twice. Accepted: **T5**.

- 2026-10-07: review assessment of `78cf685` from boundary `a66bb17`: `passive`, not due.
- 2026-10-07: **T5** `5724519` (7 files, +115/−35) and **T4** `97248dd` (8 files, +867/−4; source +180/−4, tests +687), same delegated writer.
  - T5: `getUntilCalendar` returns `undefined` when no day is selectable and the pill then renders the label only; `today.test.ts` uses fake timers.
  - T4: `src/features/planner/domain/planningRange.ts` (`getDefaultPlanningRange`, `isPlannableDate`, `getPlanningMonthBounds`, `getPlannedDaysFrom`, `formatPlanningRangeLabel`, `formatPlanningRangeButtonLabel`); hook `usePlanningRange()` returning `{ range, planByDate, isDateSelectable, monthBounds, selectDate }`; `PlannerHeader` uses the hook itself, `PlannerScreen.tsx` untouched. One test each in `Calendar.test.tsx` and `DayCell.test.tsx` for a press on a range end.
  - RED/GREEN as reported by the writer: T5 RED 6 failed, GREEN; T4 domain and hook RED on a missing module, GREEN 15/15 and 8/8; header RED 16 failed, GREEN 17/17. The `today` test change and the two home tests have no RED.
  - Checks reported by the writer: `npx jest src/features/planner src/features/shopping` 497 passed; `npx jest src/features/home src/features/recipe` 282 passed; `npx tsc --noEmit` exit 0; `npm run lint` 0 errors, the same 7 warnings.
  - Parent spot check: `npx jest src/features/planner src/features/shopping` 22 suites, 497 passed.
  - Decisions taken by the writer: short months are the first three letters of `MONTHS`; a one-day range reads `16 Septiembre`; the planner groups the plan by date itself because `buildLocalMealPlanByDate` is not in the Home barrel.
- 2026-10-07: **simulator pass** by the parent, iPhone 17 Pro, build `com.myfood.e2e` on Metro 8082 with the start-at-home bypass, at `97248dd`.
  - Shopping: the pill opens the calendar under itself; only 7 to 10 October can be picked; picking the 8th changed the pill to "Hasta 8 Oct" and the amounts (spinach 400 g to 300 g); a tap outside closes it.
  - Planner: the pill reads "7 - 13 Octubre"; a tap on the 15th leaves "Desde 15 Octubre" with the calendar open; a tap on the 20th closes it and the pill reads "15 - 20 Octubre".
  - Home: its calendar looks as before. The recipe screen reads "En la lista" for the listed ingredients.
  - Seen once and not reproduced: after picking a day in shopping, two taps on the pill did not reopen the calendar. Five more runs of the same sequence reopened it, with temporary logs (reverted) and with the committed code, from a cold start too. The tap tool also dropped the first tap after launch twice, so a dropped tap is possible; it is not confirmed.
  - Side effect on the simulator's local data: a test tap landed on "1 quitado · Restaurar" and restored a removed item.
- 2026-10-07: review of `a66bb17..97248dd`: medium (`slice_budget_reached`), consent **granted** by the owner, one lens (reliability), **approved** and acknowledged (lineage `review-f9f52665f0944950`). The reviewed boundary is now `97248dd`. Non-blocking findings, all SUGGESTION:
  - `selectDate` resolves a tap against the range captured at render, so two taps before a re-render would both set a start. Accepted: **T6**.
  - The Planner reads today on every render but seeds the default range once, so across midnight the range can start on a day that is no longer selectable. Known limitation, the same class as the shopping one.
  - The Planner pill's fill moved to a child, so the view that carries the shadow has no background and may cast no shadow on Android. The shadow shows on iOS (simulator). Accepted: **T6**.
- 2026-10-07: the owner changed the Planner rule (decision 6) and asked for two more things (decisions 11 and 12) after seeing the result: tasks **T6**, **T7** and **T8**.

- 2026-10-07: review assessment of `296d25f` from boundary `97248dd`: `passive`, not due.
- 2026-10-07: **T6** `5a74ee8` (6 files, +328/−71), **T7** `5505284` (7 files, +128/−17) and **T8** `90f64c8` (6 files, +95/−4), same delegated writer.
  - T6: `getFirstPlannableDate(entries, todayKey)` and `resolvePlanningRange(pickedRange, firstPlannableDate)`; `getDefaultPlanningRange`, `isPlannableDate` and `getPlanningMonthBounds` now take the first plannable day. The hook stores only what the user picked and derives the range on each render, so a range the plan overtakes falls back to the default with no effect; `selectDate` is stable and reads a ref. The pill's `Pressable` carries the fill again under the animated layer.
  - T7: `getFirstUntilDate(entries, todayKey)`; `ShoppingUntilCalendar` gains `rangeStart`; the pill passes `rangeStart` and `rangeEnd` and no longer `selectedDate`.
  - T8: both screens keep `TitlePrimary` and override `titleFontSize` with 28 (`INVENTORY_TITLE_FONT_SIZE`, `SETTINGS_TITLE_FONT_SIZE`). `TitlePrimary` takes no line height, so COMPRAS's explicit 34 is not matched. Home's title is untouched.
  - RED/GREEN as reported by the writer: T6 domain RED 10 failed, hook RED 9 failed (the two-taps-before-a-render test among them), header RED on the fill test only; T7 RED 12 failed; T8 RED 4 failed (48 at the default window, 38 on a small phone). All GREEN.
  - Checks reported by the writer: `npx jest src/features/planner src/features/shopping src/features/inventory src/features/settings` 736 passed; `npx jest src/features/home src/features/recipe` 282 passed; `npx tsc --noEmit` exit 0; `npm run lint` 0 errors, the same 7 warnings.
  - Parent spot check: the same four-feature command, 34 suites, 736 passed.
- 2026-10-07: **simulator pass** by the parent at `90f64c8`, same device and build, a second Metro on 8082 (the owner's own Metro on 8081 left alone).
  - Planner: 7 to 10 October (planned) are dimmed and a tap on the 9th does nothing; the pill reads "11 - 17 Octubre".
  - Shopping: with "Hasta 9 Oct" the calendar draws 7 and 9 as ends and the 8th as the tint.
  - Inventory: the title is at the COMPRAS size.
  - Not seen: Ajustes, which redirects without a real session.
- 2026-10-07: review of `97248dd..90f64c8`: medium (`slice_budget_reached`), consent **granted** by the owner, one lens (reliability), **approved** and acknowledged (lineage `review-1d123b12a971772f`). The reviewed boundary is now `90f64c8`. Non-blocking findings, both SUGGESTION:
  - With a plan that reaches the end of the month, the Planner's bounds start next month and only a mocked calendar tests it. Parent read `useCalendarState.ts`: with `{ from }` bounds a displayed month before the first one moves to it, so the real calendar opens inside the bounds. Not acted on.
  - The value 28 is written in each feature and each test, so nothing binds the two titles to the shopping title. Reported to the owner as a choice: a single definition needs a shared file outside the request.
- 2026-10-07: **delivered.** The owner confirmed the merge: `feat/floating-calendar` merged into `Develop` with `--no-ff` as `48a65da` and pushed to `origin/Develop` (`9ffb79a..48a65da`). On the merge result: `npx jest` over home, planner, shopping, inventory, settings and recipe, 56 suites, 1018 passed; `npx tsc --noEmit` exit 0.

## Pending and unverified

- Android was never run: the popover's vertical position under a translucent status bar and the pills' shadows are unverified there. The writer notes `ShadowSurface` is also a view without a background, so the shopping pill may share the shadow question.
- The Ajustes title was not seen on a device.
- The Planner does not follow a day change while mounted (see the T4 review).
- The shopping list does not re-derive at midnight until something re-renders (see the T3 review).
- The calendar opens on the current month, not on the month of the selected day.

## Next step

None in this feature. The follow-ups are the ones listed under "Pending and unverified".
