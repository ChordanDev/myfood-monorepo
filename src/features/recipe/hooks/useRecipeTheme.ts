import { useMemo } from 'react';
import { MasterRecipe } from '@/types/domain';
import { RECIPE_THEMES, RecipeTheme } from '../types/themes';

export function useRecipeTheme(recipe?: MasterRecipe): RecipeTheme {
  return useMemo(() => {
    if (recipe?.theme) {
      const { theme } = recipe;
      return {
        primary: theme.calendarBg,
        secondary: theme.primaryAccent,
        accent: theme.primaryAccent,
        background: [theme.appBgGradient[0], theme.appBgGradient[1]],
        text: theme.textMain,
      };
    }

    if (!recipe) return RECIPE_THEMES.green;

    const tags = recipe.tags.map((t) => t.toLowerCase());

    if (tags.includes('vegetariana') || tags.includes('saludable')) {
      return RECIPE_THEMES.green;
    }

    if (tags.includes('económica') || tags.includes('rápida')) {
      return RECIPE_THEMES.warm;
    }

    return RECIPE_THEMES.light;
  }, [recipe]);
}
