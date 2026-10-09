import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type {
  CancelledCart,
  MarkedCart,
  ShoppingCart,
  ShoppingListQuery,
  ShoppingListRead,
} from '../types/shoppingApi';

const SHOPPING_LIST_PATH = '/api/shopping-list';

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

const CART_PATH = '/api/cart';

function parseCartData(response: unknown): Record<string, unknown> {
  const data = isRecord(response) ? response.data : undefined;

  if (!isRecord(data) || typeof data.sessionId !== 'string') {
    throw new ApiError('unknown_error', 'Malformed cart response');
  }

  return data;
}

function parseLease(response: unknown): ShoppingCart {
  const data = parseCartData(response);

  if (typeof data.leaseExpiresAt !== 'string') {
    throw new ApiError('unknown_error', 'Malformed cart response');
  }

  return { sessionId: data.sessionId as string, leaseExpiresAt: data.leaseExpiresAt };
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
  const lease = parseLease(response);
  const items = (response as { data: Record<string, unknown> }).data.items;

  if (!Array.isArray(items)) throw new ApiError('unknown_error', 'Malformed cart response');

  return { ...lease, items: items as MarkedCart['items'] };
}

/** Extends the lease of a Cart. An expired lease is refused as `stale_cart`. */
export async function renewCart(sessionId: string, options?: RequestOptions) {
  const response = await apiClient.post<unknown>(
    `${CART_PATH}/${encodeURIComponent(sessionId)}/activity`,
    undefined,
    { ...options, auth: true }
  );

  return parseLease(response);
}

/** Abandons a Cart: its items go back to the list. */
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

  return {
    sessionId: data.sessionId as string,
    updatedRows: typeof data.updatedRows === 'number' ? data.updatedRows : 0,
    status: 'abandoned',
  };
}
