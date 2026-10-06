import type {
  Ingredient,
  InventoryItem,
  MasterRecipe,
  MealPlanEntry,
  UnitType,
} from '@/types/domain';

export type ShoppingItemSource = 'planned_meal' | 'manual';

export type ShoppingItemStatus = 'needed' | 'purchased' | 'removed';

interface ShoppingListItemBase {
  id: string; // Stable across derivations
  name: string;
  status: ShoppingItemStatus;
}

// Derived from the plan: one item per ingredient, carrying the amount still missing.
export interface PlannedShoppingListItem extends ShoppingListItemBase {
  source: 'planned_meal';
  ingredientId: string;
  amountToBuy: number;
  unit: UnitType;
  category: Ingredient['category'];
}

// Added by hand: a name only, with no ingredient, quantity, unit or category.
export interface ManualShoppingListItem extends ShoppingListItemBase {
  source: 'manual';
  // Only on a removed item: the status it had, which restoring gives back. Optional, so an
  // item stored as removed before this was recorded is still valid; it restores as needed.
  statusBeforeRemoval?: Exclude<ShoppingItemStatus, 'removed'>;
}

export type ShoppingListItem = PlannedShoppingListItem | ManualShoppingListItem;

// Planned item id -> amount bought. The store adds that same amount to the inventory.
export type PurchaseRecords = Record<string, number>;

export type ShoppingListInput = {
  entries: MealPlanEntry[];
  recipes: Pick<MasterRecipe, 'id' | 'ingredients'>[];
  ingredients: Ingredient[];
  inventory: InventoryItem[];
  purchases: PurchaseRecords;
  removedIds: string[];
  manualItems: ManualShoppingListItem[];
  // Inclusive 'YYYY-MM-DD' key. Without it the whole plan counts.
  untilDate?: string;
};

export type SupermarketOffer = {
  ingredientId: string;
  supermarket: string;
  unitPrice: number;
};

export type BestOffer = {
  supermarket: string;
  unitPrice: number;
  // unitPrice * amountToBuy of the item it was resolved for.
  price: number;
};

export type ShoppingGroupingMode = 'category' | 'supermarket';

export type ShoppingGroup = {
  key: string;
  title: string;
  items: PlannedShoppingListItem[];
};

export type ShoppingCounters = {
  total: number;
  purchased: number;
  removed: number;
};
