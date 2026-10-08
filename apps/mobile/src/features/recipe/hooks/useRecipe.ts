import { useCallback, useEffect, useMemo, useState } from 'react';
import { isApiError } from '@/api/errors';
import { useInventoryStore } from '@/features/inventory';
import { useMealPlanStore } from '@/store';
import { recipeFromMasterRecipe } from '../domain/recipeFromMasterRecipe';
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

/**
 * Resolves the recipe of the route. A recipe of the local plan is converted to the shape the API
 * serves and never asks the network (ticket R7, #38, removes that branch); any other id is read
 * from the version cache, which fetches it once.
 */
export function useRecipe(recipeId: string, recipeVersionId?: string) {
  const localRecipe = useMealPlanStore((state) => state.getRecipeById(recipeId));
  const catalog = useInventoryStore((state) => state.ingredients);
  // The first paint of a recipe that was opened before, without waiting for the effect.
  const cachedRecipe = useRecipeCacheStore((state) =>
    state.getCachedRecipe(recipeId, { recipeVersionId })
  );
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Memoized: the rows and the palette of the screen follow the identity of the recipe.
  const convertedRecipe = useMemo(
    () => (localRecipe ? recipeFromMasterRecipe(localRecipe, catalog) : undefined),
    [catalog, localRecipe]
  );
  const isRemote = localRecipe === undefined && recipeId !== '';

  useEffect(() => {
    if (!isRemote) return;

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
  }, [attempt, isRemote, recipeId, recipeVersionId]);

  const retry = useCallback(() => {
    setOutcome(null);
    setAttempt((current) => current + 1);
  }, []);

  const currentOutcome = outcome?.recipeId === recipeId ? outcome : null;
  const recipe = convertedRecipe ?? cachedRecipe ?? currentOutcome?.recipe;
  // An empty id names no recipe, here or on the server.
  const pendingStatus: RecipeStatus = isRemote
    ? (currentOutcome?.failure ?? 'loading')
    : 'not_found';
  const status: RecipeStatus = recipe ? 'ready' : pendingStatus;

  return { recipe, status, retry };
}
