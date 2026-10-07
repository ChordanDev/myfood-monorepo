import { useInventoryStore } from '@/features/inventory/store';
import { useMealPlanStore } from '@/store';
import {
  deriveFullShoppingList,
  getIngredientListState,
  getManualItemsNamed,
  getPlannedItemId,
  type ListedIngredient,
} from '../domain';
import type { ShoppingListItem } from '../types';
import { useShoppingListStore } from './useShoppingListStore';

/**
 * The list as the stores hold it right now. Actions run on it instead of on the rendered
 * rows: a row from a stale render may have changed status, amount, or left the list since.
 */
export function readShoppingListItems(): ShoppingListItem[] {
  const { entries, recipes } = useMealPlanStore.getState();
  const { items: inventory, ingredients } = useInventoryStore.getState();
  const { cartIds, removedIds, manualItems } = useShoppingListStore.getState();

  return deriveFullShoppingList({
    entries,
    recipes,
    ingredients,
    inventory,
    cartIds,
    removedIds,
    manualItems,
  });
}

/**
 * Puts an ingredient on the list, for a caller that only knows the ingredient. A row the user
 * removed comes back, planned or manual. Without one, the ingredient is added by hand: a name
 * only, since the plan is what gives a row its amount. An ingredient already listed is left
 * as it is, so calling this twice never lists it twice.
 */
export function addIngredientToShoppingList(ingredient: ListedIngredient): void {
  const items = readShoppingListItems();
  const state = getIngredientListState(items, ingredient);
  if (state === 'listed') return;

  const { restoreItem, addManualItem } = useShoppingListStore.getState();
  if (state === 'removed') {
    restoreItem(getPlannedItemId(ingredient.id));
    return;
  }

  // Not listed, so every manual item with this name is a removed one.
  const [removedManualItem] = getManualItemsNamed(items, ingredient.name);
  if (removedManualItem) restoreItem(removedManualItem.id);
  else addManualItem(ingredient.name);
}
