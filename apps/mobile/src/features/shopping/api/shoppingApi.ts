import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type {
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
    !(data.cart === null || isRecord(data.cart))
  ) {
    throw new ApiError('unknown_error', 'Malformed shopping list response');
  }

  return data as unknown as ShoppingListRead;
}

function malformed(what: string) {
  return new ApiError('unknown_error', `Malformed ${what} response`);
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
