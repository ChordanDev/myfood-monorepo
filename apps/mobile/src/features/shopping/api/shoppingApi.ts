import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type {
  CancelledCart,
  CartLease,
  CartReservation,
  CheckoutConfirmation,
  CheckoutResult,
  MarkedCart,
  NewManualShoppingItem,
  ShoppingItemsStatus,
  ShoppingItemsStatusChange,
  ShoppingListLine,
  ShoppingListQuery,
  ShoppingListRead,
} from '../types/shoppingApi';

const SHOPPING_LIST_PATH = '/api/shopping-list';
const SHOPPING_ITEMS_PATH = '/api/shopping-items';

// A filter that is not set is not sent: the server then covers every upcoming meal, grouped
// by ingredient.
function buildShoppingListPath({ untilDate, groupBy }: ShoppingListQuery) {
  const params = Object.entries({ untilDate, groupBy }).flatMap(([name, value]) =>
    value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`]
  );

  return params.length > 0 ? `${SHOPPING_LIST_PATH}?${params.join('&')}` : SHOPPING_LIST_PATH;
}

/**
 * Reads the Shopping list of the Account. "Today" is the server's: the list starts at the
 * Account's today, so no date of this device is ever sent to say where it begins.
 */
export async function getShoppingList(
  query: ShoppingListQuery = {},
  options?: RequestOptions
): Promise<ShoppingListRead> {
  const response = await apiClient.get<unknown>(buildShoppingListPath(query), {
    ...options,
    auth: true,
    retry: options?.retry ?? true,
  });

  return parseShoppingListResponse(response);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A 2xx answer this client cannot read is an error like any other unintelligible answer.
function malformed(what: string) {
  return new ApiError('unknown_error', `Malformed ${what} response`);
}

// A line of the Cart of a read: the sheet draws it and a confirm names it by its id.
function isShoppingCartLine(line: unknown) {
  return (
    isRecord(line) &&
    typeof line.id === 'string' &&
    line.id !== '' &&
    typeof line.name === 'string' &&
    typeof line.unit === 'string' &&
    Number.isInteger(line.quantityMilli) &&
    (line.quantityMilli as number) >= 0
  );
}

// The Cart of a read: without its lines the screen could not say what a confirm buys.
function isShoppingCart(cart: unknown) {
  return isRecord(cart) && Array.isArray(cart.lines) && cart.lines.every(isShoppingCartLine);
}

// The transport hands back null for an empty or non-JSON body and does not check the shape of
// a 2xx answer, so the caller would otherwise cache whatever arrived as the list. An answer
// without the members of a read is treated like any other unintelligible server answer.
function parseShoppingListResponse(response: unknown): ShoppingListRead {
  const data = isRecord(response) ? response.data : undefined;

  if (
    !isRecord(data) ||
    !Array.isArray(data.planned) ||
    !Array.isArray(data.manual) ||
    !Array.isArray(data.plannedDates) ||
    !isRecord(data.totals) ||
    !(data.cart === null || isShoppingCart(data.cart))
  ) {
    throw new ApiError('unknown_error', 'Malformed shopping list response');
  }

  return data as unknown as ShoppingListRead;
}

const CART_PATH = '/api/cart';

// What every answer about a Cart carries: the session it is about.
type CartData = Record<string, unknown> & { sessionId: string };

function parseCartData(response: unknown): CartData {
  const data = isRecord(response) ? response.data : undefined;

  if (!isRecord(data) || typeof data.sessionId !== 'string') throw malformed('cart');

  return data as CartData;
}

// The lease out of the `data` of an answer that carries one.
function toLease(data: CartData): CartLease {
  if (typeof data.leaseExpiresAt !== 'string') throw malformed('cart');

  return { sessionId: data.sessionId, leaseExpiresAt: data.leaseExpiresAt };
}

// A Shopping item a Cart reserved. The server gives every item it marks a reservation token.
function isCartReservation(item: unknown): item is CartReservation {
  return (
    isRecord(item) &&
    typeof item.itemId === 'string' &&
    item.itemId !== '' &&
    typeof item.reservationToken === 'string' &&
    item.reservationToken !== '' &&
    Number.isInteger(item.quantityMilli) &&
    (item.quantityMilli as number) >= 0
  );
}

/**
 * Ticks Shopping items into the Cart of the signed-in Membership, which starts a Cart lease.
 * Items another Membership holds are refused as `cart_locked`.
 */
export async function markInCart(itemIds: string[], options?: RequestOptions): Promise<MarkedCart> {
  const response = await apiClient.post<unknown>(
    '/api/shopping-items/mark-cart',
    { itemIds },
    { ...options, auth: true }
  );
  const data = parseCartData(response);
  const lease = toLease(data);
  const { items } = data;

  // One item that cannot be read makes the whole answer unreadable: the Cart would hold
  // something this client cannot name.
  if (!Array.isArray(items) || !items.every(isCartReservation)) throw malformed('cart');

  return { ...lease, items };
}

/** Extends the lease of a Cart. An expired lease is refused as `stale_cart`. */
export async function renewCart(sessionId: string, options?: RequestOptions) {
  const response = await apiClient.post<unknown>(
    `${CART_PATH}/${encodeURIComponent(sessionId)}/activity`,
    undefined,
    { ...options, auth: true }
  );

  return toLease(parseCartData(response));
}

/**
 * Abandons a Cart: its items go back to the list. The answer is the server's word that the
 * Cart was abandoned, so one that does not say it is not read as a cancel that worked.
 */
export async function cancelCart(
  sessionId: string,
  options?: RequestOptions
): Promise<CancelledCart> {
  const response = await apiClient.request<unknown>(
    `${CART_PATH}/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
    { ...options, auth: true }
  );
  const data = parseCartData(response);
  const { status, updatedRows } = data;

  if (status !== 'abandoned' || !Number.isInteger(updatedRows)) throw malformed('cart');

  return { sessionId: data.sessionId, updatedRows: updatedRows as number, status };
}

