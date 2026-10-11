import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ApiError, isApiError } from '@/api/errors';
import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import type { Ingredient } from '@/types/domain';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { addExtraItem, applyVoice, disposeItem, getInventory, setItemQuantity } from '../api';
import type {
  AddExtraItemPayload,
  InventoryItem,
  VoiceApplyPayload,
  VoiceApplyResult,
} from '../types';

type InventoryLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface InventoryState {
  // Cache of the last read of the API, patched with the answer of each write since
  items: InventoryItem[];
  ingredients: Ingredient[];
  loadStatus: InventoryLoadStatus;
  loadError: ApiError | null;
  refresh: () => Promise<void>;
  addExtra: (payload: AddExtraItemPayload) => Promise<InventoryItem>;
  setQuantity: (id: string, quantityMilli: number) => Promise<void>;
  dispose: (id: string) => Promise<void>;
  applyVoice: (payload: VoiceApplyPayload) => Promise<VoiceApplyResult>;
  consumeIngredient: (ingredientId: string, quantityMilli: number) => void;
  getIngredient: (id: string) => Ingredient | undefined;
}

type PersistedInventoryState = Pick<InventoryState, 'items' | 'ingredients'>;

// The API does not list a lot at zero, so the cache does not hold one either.
function replaceLot(items: InventoryItem[], lot: InventoryItem): InventoryItem[] {
  if (lot.quantityMilli <= 0) return items.filter((item) => item.id !== lot.id);
  if (!items.some((item) => item.id === lot.id)) return [...items, lot];

  return items.map((item) => (item.id === lot.id ? lot : item));
}

function toApiError(error: unknown): ApiError {
  return isApiError(error) ? error : new ApiError('unknown_error', 'Request failed');
}

// Everything persisted before version 2 was local fixture stock in display units, never read
// from the API, so no device keeps it. The catalog of version 0 used retired categories.
export function migrateInventoryState(
  persistedState: unknown,
  version: number
): PersistedInventoryState {
  if (version >= 2) return persistedState as PersistedInventoryState;

  return { items: [], ingredients: MOCK_INGREDIENTS };
}

// The read that owns the load status, and how many writes the cache has taken. A read that
// was on its way during a write may have been answered before it.
let latestRead = 0;
let writeCount = 0;

export const useInventoryStore = create<InventoryState>()(
  persist(
    (set, get) => ({
      items: [],
      ingredients: MOCK_INGREDIENTS,
      loadStatus: 'idle',
      loadError: null,
      refresh: async () => {
        const read = ++latestRead;
        const writesAtStart = writeCount;
        set({ loadStatus: 'loading', loadError: null });

        try {
          const { sections } = await getInventory();
          if (read !== latestRead) return;
          if (writesAtStart !== writeCount) return get().refresh();

          // What to use first comes first
          set({
            items: [...sections.expired, ...sections.warning, ...sections.ok],
            loadStatus: 'ready',
          });
        } catch (error) {
          if (read !== latestRead) return;

          // A failed read leaves the last one in the cache
          set({ loadStatus: 'error', loadError: toApiError(error) });
        }
      },
      // The writes are online only: the cache changes with the answer of the API, so a
      // failed one leaves it as it was and rejects with the envelope error.
      addExtra: async (payload) => {
        const { item } = await addExtraItem(payload);
        writeCount += 1;
        // A plain add accumulates in the lot the API already had, which comes back whole
        set((state) => ({ items: replaceLot(state.items, item) }));
        return item;
      },
      setQuantity: async (id, quantityMilli) => {
        const { item } = await setItemQuantity(id, quantityMilli);
        writeCount += 1;
        set((state) => ({ items: replaceLot(state.items, item) }));
      },
      dispose: async (id) => {
        await disposeItem(id);
        writeCount += 1;
        set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
      },
      // Each event of the answer says what its lot holds now, so the cache takes it as is. The
      // answer goes back to the caller: it says how much the API subtracted.
      applyVoice: async (payload) => {
        const result = await applyVoice(payload);
        writeCount += 1;
        set((state) => ({
          items: result.mutationEvents.reduce((items, event) => {
            const lot = items.find((item) => item.id === event.inventoryItemId);
            return lot
              ? replaceLot(items, { ...lot, quantityMilli: event.quantityAfterMilli })
              : items;
          }, state.items),
        }));
        return result;
      },
      // Temporary: `consumeIngredient` (cooking) only patches the cache, in thousandths, until
      // the cooking slice calls the API. The API never hears of it, so the next read replaces
      // what it wrote.
      consumeIngredient: (ingredientId, quantityMilli) => {
        set((state) => {
          const lot = state.items.find((item) => item.ingredientId === ingredientId);
          if (!lot) return state;

          // Inventory never goes negative
          const quantity = Math.max(0, lot.quantityMilli - quantityMilli);
          return { items: replaceLot(state.items, { ...lot, quantityMilli: quantity }) };
        });
      },
      getIngredient: (id) => {
        return get().ingredients.find((i) => i.id === id);
      },
    }),
    {
      name: 'inventory-storage',
      version: 2, // Lots as the API serves them, in thousandths; no local fixture stock
      storage: createJSONStorage(() => safeAsyncStorage),
      partialize: ({ items, ingredients }) => ({ items, ingredients }),
      migrate: migrateInventoryState,
    }
  )
);
