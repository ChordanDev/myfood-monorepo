# planner-composer-native-height

- **Branch:** `feat/planner-composer-native-height` (from `Develop` @ 7521791)
- **Worktree:** `../my-expo-app-worktrees/planner-composer` (the main checkout is in use by another session)
- **Engram mirror:** `odd/planner-composer-native-height/tasks`
- **Delivery strategy:** `ask-on-risk`. Forecast exceeds ~400 authored lines because the mechanism-locked composer test suite (1174 lines) is replaced together with the component; the change is one cohesive work unit and cannot stay green if split. PR slicing is deferred to the owner at PR time. Owner decision (2026-10-06): no pull request; merge the branch into `Develop` and push.

## Objective

Let the native `TextInput` own the planner composer's height so the box grows and shrinks in the same layout pass as the text, on both platforms, at any system font scale.

## Problem

`PlannerChatInput` grows through three `TextInput`s: a visible one pinned to a JS-computed height, and two hidden ones measured through `onContentSizeChange`, plus a frame whose height is a Reanimated shared value. On Android the owner sees the box shrink and regrow once it is tall. Source review of RN 0.86.3 found:

- `scrollEnabled` has no Android implementation, so a JS-pinned height makes the `EditText` scroll one line on every wrap and snap back.
- Hidden `TextInput`s driven by `value` are set twice per keystroke on Android (span-less command, then Fabric state), giving two different content heights; a lone span-less reading rounds one line low between 4 and 9 wrapped lines.
- All heights are multiples of a fixed 24dp while Android scales line height by the system font scale (non-linearly on API 34+).

Nobody reproduced this on a device; the second item is the best-supported hypothesis, not a confirmed cause.

## Scope

In: `src/features/planner/components/PlannerChatInput.tsx`, a pure layout resolver next to it, their tests, and the composer wiring in `PlannerScreen.tsx` plus its test. Added after device testing at the owner's request: the Android branch of `src/hooks/useKeyboardAnimation.ts` (T5) and the conversation's trailing space in `PlannerScreen.tsx` (T6).

Out (follow-ups, not authorized here): dead `+` / mic buttons, keyboard-aware conversation list, responsive line cap, copy and accessibility labels, moving the draft state into the composer.

## Design decisions (v2, after a three-lens source challenge)

1. One editable multiline `TextInput` with no `height`; `minHeight` one native line, `maxHeight` N native lines. No hidden `TextInput`s, no pixel-to-line arithmetic.
2. Layout mode is a pure function: `inline` (text between the buttons) when the value is empty or fits one inline line, `stacked` (text above the controls) when the value has a newline or a hidden `Text` probe reports more than one line. The probe geometry never depends on the mode.
3. Native line height is taken from the probe's `onTextLayout` (`lines[0].height`), falling back to `24 * fontScale` before the first event. It drives `minHeight`, `maxHeight` and the inline vertical padding.
4. Line cap keeps the composer at or below today's 312dp: `maxLines = clamp(floor(240 / lineHeight), 2, 10)`; in inline mode the input is capped at 2 lines so a paste cannot grow the pill and then shrink it.
5. Android and reduced motion: the frame has no height style at all and the content is in normal flow (`alignSelf: 'stretch'`). iOS without reduced motion: content pinned at the top, frame height tweened 180ms toward the measured content height (first measurement assigned directly).
6. A single height source reaches the screen: `onHeightChange(contentHeight)` from the content `onLayout`, deduplicated with a 1dp tolerance. `onRenderedHeightChange` is removed.
7. `scrollEnabled` (iOS only) turns on when the input's own laid-out height reaches the cap.
8. Visible input uses `textBreakStrategy="simple"` and a single-space native `placeholder` so an empty input measures exactly one line; the custom placeholder overlay stays.

## Tasks

