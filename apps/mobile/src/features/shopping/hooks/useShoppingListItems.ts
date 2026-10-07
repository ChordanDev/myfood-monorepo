import { useMemo } from 'react';
import { useInventoryStore } from '@/features/inventory/store';
import { useMealPlanStore } from '@/store';
import { deriveCurrentShoppingList } from '../domain';
import { getTodayKey, useShoppingListStore } from '../store';
import type { ShoppingListItem } from '../types';

/**
 * The derived list, for a render: the planned rows followed by the manual ones, removed rows
 * included. It reaches the day the user chose, like the list an action reads. It is derived
 * again only when one of the stores it is built from changes, or the day does.
 */
export function useShoppingListItems(): ShoppingListItem[] {
  const entries = useMealPlanStore((state) => state.entries);
  const recipes = useMealPlanStore((state) => state.recipes);
  const inventory = useInventoryStore((state) => state.items);
  const ingredients = useInventoryStore((state) => state.ingredients);
  const cartIds = useShoppingListStore((state) => state.cartIds);
  const removedIds = useShoppingListStore((state) => state.removedIds);
  const manualItems = useShoppingListStore((state) => state.manualItems);
  const chosenUntilDate = useShoppingListStore((state) => state.chosenUntilDate);
  const todayKey = getTodayKey();

  return useMemo(
    () =>
      deriveCurrentShoppingList(
        {
          entries,
          recipes,
          ingredients,
          inventory,
          cartIds,
          removedIds,
          manualItems,
          chosenUntilDate,
        },
        todayKey
      ),
    [
      entries,
      recipes,
      ingredients,
      inventory,
      cartIds,
      removedIds,
      manualItems,
      chosenUntilDate,
      todayKey,
    ]
  );
}
