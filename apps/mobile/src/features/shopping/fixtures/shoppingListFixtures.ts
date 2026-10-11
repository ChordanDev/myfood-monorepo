import type { UnitType } from '@/types/domain';
import type {
  ShoppingLineAllocation,
  ShoppingLineStatus,
  ShoppingListLine,
  ShoppingItemsStatus,
  ShoppingItemsStatusChange,
  ShoppingListRead,
  ShoppingMealSlot,
} from '../types/shoppingApi';

// Reads of `GET /api/shopping-list` for one plan, as the server answers them: four meals over
// three days, six ingredients, and a Cart holding the rice and the oil of the first meal: two
// Shopping items, which is what its `itemsCount` says in every read.

type Meal = { scheduledMealId: string; date: string; slot: ShoppingMealSlot };

type Ingredient = { ingredientId: string; name: string; category: string; unit: UnitType };

const LUNCH_OCT_8: Meal = {
  scheduledMealId: 'fa64644f-e007-4539-9cd6-2a9d49570540',
  date: '2026-10-08',
  slot: 'lunch',
};
const DINNER_OCT_10: Meal = {
  scheduledMealId: '1fec839a-f789-4e70-92ef-94fb63f1efac',
  date: '2026-10-10',
  slot: 'dinner',
};
const BREAKFAST_OCT_12: Meal = {
  scheduledMealId: '6b1d1c0e-3c56-4d0a-9a43-0f6f4f1c2a10',
  date: '2026-10-12',
  slot: 'breakfast',
};
const LUNCH_OCT_12: Meal = {
  scheduledMealId: '9d2f7a35-8f0b-4c1e-b0d6-5a7e2c9b4f21',
  date: '2026-10-12',
  slot: 'lunch',
};

const RICE: Ingredient = {
  ingredientId: 'dc0c856d-af87-4efb-8e75-1da2b0f57597',
  name: 'Arroz',
  category: 'granos',
  unit: 'g',
};
const CHICKEN: Ingredient = {
  ingredientId: '2a9c1f5e-7b3d-4e68-a1c4-93d0b6e7f812',
  name: 'Pollo',
  category: 'carnes',
  unit: 'g',
};
const TOMATO: Ingredient = {
  ingredientId: '5e8b2d74-1c9a-4f03-8d6e-b47a0c3f9e15',
  name: 'Tomate',
  category: 'verduras',
  unit: 'unit',
};
const OLIVE_OIL: Ingredient = {
  ingredientId: '8f3a6c12-4d7e-4b95-a2f0-c81e5d9b7a34',
  name: 'Aceite de oliva',
  category: 'no_perecederos',
  unit: 'ml',
};
const MILK: Ingredient = {
  ingredientId: 'b7d4e9a1-6f2c-4a58-9e3b-0d5c8f1a2e67',
  name: 'Leche',
  category: 'lacteos',
  unit: 'ml',
};
const BANANA: Ingredient = {
  ingredientId: 'c1e5f8b3-9a4d-4c72-8b1f-6e0a3d7c5f90',
  name: 'Banana',
  category: 'frutas',
  unit: 'unit',
};

function allocation(
  itemId: string,
  meal: Meal,
  quantityMilli: number,
  status: ShoppingLineStatus = 'needed'
): ShoppingLineAllocation {
  return { itemId, ...meal, quantityMilli, status };
}

// The shares of each meal, one per Shopping item. Quantities are thousandths of the unit. The
// rice and the oil of the first meal are the two items the Cart holds.
const RICE_OCT_8 = allocation(
  'ec18bfeb-0d2c-4e11-b772-e6e2fa3d9473',
  LUNCH_OCT_8,
  400_000,
  'in_cart'
);
const CHICKEN_OCT_8 = allocation('0a4f6d28-b1c3-4e59-8a7d-2f9e1c5b3d46', LUNCH_OCT_8, 600_000);
const TOMATO_OCT_8 = allocation('3c7e9b15-d2a4-4f86-b0c1-7a5d8e2f4b69', LUNCH_OCT_8, 2_000);
const OLIVE_OIL_OCT_8 = allocation(
  '4d8fa026-e3b5-4a97-91d2-8b6e9f3a5c7a',
  LUNCH_OCT_8,
  30_000,
  'in_cart'
);
const RICE_OCT_10 = allocation('7eabbc7a-4d46-49a2-a44a-4a06b663d25f', DINNER_OCT_10, 400_000);
const TOMATO_OCT_10 = allocation('5e90b137-f4c6-4ba8-a2e3-9c7fa04b6d8b', DINNER_OCT_10, 3_000);
const MILK_OCT_10 = allocation('6fa1c248-05d7-4cb9-b3f4-ad80b15c7e9c', DINNER_OCT_10, 500_000);
const MILK_OCT_12 = allocation('70b2d359-16e8-4dca-84a5-be91c26d8fad', BREAKFAST_OCT_12, 750_000);
const BANANA_OCT_12 = allocation('81c3e46a-27f9-4edb-95b6-cfa2d37e90be', BREAKFAST_OCT_12, 2_000);
const RICE_OCT_12 = allocation('92d4f57b-380a-4fec-a6c7-d0b3e48fa1cf', LUNCH_OCT_12, 450_000);
const CHICKEN_OCT_12 = allocation('a3e5068c-491b-40fd-b7d8-e1c4f590b2d0', LUNCH_OCT_12, 500_000);

