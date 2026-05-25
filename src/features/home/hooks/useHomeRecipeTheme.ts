import { useEffect } from 'react';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { LocalMealSelection } from '../domain/localMealPlan';
import { getThemeForLocalMealSelection } from '../domain/recipeThemeSelection';

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
