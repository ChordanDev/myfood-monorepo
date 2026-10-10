import type { UnitType } from '@/types/domain';

// What `GET /api/shopping-list` serves, as `apps/api/frontend_integration_guide.md` section 7.1
// describes it. Dates are 'YYYY-MM-DD' keys and quantities are thousandths of the unit.

// One line per ingredient and unit, adding up its meals, or one line per meal.
export type ShoppingGroupBy = 'ingredient' | 'meal';

// `in_cart` is a line marked and not bought yet. An ingredient line reads `in_cart` only when
// every one of its allocations is in a Cart.
export type ShoppingLineStatus = 'needed' | 'in_cart' | 'removed';

export type ShoppingLineSource = 'planned_meal' | 'manual';

export type ShoppingMealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';

// The share of a line one Scheduled meal needs.
export interface ShoppingLineAllocation {
  // The Shopping item behind the share: what a Cart marks.
  itemId: string;
  scheduledMealId: string;
  date: string;
  slot: ShoppingMealSlot;
  quantityMilli: number;
}

export interface ShoppingListLine {
  // `<ingredientId>:<unit>` when grouped by ingredient, the Shopping item id when grouped by meal.
  id: string;
  // `null` on a manual line added without an Ingredient.
  ingredientId: string | null;
  name: string;
  // One of the server's Ingredient categories. That list is the server's to grow, so a value
  // this app has no title for is expected.
  category: string;
  quantityMilli: number;
  unit: UnitType;
  status: ShoppingLineStatus;
  source: ShoppingLineSource;
  // The supermarket every allocation is assigned to, when they agree on one.
  supermarketId: string | null;
  // Exactly one when grouped by meal.
  allocations: ShoppingLineAllocation[];
}

// The caller's own active Cart.
export interface ShoppingCart {
  sessionId: string;
  // ISO 8601 datetime.
  leaseExpiresAt: string;
}

// `needed`, `inCart` and `removed` count the planned lines of the read by status.
export interface ShoppingListTotals {
  needed: number;
  inCart: number;
  removed: number;
  estimatedCents: number;
}

export interface ShoppingListRead {
  planned: ShoppingListLine[];
  // The lines the User added by hand that are still on the list, oldest first. Never merged
  // with each other or with a planned line.
  manual: ShoppingListLine[];
  cart: ShoppingCart | null;
  totals: ShoppingListTotals;
  // Every date from the Account's today on with an uncooked Scheduled meal, sorted. The date
  // limit of the read does not change it.
  plannedDates: string[];
}

export interface ShoppingListQuery {
  // Last date the list buys for, itself included. Without it the list covers every upcoming
  // meal. It is never before the Account's today, which only the server knows.
  untilDate?: string;
  // The server groups by ingredient when it is not sent.
  groupBy?: ShoppingGroupBy;
}

// What `POST /api/shopping-items/manual` takes (section 7.6). Only the name is required: the
// server reads 1 unit when the quantity and the unit are left out.
export interface NewManualShoppingItem {
  name: string;
  ingredientId?: string;
  quantityMilli?: number;
  unit?: UnitType;
}

// `removed` is the User not buying a planned item, `needed` is bringing it back.
export type ShoppingItemsStatus = 'removed' | 'needed';

// What `POST /api/shopping-items/set-status` answers (section 7.8).
export interface ShoppingItemsStatusChange {
  status: ShoppingItemsStatus;
  itemIds: string[];
  // The items whose status changed: setting the one an item already has changes nothing.
  updatedRows: number;
}