function sumQuantities(allocations: ShoppingLineAllocation[]) {
  return allocations.reduce((total, { quantityMilli }) => total + quantityMilli, 0);
}

// The shares of a line that are still to buy: neither removed nor purchased.
function openShares(allocations: ShoppingLineAllocation[]) {
  return allocations.filter(({ status }) => status === 'needed' || status === 'in_cart');
}

/**
 * The line of an ingredient for all of these meals: what `groupBy=ingredient` serves. A line
 * that is not `needed` has every share in its status. A `needed` line keeps the status of each
 * share, and its quantity is what is still to buy.
 */
function ingredientLine(
  ingredient: Ingredient,
  shares: ShoppingLineAllocation[],
  status: ShoppingLineStatus = 'needed'
): ShoppingListLine {
  const allocations = status === 'needed' ? shares : shares.map((share) => ({ ...share, status }));

  return {
    id: `${ingredient.ingredientId}:${ingredient.unit}`,
    ...ingredient,
    quantityMilli: sumQuantities(status === 'needed' ? openShares(allocations) : allocations),
    status,
    source: 'planned_meal',
    supermarketId: null,
    allocations,
  };
}

// The line of an ingredient for one meal: what `groupBy=meal` serves. It has the status of
// its only share.
function mealLine(ingredient: Ingredient, share: ShoppingLineAllocation): ShoppingListLine {
  return {
    ...ingredientLine(ingredient, [share], share.status),
    quantityMilli: share.quantityMilli,
    id: share.itemId,
  };
}

const PLANNED_DATES = ['2026-10-08', '2026-10-10', '2026-10-12'];

const CART = {
  sessionId: '36d3abb6-dd68-4728-a33a-ab33b02ecdfe',
  leaseExpiresAt: '2026-10-08T18:12:27.085974Z',
  itemsCount: 2,
};

/**
 * `GET /api/shopping-list`: one line per ingredient. The rice adds up three meals and crosses
 * the kilo; only one of its shares is in the Cart, so the line still reads `needed`.
 */
export const SHOPPING_LIST_BY_INGREDIENT: ShoppingListRead = {
  planned: [
    ingredientLine(RICE, [RICE_OCT_8, RICE_OCT_10, RICE_OCT_12]),
    ingredientLine(CHICKEN, [CHICKEN_OCT_8, CHICKEN_OCT_12]),
    ingredientLine(TOMATO, [TOMATO_OCT_8, TOMATO_OCT_10]),
    ingredientLine(OLIVE_OIL, [OLIVE_OIL_OCT_8], 'in_cart'),
    ingredientLine(MILK, [MILK_OCT_10, MILK_OCT_12]),
    ingredientLine(BANANA, [BANANA_OCT_12]),
  ],
  manual: [],
  cart: CART,
  totals: { needed: 5, inCart: 1, removed: 0, estimatedCents: 0 },
  plannedDates: PLANNED_DATES,
};

