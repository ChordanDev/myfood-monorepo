import { useEffect } from 'react';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { LocalMealSelection } from '../domain/localMealPlan';
import { getThemeForLocalMealSelection } from '../domain/recipeThemeSelection';
import { formatDateKey } from '../utils/calendarDate';

export function useHomeRecipeTheme(
  selectedMeal: LocalMealSelection | null,
  selectedDate: string | null
) {
  const { theme, setRecipeTheme } = useRecipeTheme();

  useEffect(() => {
    const timer = setTimeout(() => {
      const todayKey = formatDateKey(new Date());
      const isTodaySelected = selectedDate === todayKey;

      setRecipeTheme(isTodaySelected ? getThemeForLocalMealSelection(selectedMeal) : null);
    }, 100);

    return () => clearTimeout(timer);
  }, [selectedDate, selectedMeal, setRecipeTheme]);

  return theme;
}
