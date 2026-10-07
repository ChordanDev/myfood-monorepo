import type { CalendarProps } from '@/features/home';
import type { InventoryItem } from '@/features/inventory';
import type {
  Ingredient,
  IngredientCategory,
  MasterRecipe,
  MealPlanEntry,
  UnitType,
} from '@/types/domain';

export type ShoppingItemSource = 'planned_meal' | 'manual';

// `in_cart` is a row the user marked and has not confirmed yet. A confirmed row has no status:
// it leaves the list.
export type ShoppingItemStatus = 'needed' | 'in_cart' | 'removed';

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
  category: IngredientCategory;
}

// Added by hand: a name only, with no ingredient, quantity, unit or category.
export interface ManualShoppingListItem extends ShoppingListItemBase {
  source: 'manual';
}

export type ShoppingListItem = PlannedShoppingListItem | ManualShoppingListItem;

export type ShoppingListInput = {
  entries: MealPlanEntry[];
  recipes: Pick<MasterRecipe, 'id' | 'ingredients'>[];
  ingredients: Ingredient[];
  // Only the items linked to an ingredient count as stock, for their quantity.
  inventory: Pick<InventoryItem, 'ingredientId' | 'quantity'>[];
  // Ids of the planned items in the cart. A manual item carries that in its own status.
  cartIds: string[];
  removedIds: string[];
  manualItems: ManualShoppingListItem[];
  // Inclusive 'YYYY-MM-DD' key. Without it the whole plan counts.
  untilDate?: string;
};

// What the stores hold: the list is derived from them up to the day the user chose, or up to
// the last planned date.
export type ShoppingListSources = Omit<ShoppingListInput, 'untilDate'> & {
  // 'YYYY-MM-DD' key of the chosen day, when there is one. It counts while it can be chosen.
  chosenUntilDate: string | undefined;
};

// What the calendar of the date pill needs to offer the days the list can reach.
export type ShoppingUntilCalendar = Required<
  Pick<CalendarProps, 'planByDate' | 'isDateSelectable' | 'monthBounds'>
> & {
  // First day the list buys for. The calendar draws the stretch from it to the day the list
  // reaches; it is fixed, not something the user picks.
  rangeStart: string;
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

// `total` and `inCart` count the listed rows; the removed ones are counted apart.
export type ShoppingCounters = {
  total: number;
  inCart: number;
  removed: number;
};
