import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatDateKey } from '@/features/home/utils/calendarDate';
import { favoriteSummaryFromRecipe } from '@/features/favorites/domain/favoriteFormat';
import { selectIsFavorite, useFavoritesStore } from '@/features/favorites/store';
import { useMarkAsCooked } from '@/features/cooking';
import { useInventoryStore } from '@/features/inventory';
import { useMealPlanStore } from '@/store';
import { canMarkAsCooked, isRecipeChatEnabled, resolveRecipeEntry } from '../domain/recipeEntry';
import { resolveRecipeIngredients } from '../domain/recipeIngredients';
import { useRecipe } from './useRecipe';

type RecipeRouteParams = {
  id: string;
  /** The planned meal the screen was opened for; the same recipe is planned on several days. */
  entryId?: string;
  /** The version the meal names, when the caller knows it: a cached one is not asked for again. */
  recipeVersionId?: string;
};

/** A route param repeated in the URL arrives as an array; the first value is the one meant. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Owns the store access and the handlers of the recipe screen; the components only draw.
 *
 * The screen does not read or change the Shopping list: that list is the server's, and
 * sending an ingredient to it from here waits for the server to take items added by hand. So
 * no row reads as already listed, and none offers to be added.
 */
export function useRecipeScreen() {
  const params = useLocalSearchParams<RecipeRouteParams>();
  const recipeId = firstParam(params.id) ?? '';
  const entryId = firstParam(params.entryId);
  const router = useRouter();

  const { recipe, status, retry } = useRecipe(recipeId, firstParam(params.recipeVersionId));
  const entries = useMealPlanStore((state) => state.entries);
  const isFavorite = useFavoritesStore(selectIsFavorite(recipeId));
  const toggleFavorite = useFavoritesStore((state) => state.toggle);
  const cooking = useMarkAsCooked();
  const inventory = useInventoryStore((state) => state.items);
  const catalog = useInventoryStore((state) => state.ingredients);
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
    () => resolveRecipeIngredients({ lines: ingredientLines ?? [], catalog, inventory }),
    [catalog, ingredientLines, inventory]
  );

  const handleBack = useCallback(() => router.back(), [router]);

  // The star starts right: the favorites are the server's. A failed read keeps what the device
  // had, and the next toggle settles the recipe on its own.
  useEffect(() => {
    useFavoritesStore
      .getState()
      .load()
      .catch(() => {});
  }, []);

  // The store flips the star at once and takes it back if the server refuses.
  const handleToggleFavorite = useCallback(() => {
    if (!recipe) return;

    void toggleFavorite(favoriteSummaryFromRecipe(recipe));
  }, [recipe, toggleFavorite]);

  // Marking a meal as cooked consumes its ingredients on the server, so the check only asks; the
  // sheet decides.
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

  const handleConfirmCooked = useCallback(async () => {
    if (!isAwaitingCookedAnswerRef.current) return;

    isAwaitingCookedAnswerRef.current = false;
    setIsCookedConfirmVisible(false);
    if (!entry || !canMarkAsCooked(entry)) return;

    // The summary is shown over the recipe; the screen closes when the user dismisses it.
    await cooking.markAsCooked(entry.id);
  }, [cooking, entry]);

  const { dismiss: dismissCookingResult, summary: cookingSummary } = cooking;
  const handleCloseCookingResult = useCallback(() => {
    dismissCookingResult();
    if (cookingSummary) router.back();
  }, [cookingSummary, dismissCookingResult, router]);

  return {
    recipe,
    status,
    rows,
    isFavorite,
    canMarkAsCooked: canMarkAsCooked(entry),
    isChatEnabled: isRecipeChatEnabled(entry, todayKey),
    // The planned meal is the server's Scheduled meal: its id opens the Cooking chat.
    chatScheduledMealId: entry?.id ?? null,
    isMealCooked: entry?.isCooked ?? false,
    isCookedConfirmVisible,
    cookingSummary,
    cookingErrorMessage: cooking.errorMessage,
    handleBack,
    handleRetry: retry,
    handleToggleFavorite,
    handleRequestMarkAsCooked,
    handleConfirmCooked,
    handleCancelCooked,
    handleCloseCookingResult,
  };
}
