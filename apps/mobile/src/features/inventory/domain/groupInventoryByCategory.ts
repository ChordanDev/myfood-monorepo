import { INGREDIENT_CATEGORIES } from '@/types/domain';
import type { IngredientCategory } from '@/types/domain';
import type { InventoryItem } from '../types';
import { toDisplayCategory } from './inventoryCategory';

export interface InventoryGroup {
  category: IngredientCategory;
  items: InventoryItem[];
}

export function groupInventoryByCategory(items: InventoryItem[]): InventoryGroup[] {
  // A lot at zero is not part of the visible list
  const availableItems = items.filter((item) => item.quantityMilli > 0);

  return INGREDIENT_CATEGORIES.map((category) => ({
    category,
    items: availableItems
      .filter((item) => toDisplayCategory(item.category) === category)
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  })).filter((group) => group.items.length > 0);
}
