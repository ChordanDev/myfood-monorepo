import { useCallback, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatDateKey } from '@/features/home/utils/calendarDate';
import { useInventoryStore, useMealPlanStore } from '@/store';
import {
  selectRequestedIngredientIds,
  useShoppingRequestsStore,
} from '@/store/useShoppingRequestsStore';
import type { RecipeChatOffer } from '../domain/recipeChat';
import { canMarkAsCooked, isRecipeChatEnabled, resolveRecipeEntry } from '../domain/recipeEntry';
import { resolveRecipeIngredients, type RecipeIngredientRow } from '../domain/recipeIngredients';

type RecipeRouteParams = {
  id: string;
  /** The planned meal the screen was opened for; the same recipe is planned on several days. */
  entryId?: string;
};

/** A route param repeated in the URL arrives as an array; the first value is the one meant. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Owns the store access and the handlers of the recipe screen; the components only draw. */
export function useRecipeScreen() {
  const params = useLocalSearchParams<RecipeRouteParams>();
  const recipeId = firstParam(params.id) ?? '';
  const entryId = firstParam(params.entryId);
  const router = useRouter();

  const recipe = useMealPlanStore((state) => state.getRecipeById(recipeId));
  const entries = useMealPlanStore((state) => state.entries);
  const favoriteRecipeIds = useMealPlanStore((state) => state.favoriteRecipeIds);
  const toggleFavoriteRecipe = useMealPlanStore((state) => state.toggleFavoriteRecipe);
  const markAsCooked = useMealPlanStore((state) => state.markAsCooked);
  const inventory = useInventoryStore((state) => state.items);
  const catalog = useInventoryStore((state) => state.ingredients);
  const requests = useShoppingRequestsStore((state) => state.requests);

  const todayKey = formatDateKey(new Date());
  const entry = useMemo(
    () => resolveRecipeEntry({ entries, recipeId, entryId, todayKey }),
    [entries, entryId, recipeId, todayKey]
  );
  const ingredientLines = recipe?.ingredients;
  const rows = useMemo(
    () =>
      resolveRecipeIngredients({
        lines: ingredientLines ?? [],
        catalog,
        inventory,
        requestedIngredientIds: selectRequestedIngredientIds({ requests }),
      }),
    [catalog, ingredientLines, inventory, requests]
  );

  const handleBack = useCallback(() => router.back(), [router]);

  const handleToggleFavorite = useCallback(() => {
    toggleFavoriteRecipe(recipeId);
  }, [recipeId, toggleFavoriteRecipe]);

  const handleMarkAsCooked = useCallback(() => {
    if (!entry || !canMarkAsCooked(entry)) return;

    markAsCooked(entry.id);
    router.back();
  }, [entry, markAsCooked, router]);

  const handleRequestIngredient = useCallback((row: RecipeIngredientRow) => {
    useShoppingRequestsStore.getState().requestIngredient({
      name: row.name,
      ingredientId: row.ingredientId,
      // An ingredient outside the catalog counts as missing even when the inventory covers it;
      // with nothing short to ask for, the request is for the whole recipe amount.
      amount: row.missingAmount || row.requiredAmount,
      unit: row.unit ?? undefined,
    });
  }, []);

  const handleAddOffer = useCallback((offer: RecipeChatOffer) => {
    useShoppingRequestsStore.getState().requestIngredient(offer);
  }, []);

  return {
    recipe,
    rows,
    isFavorite: favoriteRecipeIds.includes(recipeId),
    canMarkAsCooked: canMarkAsCooked(entry),
    isChatEnabled: isRecipeChatEnabled(entry, todayKey),
    handleBack,
    handleToggleFavorite,
    handleMarkAsCooked,
    handleRequestIngredient,
    handleAddOffer,
  };
}
