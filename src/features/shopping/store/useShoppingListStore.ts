import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useInventoryStore } from '@/store';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { MOCK_SUPERMARKET_OFFERS } from '../mocks';
import type {
  ManualShoppingListItem,
  PurchaseRecords,
  ShoppingGroupingMode,
  ShoppingItemStatus,
  ShoppingListItem,
  SupermarketOffer,
} from '../types';

// Manual ids never collide with the planned ones, which are `planned:<ingredientId>`.
const MANUAL_ID_PREFIX = 'manual:';

// Next id in sequence. Manual items are never deleted, only flagged as removed, so the
// highest sequence in the list is always the last one handed out.
function getNextManualItemId(manualItems: ManualShoppingListItem[]) {
  const lastSequence = manualItems.reduce((highest, { id }) => {
    const sequence = Number(id.slice(MANUAL_ID_PREFIX.length));
    return Number.isInteger(sequence) ? Math.max(highest, sequence) : highest;
  }, 0);

  return `${MANUAL_ID_PREFIX}${lastSequence + 1}`;
}

// Moves the manual items in status `from` to status `to`: only the one with `id`, or all of
// them without it. The stored status decides, so a stale row never skips a transition.
function moveManualItems(
  manualItems: ManualShoppingListItem[],
  from: ShoppingItemStatus,
  to: ShoppingItemStatus,
  id?: string
) {
  return manualItems.map((item) =>
    item.status === from && (id === undefined || item.id === id) ? { ...item, status: to } : item
  );
}

interface ShoppingListState {
  purchases: PurchaseRecords;
  removedIds: string[];
  manualItems: ManualShoppingListItem[];
  groupingMode: ShoppingGroupingMode;
  offers: SupermarketOffer[];
  markPurchased: (item: ShoppingListItem) => void;
  unmarkPurchased: (item: ShoppingListItem) => void;
  markAllPurchased: (items: ShoppingListItem[]) => void;
  unmarkAllPurchased: (items: ShoppingListItem[]) => void;
  removeItem: (item: ShoppingListItem) => void;
  restoreRemovedItems: () => void;
  addManualItem: (name: string) => void;
  setGroupingMode: (groupingMode: ShoppingGroupingMode) => void;
}

export const useShoppingListStore = create<ShoppingListState>()(
  persist(
    (set, get) => ({
      purchases: {},
      removedIds: [],
      manualItems: [],
      groupingMode: 'category',
      offers: MOCK_SUPERMARKET_OFFERS,
      markPurchased: (item) => {
        if (item.status !== 'needed') return;

        if (item.source === 'manual') {
          set((state) => ({
            manualItems: moveManualItems(state.manualItems, 'needed', 'purchased', item.id),
          }));
          return;
        }

        // A planned row carries a derived status; one captured before its removal is stale.
        if (get().removedIds.includes(item.id)) return;

        // The record is overwritten, never accumulated: a row needed again after a past
        // purchase tracks the latest one, so one unmark undoes one mark.
        useInventoryStore.getState().addItem(item.ingredientId, item.amountToBuy);
        set((state) => ({ purchases: { ...state.purchases, [item.id]: item.amountToBuy } }));
      },
      unmarkPurchased: (item) => {
        if (item.status !== 'purchased') return;

        if (item.source === 'manual') {
          set((state) => ({
            manualItems: moveManualItems(state.manualItems, 'purchased', 'needed', item.id),
          }));
          return;
        }

        const { purchases, removedIds } = get();
        const purchasedAmount = purchases[item.id];
        if (purchasedAmount === undefined || removedIds.includes(item.id)) return;

        // `removeItem` drops the entry when it holds no more than the amount, so stock
        // already consumed by cooking is never taken below zero.
        useInventoryStore.getState().removeItem(item.ingredientId, purchasedAmount);
        set((state) => {
          const purchases = { ...state.purchases };
          delete purchases[item.id];
          return { purchases };
        });
      },
      // The bulk actions run the single ones, which skip every item they do not apply to.
      markAllPurchased: (items) => items.forEach((item) => get().markPurchased(item)),
      unmarkAllPurchased: (items) => items.forEach((item) => get().unmarkPurchased(item)),
      removeItem: (item) => {
        set((state) => {
          if (item.source === 'manual') {
            return {
              manualItems: state.manualItems.map((manualItem) =>
                manualItem.id === item.id ? { ...manualItem, status: 'removed' } : manualItem
              ),
            };
          }

          if (state.removedIds.includes(item.id)) return state;
          return { removedIds: [...state.removedIds, item.id] };
        });
      },
      restoreRemovedItems: () => {
        set((state) => ({
          removedIds: [],
          manualItems: moveManualItems(state.manualItems, 'removed', 'needed'),
        }));
      },
      addManualItem: (name) => {
        const trimmedName = name.trim();
        if (!trimmedName) return;

        set((state) => ({
          manualItems: [
            ...state.manualItems,
            {
              id: getNextManualItemId(state.manualItems),
              source: 'manual',
              status: 'needed',
              name: trimmedName,
            },
          ],
        }));
      },
      setGroupingMode: (groupingMode) => set({ groupingMode }),
    }),
    {
      name: 'shopping-list-storage',
      version: 1,
      storage: createJSONStorage(() => safeAsyncStorage),
      // Only what the user did is stored. The offers are catalogue data: persisting them
      // would freeze a stale copy on the device every time their source changes.
      partialize: ({ purchases, removedIds, manualItems, groupingMode }) => ({
        purchases,
        removedIds,
        manualItems,
        groupingMode,
      }),
    }
  )
);
