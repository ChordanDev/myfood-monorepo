import { useEffect, useLayoutEffect } from 'react';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useRecipeCacheStore } from '@/features/recipe/store';
import type { LocalMealSelection } from '../domain/localMealPlan';
import { formatDateKey } from '../utils/calendarDate';

/**
 * Recolors the app with the palette of today's selected meal, read from its Recipe in the recipe
 * cache, and returns that Recipe's image. Any other day keeps the default palette and image.
 */
export function useHomeRecipeTheme(
  selectedMeal: LocalMealSelection | null,
  selectedDate: string | null
) {
  const { theme, setRecipeTheme } = useRecipeTheme();
  const isTodaySelected = selectedDate === formatDateKey(new Date());
  const recipeId = isTodaySelected ? selectedMeal?.recipeId : undefined;
  const recipe = useRecipeCacheStore((state) =>
    recipeId ? state.getCachedRecipe(recipeId) : undefined
  );

  useEffect(() => {
    if (!recipeId || recipe) return;

    // The cache stores the recipe when it arrives, which recolors through the selector above.
    // A failed read keeps the default palette; selecting the meal again retries.
    useRecipeCacheStore
      .getState()
      .loadRecipe(recipeId)
      .catch(() => undefined);
  }, [recipe, recipeId]);

  // Before paint, so a cached palette shows without a flash of the default one.
  useLayoutEffect(() => {
    setRecipeTheme(recipe?.theme ?? null);
  }, [recipe, setRecipeTheme]);

  return { theme, imageUrl: recipe?.imageUrl ?? null };
}
