import { useCallback, useEffect, useState } from 'react';
import { isApiError } from '@/api/errors';
import { useRecipeCacheStore } from '../store';
import type { Recipe } from '../types/recipe';

export type RecipeStatus = 'loading' | 'ready' | 'not_found' | 'forbidden' | 'failed';

type LoadFailure = Extract<RecipeStatus, 'not_found' | 'forbidden' | 'failed'>;

/** How the last load of a recipe ended. Kept with its id: the screen may move to another one. */
type LoadOutcome = {
  recipeId: string;
  recipe?: Recipe;
  failure?: LoadFailure;
};

/**
 * The server answers on purpose when the recipe does not exist or the Account has no access to
 * it, and asking again gets the same answer. Anything else may be fixed by trying again.
 */
function toLoadFailure(error: unknown): LoadFailure {
  if (!isApiError(error)) return 'failed';
  if (error.code === 'recipe_not_found') return 'not_found';
  if (error.code === 'forbidden') return 'forbidden';

  return 'failed';
}

/** Resolves the recipe of the route from the version cache, which fetches it once. */
export function useRecipe(recipeId: string, recipeVersionId?: string) {
  // The first paint of a recipe that was opened before, without waiting for the effect.
  const cachedRecipe = useRecipeCacheStore((state) =>
    state.getCachedRecipe(recipeId, { recipeVersionId })
  );
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null);
  const [attempt, setAttempt] = useState(0);

  // An empty id names no recipe, here or on the server.
  const hasRecipeId = recipeId !== '';

  useEffect(() => {
    if (!hasRecipeId) return;

    // An answer that arrives after the screen left this recipe, or unmounted, is dropped.
    let isCurrent = true;

    useRecipeCacheStore
      .getState()
      .loadRecipe(recipeId, { recipeVersionId })
      .then(
        (recipe) => {
          if (isCurrent) setOutcome({ recipeId, recipe });
        },
        (error: unknown) => {
          if (isCurrent) setOutcome({ recipeId, failure: toLoadFailure(error) });
        }
      );

    return () => {
      isCurrent = false;
    };
  }, [attempt, hasRecipeId, recipeId, recipeVersionId]);

  const retry = useCallback(() => {
    setOutcome(null);
    setAttempt((current) => current + 1);
  }, []);

  const currentOutcome = outcome?.recipeId === recipeId ? outcome : null;
  const recipe = cachedRecipe ?? currentOutcome?.recipe;
  const pendingStatus: RecipeStatus = hasRecipeId
    ? (currentOutcome?.failure ?? 'loading')
    : 'not_found';
  const status: RecipeStatus = recipe ? 'ready' : pendingStatus;

  return { recipe, status, retry };
}
