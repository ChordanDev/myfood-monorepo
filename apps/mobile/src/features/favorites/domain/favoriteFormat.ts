import type { FavoriteSummary } from '../types/favorites';

/** "40 min", "1 h" or "1 h 30 min"; nothing when the recipe states no duration. */
export function formatFavoriteDuration(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Ingredients of a row, comma separated; nothing when the recipe lists none. */
export function formatFavoriteIngredients(mainIngredients: string[]): string | null {
  return mainIngredients.length > 0 ? mainIngredients.join(', ') : null;
}

const OPTIMISTIC_INGREDIENT_COUNT = 3;

interface RecipeForFavorite {
  id: string;
  name: string;
  durationMinutes: number | null;
  ingredients: { name: string }[];
}

/**
 * The row a recipe shows until the server answers with its own. The server picks the main
 * ingredients by its own rule; this takes the first few listed, which is close enough to be
 * drawn for the moment the request is in flight.
 */
export function favoriteSummaryFromRecipe(recipe: RecipeForFavorite): FavoriteSummary {
  return {
    recipeId: recipe.id,
    name: recipe.name,
    mainIngredients: recipe.ingredients.slice(0, OPTIMISTIC_INGREDIENT_COUNT).map((i) => i.name),
    durationMinutes: recipe.durationMinutes,
  };
}
