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
  ingredientId: string;
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
  // Always empty for now: the server does not serve the lines added by hand yet.
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

// What a Shopping item reserved by a Cart is paid with: checkout needs the token.
export interface CartReservation {
  itemId: string;
  reservationToken: string;
  quantityMilli: number;
}

// What `POST /api/shopping-items/mark-cart` answers: the Cart lease and the items it holds.
export interface MarkedCart extends ShoppingCart {
  items: CartReservation[];
}

// What `DELETE /api/cart/:sessionId` answers.
export interface CancelledCart {
  sessionId: string;
  updatedRows: number;
  status: 'abandoned';
}
