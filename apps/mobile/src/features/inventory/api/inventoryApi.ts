import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type {
  AddExtraItemPayload,
  InventoryItemDisposal,
  InventoryItemWrite,
  InventoryView,
} from '../types';

// Every success of the inventory routes is wrapped as `{ data }`. The transport hands back
// null for an empty or non-JSON body and does not check the shape of a 2xx answer, so one
// without data is treated like any other unintelligible server answer.
function unwrapData<T>(response: unknown): T {
  const data = (response as { data?: T | null } | null)?.data;
  if (data === undefined || data === null) {
    throw new ApiError('unknown_error', 'Malformed inventory response');
  }
  return data;
}

function itemPath(itemId: string, action: 'quantity' | 'dispose'): string {
  return `/api/inventory/items/${encodeURIComponent(itemId)}/${action}`;
}

export async function getInventory(): Promise<InventoryView> {
  const view = unwrapData<InventoryView>(
    await apiClient.get<unknown>('/api/inventory', { auth: true, retry: true })
  );
  // The cache is built from the sections, so a view without them cannot be used.
  const { ok, warning, expired } = view.sections ?? {};
  if (![ok, warning, expired].every(Array.isArray)) {
    throw new ApiError('unknown_error', 'Malformed inventory response');
  }
  return view;
}

export async function addExtraItem(payload: AddExtraItemPayload): Promise<InventoryItemWrite> {
  return unwrapData<InventoryItemWrite>(
    await apiClient.post<unknown>('/api/inventory/items/add-extra', payload, { auth: true })
  );
}

export async function setItemQuantity(
  itemId: string,
  quantityMilli: number
): Promise<InventoryItemWrite> {
  return unwrapData<InventoryItemWrite>(
    await apiClient.post<unknown>(itemPath(itemId, 'quantity'), { quantityMilli }, { auth: true })
  );
}

export async function disposeItem(itemId: string): Promise<InventoryItemDisposal> {
  return unwrapData<InventoryItemDisposal>(
    await apiClient.post<unknown>(itemPath(itemId, 'dispose'), undefined, { auth: true })
  );
}
