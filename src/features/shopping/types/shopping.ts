import type {
  Ingredient,
  InventoryItem,
  ManualShoppingListItem,
  MasterRecipe,
  MealPlanEntry,
  PlannedShoppingListItem,
} from '@/types/domain';

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