/** `GET /api/shopping-list?groupBy=meal`: the same plan, one line per meal and ingredient. */
export const SHOPPING_LIST_BY_MEAL: ShoppingListRead = {
  planned: [
    mealLine(RICE, RICE_OCT_8),
    mealLine(CHICKEN, CHICKEN_OCT_8),
    mealLine(TOMATO, TOMATO_OCT_8),
    mealLine(OLIVE_OIL, OLIVE_OIL_OCT_8),
    mealLine(RICE, RICE_OCT_10),
    mealLine(TOMATO, TOMATO_OCT_10),
    mealLine(MILK, MILK_OCT_10),
    mealLine(MILK, MILK_OCT_12),
    mealLine(BANANA, BANANA_OCT_12),
    mealLine(RICE, RICE_OCT_12),
    mealLine(CHICKEN, CHICKEN_OCT_12),
  ],
  manual: [],
  cart: CART,
  totals: { needed: 9, inCart: 2, removed: 0, estimatedCents: 0 },
  plannedDates: PLANNED_DATES,
};

/**
 * `GET /api/shopping-list?untilDate=2026-10-10`: the meals of the 12th are left out, and the
 * planned dates still list that day.
 */
export const SHOPPING_LIST_UNTIL_OCT_10: ShoppingListRead = {
  planned: [
    ingredientLine(RICE, [RICE_OCT_8, RICE_OCT_10]),
    ingredientLine(CHICKEN, [CHICKEN_OCT_8]),
    ingredientLine(TOMATO, [TOMATO_OCT_8, TOMATO_OCT_10]),
    ingredientLine(OLIVE_OIL, [OLIVE_OIL_OCT_8], 'in_cart'),
    ingredientLine(MILK, [MILK_OCT_10]),
  ],
  manual: [],
  cart: CART,
  totals: { needed: 4, inCart: 1, removed: 0, estimatedCents: 0 },
  plannedDates: PLANNED_DATES,
};

/**
 * `GET /api/shopping-list?untilDate=2026-10-08` once the User ticked the milk and the banana of
 * the 12th instead, and then brought the date back to the 8th. No line of the read is in the
 * Cart, and the Cart still holds those two items: its `itemsCount` does not follow the date.
 */
export const SHOPPING_LIST_WITH_CART_OUT_OF_RANGE: ShoppingListRead = {
  planned: [
    ingredientLine(RICE, [{ ...RICE_OCT_8, status: 'needed' }]),
    ingredientLine(CHICKEN, [CHICKEN_OCT_8]),
    ingredientLine(TOMATO, [TOMATO_OCT_8]),
    ingredientLine(OLIVE_OIL, [{ ...OLIVE_OIL_OCT_8, status: 'needed' }]),
  ],
  manual: [],
  cart: CART,
  totals: { needed: 4, inCart: 0, removed: 0, estimatedCents: 0 },
  plannedDates: PLANNED_DATES,
};

/** The read of an Account with nothing planned from its today on. */
export const EMPTY_SHOPPING_LIST: ShoppingListRead = {
  planned: [],
  manual: [],
  cart: null,
  totals: { needed: 0, inCart: 0, removed: 0, estimatedCents: 0 },
  plannedDates: [],
};

/** The body of a read, as the route wraps it. */
export function toShoppingListResponse(read: ShoppingListRead) {
  return { data: read };
}

/** The 422 body of a read whose `untilDate` or `groupBy` the server rejects. */
export const SHOPPING_LIST_VALIDATION_ERROR = {
  error: { code: 'validation_error', message: 'A request parameter is not valid.' },
};

/**
 * A line the User added by hand, as `manual` serves it (section 7.1): no Ingredient, the
 * category `otros`, no allocation, 1 unit unless the quantity says otherwise.
 */
export const MANUAL_DISH_SOAP: ShoppingListLine = {
  id: 'd4f6179d-5a2b-41ae-8c19-f2d5e61b3a71',
  ingredientId: null,
  name: 'Detergente',
  category: 'otros',
  quantityMilli: 1_000,
  unit: 'unit',
  status: 'needed',
  source: 'manual',
  supermarketId: null,
  allocations: [],
};

/**
 * The plan of `SHOPPING_LIST_BY_INGREDIENT` once the User removed the tomato and added the dish
 * soap by hand. The removed line stays in `planned` with every allocation, so it can be
 * restored, and the totals count it apart; the manual line is not counted.
 */
