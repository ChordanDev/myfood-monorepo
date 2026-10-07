import type { Ingredient } from '@/types/domain';
import type { ManualShoppingListItem, ShoppingListItem } from '../types';
import { getPlannedItemId } from './shoppingList';

/**
 * Where an ingredient stands on the list: `listed` when a row is there to buy it, `removed`
 * when the plan lists it but the user took that row off, `absent` when nothing stands for it.
 */
export type IngredientListState = 'listed' | 'removed' | 'absent';

// What the list needs to know about an ingredient to find its rows.
export type ListedIngredient = Pick<Ingredient, 'id' | 'name'>;

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function isListed(item: ShoppingListItem) {
  return item.status !== 'removed';
}

// A manual item is a name only, so the name is all that ties it to an ingredient: the items
// with that name, in any status, compared trimmed and without case.
export function getManualItemsNamed(
  items: ShoppingListItem[],
  name: string
): ManualShoppingListItem[] {
  const wantedName = normalizeName(name);

  return items.filter(
    (item): item is ManualShoppingListItem =>
      item.source === 'manual' && normalizeName(item.name) === wantedName
  );
}

/**
 * Reads the state of an ingredient from the derived list. A listed row wins, planned or
 * manual: the ingredient is `removed` only while no other row lists it.
 */
export function getIngredientListState(
  items: ShoppingListItem[],
  ingredient: ListedIngredient
): IngredientListState {
  const plannedItemId = getPlannedItemId(ingredient.id);
  const plannedItem = items.find((item) => item.id === plannedItemId);

  if (plannedItem && isListed(plannedItem)) return 'listed';
  if (getManualItemsNamed(items, ingredient.name).some(isListed)) return 'listed';

  return plannedItem ? 'removed' : 'absent';
}
