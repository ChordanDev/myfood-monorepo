# Code Context

## Files Retrieved

1. `app/_layout.tsx` (lines 30, 74-80) - mounts `RecipeThemeProvider` around the whole Expo stack.
2. `src/context/RecipeThemeContext.tsx` (lines 4-75) - defines default recipe theme, provider state, `setRecipeTheme(null)` fallback behavior, and context `useRecipeTheme`.
3. `src/features/home/hooks/useHomeRecipeTheme.ts` (lines 1-18) - only caller of context `setRecipeTheme`; currently applies selected meal recipe theme regardless of selected date.
4. `src/features/home/screens/HomeScreen.tsx` (lines 20-29, 42-49, 68-105) - wires `selectedDate`/`selectedMeal` from `useHomeState`, uses `useHomeRecipeTheme`, and passes themed colors to the home gradient and child components.
5. `src/features/home/hooks/useHomeState.ts` (lines 13-72) - derives `todayKey`, `selectedDate`, `mealsForSelectedDate`, `selectedMealType`, and `selectedMeal`.
6. `src/features/home/domain/localMealPlan.ts` (lines 21-34, 55-77, 88-95) - builds entries by date, chooses initial selected date, joins selected meal entry to current recipe/theme, and gates selectable dates.
7. `src/features/home/domain/recipeThemeSelection.ts` (lines 1-5) - returns `selectedMeal?.theme ?? null`.
8. `src/features/home/hooks/useCalendarState.ts` (lines 13-102) - computes `todayKey`, active selected date, and date selection behavior for calendar.
9. `src/features/home/components/Calendar.tsx` (lines 22-36, 93-119) - consumes current context theme and computes per-day `isToday`/`isSelected`.
10. `src/features/home/components/DayCell.tsx` (lines 32-51) - consumes current context theme for selected/today/planned day styling.
11. `src/hooks/useThemeColor.ts` (lines 1-23) - common context-theme color accessor used by themed components.
12. `src/features/recipe/hooks/useRecipeTheme.ts` (lines 5-35) - separate recipe-detail theme hook; not the context hook, but it applies `recipe.theme` whenever present.
13. `src/features/recipe/screens/RecipeScreen.tsx` (lines 9-17, 55-89) - recipe detail derives recipe by route id and uses the separate feature theme hook.
14. `src/store/useMealPlanStore.ts` (lines 8-45) - store source for `entries`, `recipes`, `getRecipeById`, and meal-plan lookup.

## Key Code

`src/context/RecipeThemeContext.tsx`:

```ts
const DEFAULT_THEME: RecipeThemeConfig = { ... };

export function RecipeThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<Partial<RecipeThemeConfig> | null>(null);

  const theme = useMemo(() => {
    if (!currentTheme) return DEFAULT_THEME;
    return { ...DEFAULT_THEME, ...currentTheme, ...fallbacks };
  }, [currentTheme]);

  const setRecipeTheme = useCallback((newTheme: RecipeThemeConfig | null) => {
    setCurrentTheme((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(newTheme)) return prev;
      return newTheme;
    });
  }, []);
}
```

Important behavior: `setRecipeTheme(null)` makes `theme` become `DEFAULT_THEME`.

`src/features/home/hooks/useHomeRecipeTheme.ts`:

```ts
export function useHomeRecipeTheme(selectedMeal: LocalMealSelection | null) {
  const { theme, setRecipeTheme } = useRecipeTheme();

  useEffect(() => {
    const timer = setTimeout(() => {
      setRecipeTheme(getThemeForLocalMealSelection(selectedMeal));
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedMeal, setRecipeTheme]);

  return theme;
}
```

This is the enforcement point: it is the only `setRecipeTheme` usage found under `src`.

`src/features/home/hooks/useHomeState.ts` selected date/current recipe derivation:

```ts
const todayKey = formatDateKey(new Date());
const planByDate = useMemo(() => buildLocalMealPlanByDate(entries), [entries]);
const availableDateKeys = useMemo(() => Object.keys(planByDate), [planByDate]);
const [selectedDate, setSelectedDate] = useState<string | null>(() =>
  getInitialSelectedDate(availableDateKeys, todayKey)
);
const mealsForSelectedDate = useMemo(() => {
  if (!selectedDate) return [];
  return planByDate[selectedDate] ?? [];
}, [planByDate, selectedDate]);
const selectedMeal = useMemo(() => {
  return getSelectedLocalMeal(mealsForSelectedDate, recipes, selectedMealType);
}, [mealsForSelectedDate, recipes, selectedMealType]);
```

`src/features/home/domain/localMealPlan.ts` current recipe/theme join:

```ts
const selectedEntry = entries.find((entry) => entry.type === selectedMealType);
const recipe = recipes.find((candidate) => candidate.id === selectedEntry.recipeId);
return {
  ...selectedEntry,
  description: recipe?.description ?? 'Sin descripción',
  imageUrl: recipe?.imageUrl,
  theme: recipe?.theme,
};
```

## Architecture

- `app/_layout.tsx` wraps the entire navigation stack in `RecipeThemeProvider`.
- The provider exposes a global `theme` plus `setRecipeTheme`. Null theme means default colors from `src/context/RecipeThemeContext.tsx`.
- Home data flow:
  1. `useMealPlanStore()` supplies `entries` and `recipes`.
  2. `useHomeState()` formats today's date, groups entries by date, chooses/updates `selectedDate`, filters meals for that date, picks a meal type, and joins the meal entry to its `MasterRecipe` to produce `selectedMeal.theme`.
  3. `HomeScreen` calls `useHomeRecipeTheme(selectedMeal)`, receives the context theme, and uses it for the screen gradient.
  4. `Calendar`, `DayCell`, `FoodCard`, `AddCircleButton`, auth components, and other shared components consume the same context theme via `useRecipeTheme()` or `useThemeColor()`.
- Calendar selection is controlled by `selectedDate` from `useHomeState`; `useCalendarState` separately computes `todayKey` for UI state.
- Recipe detail has a separate hook with the same name at `src/features/recipe/hooks/useRecipeTheme.ts`; it does not use `RecipeThemeContext` and currently themes any recipe with `recipe.theme` regardless of selected date.

## Start Here

Start with `src/features/home/hooks/useHomeRecipeTheme.ts`. It is the narrowest enforcement point because it is the only place that calls context `setRecipeTheme`, and `setRecipeTheme(null)` already restores the default theme.

Recommended minimal implementation steps:

1. Change `useHomeRecipeTheme` signature to accept `selectedDate: string | null` in addition to `selectedMeal`.
2. Import `formatDateKey` from `src/features/home/utils/calendarDate`.
3. Inside the effect, compute `const isTodaySelected = selectedDate === formatDateKey(new Date());`.
4. Call `setRecipeTheme(isTodaySelected ? getThemeForLocalMealSelection(selectedMeal) : null);`.
5. Add `selectedDate` to the effect dependency array.
6. Update `HomeScreen` line 29 from `useHomeRecipeTheme(selectedMeal)` to `useHomeRecipeTheme(selectedMeal, selectedDate)`.
7. Keep `RecipeThemeContext.tsx` unchanged; its existing null behavior already returns the default theme.
8. If product scope includes the recipe detail screen too, add a separate decision/implementation: `RecipeScreen` currently lacks selected-date context and uses a separate theme hook. It would need a date param from Home navigation or explicit entry-date lookup before it can enforce “today only” there.

Risk/constraint: when leaving Home to another tab/screen, the last context theme persists unless a screen/hook resets it. This task’s minimal home-date enforcement resets on non-today Home selections, but does not globally reset on navigation unless those screens mount a reset or Home selection changes.
