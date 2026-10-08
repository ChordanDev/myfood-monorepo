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

// The transport does not check the shape of a 2xx answer, and a recipe is cached for good under
// its version id. This is a guard against an answer the screen could not draw, not a schema: it
// is treated like any other unintelligible server answer.
function parseRecipeResponse(response: unknown): Recipe {
  const recipe = (response as { data?: Partial<Recipe> | null } | null)?.data;
  const isRecipe =
    isNonEmptyString(recipe?.id) &&
    isNonEmptyString(recipe?.recipeVersionId) &&
    Array.isArray(recipe?.ingredients) &&
    Array.isArray(recipe?.steps);

  if (!isRecipe) throw new ApiError('unknown_error', 'Malformed recipe response');
  return recipe as Recipe;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
