import { useMemo } from 'react';
import { useInventoryStore } from '@/features/inventory/store';
import { useMealPlanStore } from '@/store';
import { deriveFullShoppingList } from '../domain';
import { useShoppingListStore } from '../store';
import type { ShoppingListItem } from '../types';

/**
 * The derived list, for a render: the planned rows followed by the manual ones, removed rows
 * included. It is derived again only when one of the stores it is built from changes.
 */
export function useShoppingListItems(): ShoppingListItem[] {
  const entries = useMealPlanStore((state) => state.entries);
  const recipes = useMealPlanStore((state) => state.recipes);
  const inventory = useInventoryStore((state) => state.items);
  const ingredients = useInventoryStore((state) => state.ingredients);
  const cartIds = useShoppingListStore((state) => state.cartIds);
  const removedIds = useShoppingListStore((state) => state.removedIds);
  const manualItems = useShoppingListStore((state) => state.manualItems);

  return useMemo(
    () =>
      deriveFullShoppingList({
        entries,
        recipes,
        ingredients,
        inventory,
        cartIds,
        removedIds,
        manualItems,
      }),
    [entries, recipes, ingredients, inventory, cartIds, removedIds, manualItems]
  );
}