const CHECKOUT_STATUSES: unknown[] = ['completed', 'pending_delivery'];
const CHECKOUT_TYPES: unknown[] = ['physical', 'online'];

/**
 * Confirms a Cart as purchased (section 7.4). Only the lines bought at another quantity than
 * the one the Cart holds are sent: the server buys the rest as they are. Confirming a session
 * again answers the result of the first time and buys nothing twice, so the transport asks
 * again when the network fails.
 */
export async function confirmCheckout(
  { sessionId, checkoutType, lines }: CheckoutConfirmation,
  options?: RequestOptions
): Promise<CheckoutResult> {
  const response = await apiClient.post<unknown>(
    '/api/checkout/confirm',
    { sessionId, checkoutType, ...(lines && lines.length > 0 ? { lines } : {}) },
    { ...options, auth: true, retry: options?.retry ?? true }
  );
  const data = isRecord(response) ? response.data : undefined;

  if (
    !isRecord(data) ||
    typeof data.checkoutSessionId !== 'string' ||
    !CHECKOUT_STATUSES.includes(data.status) ||
    !CHECKOUT_TYPES.includes(data.checkoutType) ||
    typeof data.movedToInventoryCount !== 'number' ||
    typeof data.checkedOutItemsCount !== 'number' ||
    typeof data.actualTotalCents !== 'number'
  ) {
    throw malformed('checkout');
  }

  return data as unknown as CheckoutResult;
}

// The changes below are not repeated by the transport when the network fails: an add whose
// answer was lost may have landed, and asking again would add the item twice.

/**
 * Adds an item by hand to the list (section 7.6). Only the name is required: the server reads
 * 1 unit when the quantity and the unit are left out. Answers the new line, as `manual`
 * serves it.
 */
export async function addManualShoppingItem(
  item: NewManualShoppingItem,
  options?: RequestOptions
): Promise<ShoppingListLine> {
  const response = await apiClient.post<unknown>(`${SHOPPING_ITEMS_PATH}/manual`, item, {
    ...options,
    auth: true,
  });
  const data = isRecord(response) ? response.data : undefined;

  if (!isRecord(data) || typeof data.id !== 'string' || data.source !== 'manual') {
    throw malformed('manual shopping item');
  }

  return data as unknown as ShoppingListLine;
}

/** Deletes an item the User added by hand (section 7.7). Answers its id. */
export async function deleteShoppingItem(
  itemId: string,
  options?: RequestOptions
): Promise<string> {
  const response = await apiClient.delete<unknown>(
    `${SHOPPING_ITEMS_PATH}/${encodeURIComponent(itemId)}`,
    { ...options, auth: true }
  );
  const data = isRecord(response) ? response.data : undefined;

  if (!isRecord(data) || typeof data.id !== 'string') {
    throw malformed('deleted shopping item');
  }

  return data.id;
}

/**
 * Removes planned items from the list, or brings them back (section 7.8). The ids are the
 * `itemId` of the allocations of a planned line. The call is all or nothing.
 */
export async function setShoppingItemsStatus(
  itemIds: string[],
  status: ShoppingItemsStatus,
  options?: RequestOptions
): Promise<ShoppingItemsStatusChange> {
  const response = await apiClient.post<unknown>(
    `${SHOPPING_ITEMS_PATH}/set-status`,
    { itemIds, status },
    { ...options, auth: true }
  );
  const data = isRecord(response) ? response.data : undefined;

  if (!isRecord(data) || !Array.isArray(data.itemIds) || typeof data.status !== 'string') {
    throw malformed('shopping items status');
  }

  return data as unknown as ShoppingItemsStatusChange;
}
