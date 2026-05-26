# Code Context

## Files Retrieved

1. `src/features/home/screens/HomeScreen.tsx` (lines 41-55, 112-159, 174-201) - owns Home theme selection, already crossfades page background, passes raw theme colors into children.
2. `app/(tabs)/_layout.tsx` (lines 21-84, 94-125) - custom tab bar; background already crossfades, but button/icon colors still snap.
3. `src/features/home/components/Calendar.tsx` (lines 22-23, 41-84, 101-115) - calendar surface/header/weekday/divider/text colors come directly from theme.
4. `src/features/home/components/DayCell.tsx` (lines 32-51, 67-80) - day circle fill/border/text colors switch directly on theme.
5. `src/features/home/components/FoodTypeSwitcher.tsx` (lines 49-74, 85-93, 132-154) - switcher text, background, and active pill colors derive from theme/useThemeColor and snap.
6. `src/features/home/components/FoodCard/FoodCard.tsx` (lines 32-45, 57-69, 96-106, 117-156) - SVG gradient stops, sparkles button, day label, number, description colors snap.
7. `src/features/home/components/FoodCard/icons.tsx` (lines 4-29, 33-43) - star/sparkles SVG fills/strokes use raw theme colors.
8. `src/features/home/components/EatTodayButton.tsx` (lines 43-65) - receives theme colors from HomeScreen and applies raw background/border/text colors.
9. `src/components/AddCircleButton.tsx` (lines 25-27, 73-97) - used by Home; rotating gradient colors, inner background, and plus icon color use raw theme colors.
10. `src/components/TitlePrimary.tsx` (lines 10-22) - used by Home; title text color comes directly from theme.
11. `src/hooks/useThemeColor.ts` (lines 10-25) - returns current theme and opacity helper only; no transition state.
12. `src/hooks/useGradientCrossfade.ts` (lines 11-43) - existing 450ms opacity crossfade helper for two-color gradients.
13. `src/features/home/hooks/useHomeRecipeTheme.ts` (lines 7-24) - changes RecipeThemeContext 100ms after selected meal/date changes.

## Key Code

Existing animated pieces:

```tsx
// Home background already crossfades.
const backgroundColors: [string, string] = [theme.colorDark, theme.appBg];
const { currentColors, previousColors, animatedStyle } = useGradientCrossfade(backgroundColors);
```

```tsx
// Tab bar background already crossfades.
const tabBarBackgroundColors: [string, string] = [theme.colorDark, theme.colorBlack];
```

Theme-driven props/styles still abrupt, prioritized:

1. **FoodCard SVG and text (`src/features/home/components/FoodCard/FoodCard.tsx`)**
   - Animate `<Stop stopColor={theme.colorMedium} />` and `<Stop stopColor={theme.colorDark} />` (lines 65-66), or crossfade whole card SVG layers.
   - Animate sparkles button `backgroundColor`/`borderColor` (lines 99-100).
   - Animate label colors: `dayNameColor`, `theme.primaryAccent`, `theme.textLight` (lines 45, 122, 130, 150).

2. **Calendar + DayCell (`Calendar.tsx`, `DayCell.tsx`)**
   - `Calendar`: surface `backgroundColor: theme.colorLight` (line 43), nav/header/weekday `color: theme.textDark` (lines 52, 56, 76), divider `backgroundColor: theme.colorDark` (line 84), computed day `textColor` (lines 101-105).
   - `DayCell`: circle `backgroundColor: colors.bg`, `borderColor: colors.border`, and day text `color: textColor` (lines 74-79). These are high-visibility because many cells update at once.

3. **FoodTypeSwitcher (`FoodTypeSwitcher.tsx`)**
   - Container `backgroundColor: theme.colorDark` (line 153).
   - Indicator `backgroundColor`/`borderColor` from `getColorWithOpacity('icon', ...)` (lines 140-141).
   - Item text colors `theme.textMedium`, `theme.textLight`, and faded unavailable color (lines 65-69).
   - Keep existing position/width/height timing; add color timing separately.

4. **Custom tab button (`app/(tabs)/_layout.tsx`)**
   - Animated oval `backgroundColor`/`borderColor` (lines 69-70) snap even though width/opacity animate.
   - Icon `color` passed to `Ionicons` (line 79) snaps for focused/unfocused states.
   - Tab bar gradient background itself is already covered by `useGradientCrossfade` (lines 94-125).

5. **Home edge controls and title**
   - `EatTodayButton` props from HomeScreen `backgroundColor={theme.primaryAccent}`, `textColor={theme.textBlack}`, `borderColor={theme.primaryAccentIntense}` (HomeScreen lines 151-158; applied in EatTodayButton lines 57-62).
   - `AddCircleButton`: LinearGradient `colors` (lines 75-80), inner `backgroundColor: theme.colorDark` (line 92), plus icon `color={theme.primaryAccent}` (line 96).
   - `TitlePrimary`: title `color: theme.textDark` (line 21).

## Architecture

`useHomeRecipeTheme(selectedMeal, selectedDate)` writes to `RecipeThemeContext` after a 100ms timeout. Any component using `useRecipeTheme()` or `useThemeColor()` re-renders with the new theme immediately. Only the large Home background and custom tab bar background currently crossfade via `useGradientCrossfade`, which overlays previous/current gradients and animates opacity for 450ms. Most child components apply new `backgroundColor`, `borderColor`, `color`, `fill`, `stroke`, or SVG `stopColor` directly, causing abrupt changes during the same theme swap.

For a total theme transition, likely introduce/reuse a color transition primitive for single colors and SVG colors, or crossfade grouped visual layers where direct color animation is hard (`react-native-svg` gradient stops, Ionicons color). Keep existing layout/selection animations separate from theme color animation.

## Start Here

Start with `src/features/home/components/FoodCard/FoodCard.tsx`: it contains the most noticeable unanimated theme surfaces (card SVG gradient, labels, description, sparkles button) and will establish the pattern needed for the rest.

## Prioritized Animation Targets

1. FoodCard card gradient + all FoodCard text/icon/button colors.
2. Calendar surface/header/divider/day cell fills/borders/text.
3. FoodTypeSwitcher container, active pill, and text colors.
4. Custom tab button oval/icon colors; tab bar background is already animated.
5. Home title, EatTodayButton, and AddCircleButton theme colors.

## Should Not Be Animated

- `FloatingFoodImage` image/source and its layout/position: not theme-colored.
- Calendar month navigation disabled opacity, press `active:scale-95`, haptics, and layout sizes: interaction/layout state, not theme transition.
- FoodTypeSwitcher indicator translate/width/height/opacity: already selection animation; only add color transition.
- `ShadowSurface` static shadow/elevation: not theme-driven.
- Route navigation, auth redirect, and meal/date state changes: not visual color props.

## Supervisor coordination

No blocker. Engram tools were not available in this subagent toolset, so no memory save was performed.
