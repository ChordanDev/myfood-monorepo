# home-theming-gaps

## Objective

Close the three Home-screen rows of the "Known gaps" table in `docs/THEMING.md`
so every Home color comes from the active meal palette.

## Problem and why

`docs/THEMING.md` forbids color literals in components, styles and SVG strings.
Three small Home violations remain; one of them (`PLUS_SVG`) silently ignores
the `color` prop its only consumer already passes.

## Scope

- `src/constants/svgIcons.ts` (`PLUS_SVG` stroke)
- `src/components/AddCircleButton.tsx` and its test
- `src/features/home/components/EatTodayButton.tsx` (pill border) and a new test
- `src/features/home/components/FoodCard/constants.ts` (unused literal)
- `docs/THEMING.md` "Known gaps" table

## Constraints

- Out of scope: `src/features/recipe/` and `src/constants/theme.ts`.
- No token added, renamed or removed.
- Conventional commits, no AI attribution.
- Branch `claude/practical-robinson-99bf03`, fast-forwarded from `master` to
  `feat/home-screen-improvements` (9a53c3b) because the target files do not
  exist on `master`.
- RDD is off for this clone (`clone_local`); no native review is started.
- Delivery strategy: `ask-on-risk`; forecast well under 400 changed lines.

## Tasks

- [x] T1 `PLUS_SVG` stroke follows the passed color. Route: inline (mechanical
      one-line change plus test extension). Test-first: assert through the real
      `SvgXml` parser that the root `Svg` gets `stroke="currentColor"` and
      `color={theme.primaryAccent}`.
- [x] T2 `EatTodayButton` pill border comes from the palette and animates via
      `useAnimatedThemeStyle`. Route: inline (one file plus new test).
      Test-first: border view carries the label color, never `#000000`.
- [x] T3 Remove unused `FOOD_CARD_ICON_COLOR`. Route: inline. No runnable RED
      (dead export); proof is an empty repo-wide search plus typecheck.
- [x] T4 Remove the three resolved rows from `docs/THEMING.md`. Route: inline,
      passive doc edit, structural readback. The docs landed on
      `feat/home-screen-improvements` as 996d3f7 mid-task; the branch was
      rebased onto it before editing the table.

## Checks

- `npx jest src/components/__tests__/AddCircleButton.test.tsx src/features/home`
- `npx jest` (full suite at closure)
- `npm run lint`
- `npx tsc --noEmit`

## Progress and evidence

- T1 bc1caa4: RED observed (`stroke` was `#FFB63C`), GREEN after `currentColor`.
- T2 06ccf30: RED observed (`borderColor` was `#000000`), GREEN after
  `useAnimatedThemeStyle({ borderColor: textColor })`.
- T3 fad2792: repo-wide search for `FOOD_CARD_ICON_COLOR` returns nothing.
- T4 e8d78f3: three rows removed, structural readback done.
- Affected tests: 5 suites, 28 tests pass. `npm run lint`: 0 errors, 7 warnings
  (6 pre-existing files/lines, none introduced).
- Full jest: 33 of 34 suites pass; `authErrorCodeContract.test.ts` fails (2
  tests) and does not import any changed file. Not verified on the base.
- `tsc --noEmit`: 22 errors, all in four auth/services test files (missing
  node types); none in changed files.
- Review: RDD off (`clone_local`), not assessed.
- Not verified on a simulator; proof is the jest test through the real
  `SvgXml` parser.
- Engram mirror: observation #3552, topic `odd/home-theming-gaps/tasks` (saved
  through the CLI after `mem_save` refused on multiple active sessions).

## Next step

Fast-forward merge of `claude/practical-robinson-99bf03` into
`feat/home-screen-improvements`, requested by the user. Push and pull request
stay with the user. Open follow-ups: simulator check of the plus glyph and the
pill outline; `authErrorCodeContract.test.ts` failure.