- [x] **T1 — Native-owned composer height.** Route: delegated writer (2+ non-trivial files, reading prepares the write). Test-first: RED observed (32 failing of 49 before any production change), then GREEN. Commit `fcec15d`.
- [x] **T2 — Independent review of the T1 commit and at most one bounded correction.** Route: delegated (receipt-driven development is off for this clone; `gentle-ai review assess` tier: medium, `executable_change`). Three read-only lenses reported 17 findings: 4 major, all confirmed by an adversarial pass and all test gaps (no production defect); 13 minor. Correction commit `564af14` (tests only).
- [x] **T2b — Line cap on fractional pixel densities.** Route: inline (one pure function and its test). A minor review finding the parent chose to fix: screens that round the 24dp line up to a whole pixel (393dpi, 450dpi, 374dpi) fit only 9 lines. RED observed (3 failing), then GREEN. Commit `41b57fa`.
- [x] **T3 — Device verification on Android and iOS.** Route: owner. Result (2026-10-06, iOS simulator and Android via Expo Go): growth works on both platforms; the Android shrink/regrow is gone. Three defects reported, tracked as T4-T6.
- [x] **T4 — iOS: the empty input stays two lines tall after sending a multi-line message.** Commit `06789e7`. RED observed (3 failing), then GREEN. A reviewer re-derived the cause from source and confirmed it, with one correction: every clone of the input is re-measured, so the clearing commit does measure, but against the stale state, and nothing clones the node again. No blocker or major finding. Not yet confirmed on the simulator (access request went unanswered). Route: delegated writer (with T5). Cause, read in RN 0.86.3 source: `BaseTextInputShadowNode` measures with the text held in the previous Fabric state and refreshes that state in `layout()`, after measurement; the commit that clears the value therefore measures the old text, the inline cap clamps it to two lines, and nothing measures again because `setTextAndSelection` only pushes state when the native text differs. Fix: an empty input is exactly one line (`maxHeight` equals the line height while the value is empty).
- [x] **T5 — Android: the composer ends slightly under the keyboard.** Commit `ed8a7b9`. RED observed (16 failing), then GREEN. The new formula is geometrically exact in every configuration the reviewer derived (gesture and 3-button navigation, edge to edge or not). Correction to the cause stated below: JS `Dimensions.get('window')` comes from `DeviceInfoModule.kt:41-67`, which has three regimes; when React Native's edge-to-edge flag is on the old formula was already exact and this commit changes nothing on that device. Which regime Expo Go is in cannot be read from `node_modules`, so only the owner's re-test decides whether the symptom is gone. If it persists, log `event.endCoordinates.height` and `screenY`, `insets.bottom`, and the window and screen heights on `keyboardDidShow`. Both T4 and T5 merged into `feat/home-screen-improvements` as `9a53c3b`. Route: delegated writer (with T4). Cause, read in source: the lift treats `useWindowDimensions().height` as the container height, but that value comes from the resource display metrics, which exclude system decor, while the edge-to-edge container is taller by the navigation-bar inset. Fix: on Android derive the lift from the keyboard height the event reports (`imeInsets.bottom - barInsets.bottom`) plus the bottom safe-area inset; iOS keeps the `screenY` geometry.
- [x] **T6 — After sending, the conversation scrolls until every message leaves the viewport.** Commits `f335678` (exact reservation, pure `resolveTurnTrailingSpace`, RED 27 failing then GREEN) and `d08dd18` (iOS inset). Two read-only lenses: no blocker or major, 7 minor. Verified by the parent on an iPhone 16e simulator: with `f335678` alone the list stopped but could be dragged exactly 34pt past the anchor, cutting the top of the bubble, because `contentInsetAdjustmentBehavior="automatic"` made iOS add the bottom safe area a second time; with `d08dd18` (`"never"`) the same drag leaves the sent bubble 16pt below the top of the list, with the keyboard closed and open. Merged into `feat/home-screen-improvements` as `daf60c9`. Not yet tried on Android. T4 was confirmed in the same session: after sending a 16-line message the composer returned to the 72pt pill. Cause: the trailing spacer reserves almost a full viewport regardless of how tall the active turn is. Owner decision (2026-10-06): keep turn anchoring. Route: delegated writer, after the T4/T5 writer finishes (single writer per worktree). Fix: size the spacer exactly, `max(0, usableViewport - topInset - (spacerY - activeTurnY))`, so the furthest scroll position is the anchored one; fall back to the full reservation until both positions are measured. With a turn taller than the viewport the spacer is zero and the last message sits right above the composer; with a short turn a gap remains below the reply by design.

## Acceptance criteria

- The tree contains exactly one `TextInput`; its style has no `height`.
- On Android and under reduced motion the frame style has no `height` key.
- Typing, sending, clearing, the thinking state, the send-button reveal, the keyboard lift and the control positions behave as before.
- `inline` and `stacked` modes resolve as described and never depend on their own output.
- `PlannerScreen` receives the composer height from one prop.

## Checks

- `npx jest src/features/planner src/hooks` — all pass.
- `npx jest` — no new failures. Known on base: `src/services/__tests__/authErrorCodeContract.test.ts` (2 tests, needs a sibling back-end checkout).
- `npx tsc --noEmit` — no errors in touched files. Known on base: 22 errors in `src/features/auth/__tests__/maestroSelectors.contract.test.ts` and `src/services/__tests__/*`.
- `npx eslint src/features/planner src/hooks` and `npx prettier -c "src/features/planner/**/*.{ts,tsx}"` — clean.

## Progress

- Baseline on the branch point: planner + hooks 45/45 passing; full suite 230/232 with the 2 known failures above.
- After `41b57fa` (parent re-ran every check): planner + hooks 93/93; full suite 278/280 with the same 2 known failures; `tsc` 22 errors, same as base and none in planner; eslint and prettier clean.
- Authored lines over the three commits: 6 files, about +990 / -940, dominated by replacing the composer test file.
- Merged at the owner's request into `feat/home-screen-improvements` in the main checkout as `2a90e8f` (no conflicts); planner + hooks 93/93 there. `Develop` itself was not changed.
- Not pushed. `Develop` moved to `3c1c2bb` during the work (home-screen changes and a dependency bump); none of it touches `src/features/planner` or `src/hooks`.

## Known limits (accepted, not fixed)

- Nothing was run on a device. The Android cause was a source-backed hypothesis; the redesign removes the mechanism it depends on, but only T3 can confirm the symptom is gone.
- Above a 48dp native line (iOS accessibility sizes over 2.0x) the inline two-line height exceeds the stacked one-line height, so the inline-to-stacked switch grows and then shrinks by the difference for a few frames.
- Android lays out the empty line after Enter without the line-height span: the box grows about 20dp on Enter and about 4dp more on the first character. This is stock React Native behaviour for any auto-growing input.
- The growth mechanism has no web implementation (`onTextLayout` and native auto-grow); the planner is not a web target today.
- A placeholder that wraps to two lines on narrow phones is now centred on the pill instead of starting at the first text line.

## Next step

Owner re-test on Android through Expo Go: the gap between the composer and the keyboard (T5), and that a short sent message stops 16dp below the top of the list without being cut (T6). If the composer is still under the keyboard, log `event.endCoordinates.height` and `screenY`, `insets.bottom`, and the window and screen heights on `keyboardDidShow`.

Not part of this feature and still open: the conversation is not keyboard-aware (the last messages sit behind the lifted composer), the composer's `+` and mic buttons do nothing, and the composer has no accessibility label.
