import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatDateKey } from '@/features/home/utils/calendarDate';
import { useInventoryStore } from '@/features/inventory';
import {
  addIngredientToShoppingList,
  getIngredientListState,
  useShoppingListItems,
  type ShoppingListItem,
} from '@/features/shopping';
import { useMealPlanStore } from '@/store';
import type { Ingredient, RecipeIngredient } from '@/types/domain';
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

/**
 * Ids of the recipe ingredients the shopping list already has a row for. An id outside the
 * catalog has no name to look for among the items added by hand, so it is never listed.
 */
function getListedIngredientIds(
  lines: RecipeIngredient[],
  catalog: Ingredient[],
  shoppingItems: ShoppingListItem[]
): string[] {
  return lines.flatMap(({ ingredientId }) => {
    const ingredient = catalog.find((candidate) => candidate.id === ingredientId);
    const isListed =
      ingredient !== undefined && getIngredientListState(shoppingItems, ingredient) === 'listed';

    return isListed ? [ingredientId] : [];
  });
}

/**
 * "agregar" means the same on an ingredient row and from the chat: the shopping list gets the
 * ingredient under its catalog name, which is the name its planned row would carry.
 */
function addToShoppingList(ingredientId: string | undefined) {
  const { ingredients } = useInventoryStore.getState();
  const ingredient = ingredients.find((candidate) => candidate.id === ingredientId);
  // An id outside the catalog has no trustworthy name to put on the list.
  if (!ingredient) return;

  addIngredientToShoppingList(ingredient);
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
  const shoppingItems = useShoppingListItems();
  const [isCookedConfirmVisible, setIsCookedConfirmVisible] = useState(false);
  // The answer is taken once: a second tap on "Sí" lands before the sheet has closed.
  const isAwaitingCookedAnswerRef = useRef(false);

  const todayKey = formatDateKey(new Date());
  const entry = useMemo(
    () => resolveRecipeEntry({ entries, recipeId, entryId, todayKey }),
    [entries, entryId, recipeId, todayKey]
  );
  const ingredientLines = recipe?.ingredients;
  const rows = useMemo(() => {
    const lines = ingredientLines ?? [];

    return resolveRecipeIngredients({
      lines,
      catalog,
      inventory,
      listedIngredientIds: getListedIngredientIds(lines, catalog, shoppingItems),
    });
  }, [catalog, ingredientLines, inventory, shoppingItems]);

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
    addToShoppingList(row.ingredientId);
  }, []);

  const handleAddOffer = useCallback((offer: RecipeChatOffer) => {
    addToShoppingList(offer.ingredientId);
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
