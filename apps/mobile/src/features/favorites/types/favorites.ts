// One favorite as the API lists it: enough to draw a row without fetching the recipe.
export interface FavoriteSummary {
  recipeId: string;
  name: string;
  mainIngredients: string[];
  durationMinutes: number | null;
}
