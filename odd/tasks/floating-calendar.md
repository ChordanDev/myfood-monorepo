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
6. **Planner, selectable days:** any day from today on, planned or not. Planned days keep their mark so the user sees what is already covered. Months go from the current one forward.
7. **Planner, range gesture.** First tap sets the start. A second tap on that day or a later one sets the end and closes the popover. A tap before the start moves the start. A tap with a complete range starts a new one.
8. **Planner, default range:** the seven days starting today, so the pill always reads as a range.
9. **Planner, label.** Same month: `16 - 24 Septiembre`. Across months: `28 Sep - 3 Oct`. Start only: `Desde 16 Septiembre`.
10. **Planner, state.** The range is held by the Planner (its store if it has one, otherwise screen state). Nothing consumes it yet besides the pill.

Decisions 3 to 9 are assumptions taken from the request, not confirmed one by one. They are each a small rule to change.

## Tasks

- [x] **T1 — Calendar rules.** `Calendar` and `useCalendarState` accept the selectable-day rule, the month bounds and a range; `DayCell` draws the range (ends as selected, days between as a tint). Pure range helpers. Home unchanged. Tests RED first. Route: delegated writer (2+ non-trivial files). Commit `423cf0d`.
- [x] **T2 — Floating calendar.** Popover wrapper anchored under its trigger, exported from `@/features/home`. Tests for open, pick and dismiss. Route: delegated writer (with T1). Commit `9c996c7`.
- [ ] **T3 — Shopping "Hasta".** Chosen day in the store with its fallback; the derivation, the hook and the pill use it; the pill becomes a button that opens the floating calendar. Tests RED first. Route: delegated writer.
- [ ] **T4 — Planner range.** Range helpers and label formatter; the header pill opens the floating calendar in range mode and shows the label. Tests RED first. Route: delegated writer.

## Acceptance criteria

- [ ] Pressing the shopping pill opens a calendar under it; only planned days from today on can be picked.
- [ ] Picking a day updates the pill label, the cards and the counters to what is needed up to that day.
- [ ] Pressing the Planner pill opens the same calendar; two taps select a range and the pill shows it.
- [ ] A tap outside closes the calendar on both screens.
- [x] The Home calendar looks and behaves as before. (Existing Home tests untouched and green; not yet looked at on the simulator.)
- [ ] No color literal outside the allowed ones in the touched code.

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

## Pending and unverified

- No simulator pass yet: the popover's look is unverified until T3 wires it to a screen.
- The calendar opens on the current month, not on the month of the selected day.

## Next step

T3, same delegated writer.
