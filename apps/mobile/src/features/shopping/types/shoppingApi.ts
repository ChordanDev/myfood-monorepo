import type { UnitType } from '@/types/domain';

// What `GET /api/shopping-list` serves, as `apps/api/frontend_integration_guide.md` section 7.1
// describes it. Dates are 'YYYY-MM-DD' keys and quantities are thousandths of the unit.

// One line per ingredient and unit, adding up its meals, or one line per meal.
export type ShoppingGroupBy = 'ingredient' | 'meal';

// `in_cart` is a line marked and not bought yet, `purchased` one bought for a meal that is not
// cooked yet. The status of a line is decided by its allocations that are still to buy, the
// ones neither removed nor purchased: an ingredient line reads `in_cart` only when every one of
// them is in a Cart. With nothing left to buy it reads `purchased` when any allocation was
// bought, and `removed` only when all of them were removed.
export type ShoppingLineStatus = 'needed' | 'in_cart' | 'removed' | 'purchased';

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
  // The status of that Shopping item. Only a `needed` one can go into a Cart.
  status: ShoppingLineStatus;
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
  // What is still to buy. On a `purchased` line, what was bought.
  quantityMilli: number;
  unit: UnitType;
  status: ShoppingLineStatus;
  source: ShoppingLineSource;
  // The supermarket every allocation is assigned to, when they agree on one.
  supermarketId: string | null;
  // Exactly one when grouped by meal.
  allocations: ShoppingLineAllocation[];
}

// The lease of a Cart: what marking and renewing answer.
export interface CartLease {
  sessionId: string;
  // ISO 8601 datetime.
  leaseExpiresAt: string;
}

// A line of the Cart, as a confirm names it: every planned item of one ingredient and unit the
// Cart holds, added up, or one item added by hand.
export interface ShoppingCartLine {
  // What a confirm calls the line: `<ingredientId>:<unit>`, or the id of a manual item.
  id: string;
  name: string;
  unit: UnitType;
  // What the Cart holds of it: the quantity a confirm buys unless another one is sent.
  quantityMilli: number;
}

// The caller's own active Cart, as a read of the list reports it.
export interface ShoppingCart extends CartLease {
  // What a confirm buys, `[]` for a Cart that holds nothing. Neither the date limit nor the
  // grouping of the read changes them: a line can hold more than the read lists of it, or be
  // of an ingredient the read does not list. The shares in the Cart of another member are in
  // none of them.
  lines: ShoppingCartLine[];
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

// A Shopping item a Cart reserved, as marking it answers.
export interface CartReservation {
  itemId: string;
  reservationToken: string;
  quantityMilli: number;
}

// What `POST /api/shopping-items/mark-cart` answers: the Cart lease and the items it holds.
export interface MarkedCart extends CartLease {
  items: CartReservation[];
}

// What `DELETE /api/cart/:sessionId` answers.
export interface CancelledCart {
  sessionId: string;
  updatedRows: number;
  status: 'abandoned';
}

// What was actually bought of a line of the Cart (section 7.4).
export interface CheckoutLine {
  // `<ingredientId>:<unit>` for the planned items of an ingredient, the Shopping item id for a
  // manual item. Never the `itemId` of an allocation.
  itemId: string;
  // `0` puts the line back on the list and buys nothing.
  quantityMilli: number;
  totalCents?: number;
}

// What `POST /api/checkout/confirm` takes. A line of the Cart that is not listed is bought at
// the quantity the Cart holds.
export interface CheckoutConfirmation {
  sessionId: string;
  checkoutType: 'physical' | 'online';
  lines?: CheckoutLine[];
}

// What `POST /api/checkout/confirm` answers. Confirming the same session again answers the
// same result.
export interface CheckoutResult {
  checkoutSessionId: string;
  // `pending_delivery` is an online purchase that has not arrived yet.
  status: 'completed' | 'pending_delivery';
  checkoutType: 'physical' | 'online';
  movedToInventoryCount: number;
  checkedOutItemsCount: number;
  actualTotalCents: number;
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
