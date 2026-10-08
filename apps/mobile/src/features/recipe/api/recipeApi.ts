import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type { Recipe } from '../types/recipe';

export async function getRecipe(id: string, options?: RequestOptions): Promise<Recipe> {
  const response = await apiClient.get<unknown>(`/api/recipes/${encodeURIComponent(id)}`, {
    ...options,
    auth: true,
    retry: options?.retry ?? true,
  });
  return parseRecipeResponse(response);
}

// The transport does not check the shape of a 2xx answer. The recipe is cached by its version
// id, so an answer without one is treated like any other unintelligible server answer.
function parseRecipeResponse(response: unknown): Recipe {
  const recipe = (response as { data?: Partial<Recipe> | null } | null)?.data;
  if (typeof recipe?.recipeVersionId !== 'string' || recipe.recipeVersionId.length === 0) {
    throw new ApiError('unknown_error', 'Malformed recipe response');
  }
  return recipe as Recipe;
}
