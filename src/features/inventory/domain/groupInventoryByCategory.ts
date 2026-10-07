import { INGREDIENT_CATEGORIES } from '@/types/domain';
import type { IngredientCategory } from '@/types/domain';
import type { InventoryItem } from '../types';

export interface InventoryGroup {
  category: IngredientCategory;
  items: InventoryItem[];
}

export function groupInventoryByCategory(items: InventoryItem[]): InventoryGroup[] {
  // Items at zero are kept in the store as history but are not part of the visible list
  const availableItems = items.filter((item) => item.quantity > 0);

  return INGREDIENT_CATEGORIES.map((category) => ({
    category,
    items: availableItems
      .filter((item) => item.category === category)
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  })).filter((group) => group.items.length > 0);
}
