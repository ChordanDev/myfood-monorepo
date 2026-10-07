import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatDateKey } from '@/features/home/utils/calendarDate';
import { useInventoryStore } from '@/features/inventory';
import { useMealPlanStore } from '@/store';
import type { RecipeChatOffer } from '../domain/recipeChat';
import { canMarkAsCooked, isRecipeChatEnabled, resolveRecipeEntry } from '../domain/recipeEntry';
import { resolveRecipeIngredients, type RecipeIngredientRow } from '../domain/recipeIngredients';
import {
  selectRequestedIngredientIds,
  useShoppingRequestsStore,
} from '../store/useShoppingRequestsStore';

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
  const [isCookedConfirmVisible, setIsCookedConfirmVisible] = useState(false);
  // The answer is taken once: a second tap on "Sí" lands before the sheet has closed.
  const isAwaitingCookedAnswerRef = useRef(false);

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

  // Marking a meal as cooked consumes its ingredients, so the check only asks; the sheet decides.
  const handleRequestMarkAsCooked = useCallback(() => {
    if (!canMarkAsCooked(entry)) return;

    // The chat keyboard would otherwise stay up under the sheet.
    Keyboard.dismiss();
    isAwaitingCookedAnswerRef.current = true;
    setIsCookedConfirmVisible(true);
  }, [entry]);

  const handleCancelCooked = useCallback(() => {
    isAwaitingCookedAnswerRef.current = false;
    setIsCookedConfirmVisible(false);
  }, []);

  const handleConfirmCooked = useCallback(() => {
    if (!isAwaitingCookedAnswerRef.current) return;

    isAwaitingCookedAnswerRef.current = false;
    setIsCookedConfirmVisible(false);
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
    isCookedConfirmVisible,
    handleBack,
    handleToggleFavorite,
    handleRequestMarkAsCooked,
    handleConfirmCooked,
    handleCancelCooked,
    handleRequestIngredient,
    handleAddOffer,
  };
}
