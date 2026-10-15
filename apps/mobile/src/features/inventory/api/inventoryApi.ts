import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type {
  AddExtraItemPayload,
  IngredientOption,
  InventoryItemDisposal,
  InventoryItemWrite,
  InventoryView,
  VoiceApplyPayload,
  VoiceApplyResult,
  VoicePreview,
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

// The Ingredients of the catalogue whose name holds `query`, at most 20. The add sheet picks
// the Ingredient it adds from them.
export async function searchIngredients(query: string): Promise<IngredientOption[]> {
  const ingredients = unwrapData<IngredientOption[]>(
    await apiClient.get<unknown>(`/api/ingredients?query=${encodeURIComponent(query)}`, {
      auth: true,
    })
  );
  if (!Array.isArray(ingredients)) {
    throw new ApiError('unknown_error', 'Malformed ingredient search response');
  }
  return ingredients;
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

// Parses a transcript without touching the inventory. Rejects with `voice_parse_failed` when
// nothing can be understood.
export async function previewVoice(transcript: string): Promise<VoicePreview> {
  return unwrapData<VoicePreview>(
    await apiClient.post<unknown>('/api/inventory/voice/preview', { transcript }, { auth: true })
  );
}

// The API re-derives the confidence from the transcript: an intent that needs confirmation is
// refused with `voice_confirmation_required` unless `confirmed` is true.
export async function applyVoice(payload: VoiceApplyPayload): Promise<VoiceApplyResult> {
  return unwrapData<VoiceApplyResult>(
    await apiClient.post<unknown>('/api/inventory/voice/apply', payload, { auth: true })
  );
}