export const SHOPPING_LIST_WITH_MANUAL_AND_REMOVED: ShoppingListRead = {
  planned: [
    ingredientLine(RICE, [RICE_OCT_8, RICE_OCT_10, RICE_OCT_12]),
    ingredientLine(CHICKEN, [CHICKEN_OCT_8, CHICKEN_OCT_12]),
    ingredientLine(TOMATO, [TOMATO_OCT_8, TOMATO_OCT_10], 'removed'),
    ingredientLine(OLIVE_OIL, [OLIVE_OIL_OCT_8], 'in_cart'),
    ingredientLine(MILK, [MILK_OCT_10, MILK_OCT_12]),
    ingredientLine(BANANA, [BANANA_OCT_12]),
  ],
  manual: [MANUAL_DISH_SOAP],
  cart: CART,
  totals: { needed: 4, inCart: 1, removed: 1, estimatedCents: 0 },
  plannedDates: PLANNED_DATES,
};

// The Cart of the plan was bought, with 250 g of rice where 400 g were suggested.
const RICE_OCT_8_BOUGHT: ShoppingLineAllocation = {
  ...RICE_OCT_8,
  quantityMilli: 250_000,
  status: 'purchased',
};
const RICE_OCT_8_REMAINDER = allocation(
  'b4f6179d-5a2c-41be-9c19-f2d5e61b3a82',
  LUNCH_OCT_8,
  150_000
);

/**
 * The plan of `SHOPPING_LIST_BY_INGREDIENT` once its Cart was bought. The oil is `purchased`
 * and stays on the list until its meal is cooked. The rice was bought in part: the share of the
 * first meal is split into what was bought and a `needed` remainder, and the line reads `needed`
 * with what is still to buy. Purchased lines are in none of the totals.
 */
export const SHOPPING_LIST_AFTER_PURCHASE: ShoppingListRead = {
  planned: [
    ingredientLine(RICE, [RICE_OCT_8_BOUGHT, RICE_OCT_8_REMAINDER, RICE_OCT_10, RICE_OCT_12]),
    ingredientLine(CHICKEN, [CHICKEN_OCT_8, CHICKEN_OCT_12]),
    ingredientLine(TOMATO, [TOMATO_OCT_8, TOMATO_OCT_10]),
    ingredientLine(OLIVE_OIL, [OLIVE_OIL_OCT_8], 'purchased'),
    ingredientLine(MILK, [MILK_OCT_10, MILK_OCT_12]),
    ingredientLine(BANANA, [BANANA_OCT_12]),
  ],
  manual: [],
  cart: null,
  totals: { needed: 5, inCart: 0, removed: 0, estimatedCents: 0 },
  plannedDates: PLANNED_DATES,
};

/** The `itemId` of the shares of the rice line above that are still to buy. */
export const RICE_NEEDED_ITEM_IDS = [
  RICE_OCT_8_REMAINDER.itemId,
  RICE_OCT_10.itemId,
  RICE_OCT_12.itemId,
];

/** The id of the Cart of the fixtures, and of the lines it holds as a confirm names them. */
export const CART_SESSION_ID = CART.sessionId;
export const RICE_LINE_ID = `${RICE.ingredientId}:${RICE.unit}`;
export const OLIVE_OIL_LINE_ID = `${OLIVE_OIL.ingredientId}:${OLIVE_OIL.unit}`;

/** The 200 body of `POST /api/checkout/confirm` for a physical purchase (section 7.4). */
export function toCheckoutResponse(movedToInventoryCount = 2) {
  return {
    data: {
      checkoutSessionId: CART_SESSION_ID,
      status: 'completed',
      checkoutType: 'physical',
      movedToInventoryCount,
      checkedOutItemsCount: movedToInventoryCount,
      actualTotalCents: 0,
    },
  };
}

/** The `itemId` of the two shares of the tomato line in the fixtures above. */
export const TOMATO_ITEM_IDS = [TOMATO_OCT_8.itemId, TOMATO_OCT_10.itemId];

/** The 201 body of `POST /api/shopping-items/manual`: the new line, as `manual` serves it. */
export function toManualItemResponse(line: ShoppingListLine) {
  return { data: line };
}

/** The 200 body of `DELETE /api/shopping-items/:itemId`. */
export function toDeleteItemResponse(id: string) {
  return { data: { id } };
}

/** The 200 body of `POST /api/shopping-items/set-status`. */
export function toSetStatusResponse(
  status: ShoppingItemsStatus,
  itemIds: string[],
  updatedRows: number = itemIds.length
): { data: ShoppingItemsStatusChange } {
  return { data: { status, itemIds, updatedRows } };
}

/** The error envelope of section 10 for a refused change of the list. */
export function toShoppingErrorResponse(code: string, message: string) {
  return { error: { code, message } };
}
