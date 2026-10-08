import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { getRecipe } from '../api/recipeApi';
import type { Recipe } from '../types/recipe';

// A caller that already knows which version it wants, such as a meal that names it.
interface KnownRecipeVersion {
  recipeVersionId?: string;
}

interface RecipeCacheState {
  recipesByVersionId: Record<string, Recipe>;
  // A recipe has exactly one version, which never changes, so an entry is written once.
  versionIdByRecipeId: Record<string, string>;
  getCachedRecipe: (recipeId: string, known?: KnownRecipeVersion) => Recipe | undefined;
  loadRecipe: (recipeId: string, known?: KnownRecipeVersion) => Promise<Recipe>;
  clear: () => void;
}

type PersistedRecipeCacheState = Pick<
  RecipeCacheState,
  'recipesByVersionId' | 'versionIdByRecipeId'
>;

const EMPTY_CACHE: PersistedRecipeCacheState = { recipesByVersionId: {}, versionIdByRecipeId: {} };

// Requests under way, by recipe id. Kept out of the store so they are never persisted.
const inFlightLoads = new Map<string, Promise<Recipe>>();

export const useRecipeCacheStore = create<RecipeCacheState>()(
  persist(
    (set, get) => ({
      ...EMPTY_CACHE,
      getCachedRecipe: (recipeId, known) => {
        const { recipesByVersionId, versionIdByRecipeId } = get();
        const versionId = versionIdByRecipeId[recipeId] ?? known?.recipeVersionId;

        return versionId === undefined ? undefined : recipesByVersionId[versionId];
      },
      loadRecipe: (recipeId, known) => {
        const cached = get().getCachedRecipe(recipeId, known);
        if (cached) return Promise.resolve(cached);

        const inFlight = inFlightLoads.get(recipeId);
        if (inFlight) return inFlight;

        // A failed load stores nothing and leaves no entry behind, so the next call retries.
        const load = getRecipe(recipeId)
          .then((recipe) => {
            set((state) => ({
              recipesByVersionId: {
                ...state.recipesByVersionId,
                [recipe.recipeVersionId]: recipe,
              },
              versionIdByRecipeId: {
                ...state.versionIdByRecipeId,
                [recipeId]: recipe.recipeVersionId,
              },
            }));
            return recipe;
          })
          .finally(() => {
            inFlightLoads.delete(recipeId);
          });

        inFlightLoads.set(recipeId, load);
        return load;
      },
      clear: () => {
        set(EMPTY_CACHE);
      },
    }),
    {
      name: 'recipe-cache-storage',
      storage: createJSONStorage(() => safeAsyncStorage),
      partialize: ({ recipesByVersionId, versionIdByRecipeId }) => ({
        recipesByVersionId,
        versionIdByRecipeId,
      }),
    }
  )
);
