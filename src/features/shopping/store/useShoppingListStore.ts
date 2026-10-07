import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useInventoryStore } from '@/features/inventory/store';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { MOCK_SUPERMARKET_OFFERS } from '../mocks';
import type {
  ManualShoppingListItem,
  ShoppingGroupingMode,
  ShoppingItemStatus,
  ShoppingListItem,
  SupermarketOffer,
} from '../types';

// Manual ids never collide with the planned ones, which are `planned:<ingredientId>`.
const MANUAL_ID_PREFIX = 'manual:';

const MANUAL_ITEM_STATUSES: ShoppingItemStatus[] = ['needed', 'in_cart', 'removed'];

function isManualItemId(id: string) {
  return id.startsWith(MANUAL_ID_PREFIX);
}

// Sequence of a manual id, or 0 when the id does not carry one.
function getManualItemSequence(id: string) {
  const sequence = Number(id.slice(MANUAL_ID_PREFIX.length));
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
}

function getHighestManualItemSequence(ids: string[]) {
  return ids.reduce((highest, id) => Math.max(highest, getManualItemSequence(id)), 0);
}

// Moves the manual items in status `from` to status `to`: only the ones in `ids`, or all of
// them without it. The stored status decides, so a stale row never skips a transition. The
// same list is returned when no item moves, so a subscriber is not woken up for nothing.
function moveManualItems(
  manualItems: ManualShoppingListItem[],
  from: ShoppingItemStatus,
  to: ShoppingItemStatus,
  ids?: string[]
) {
  const moves = (item: ManualShoppingListItem) =>
    item.status === from && (ids === undefined || ids.includes(item.id));

  if (!manualItems.some(moves)) return manualItems;
  return manualItems.map((item) => (moves(item) ? { ...item, status: to } : item));
}

interface ShoppingListState {
  // Ids of the planned items in the cart. A manual item carries that in its own status.
  cartIds: string[];
  removedIds: string[];
  manualItems: ManualShoppingListItem[];
  // Last sequence handed out to a manual item. A confirmed purchase deletes manual items
  // for good, so the stored items alone cannot tell which ids were already used.
  lastManualItemSequence: number;
  groupingMode: ShoppingGroupingMode;
  offers: SupermarketOffer[];
  addToCart: (itemIds: string[]) => void;
  takeOutOfCart: (itemIds: string[]) => void;
  confirmPurchase: (items: ShoppingListItem[]) => void;
  removeItem: (item: ShoppingListItem) => void;
  // Puts one removed row back on the list. An id that is not removed changes nothing.
  restoreItem: (itemId: string) => void;
  restoreRemovedItems: () => void;
  addManualItem: (name: string) => void;
  setGroupingMode: (groupingMode: ShoppingGroupingMode) => void;
}

type PersistedShoppingListState = Pick<
  ShoppingListState,
  'cartIds' | 'removedIds' | 'manualItems' | 'lastManualItemSequence' | 'groupingMode'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The distinct strings of a stored list; anything else stored in its place is dropped.
function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string'))];
}

function readStoredManualItems(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readManualItemId({ id }: Record<string, unknown>) {
  return typeof id === 'string' && isManualItemId(id) ? id : undefined;
}

// A stored manual item rebuilt from the fields the list owns, or nothing when it is not one
// the list can show: without a manual id or a name, or in a status this version does not know.
function readManualItem(stored: Record<string, unknown>): ManualShoppingListItem | undefined {
  const id = readManualItemId(stored);
  const { name, status } = stored;
  const knownStatus = MANUAL_ITEM_STATUSES.find((candidate) => candidate === status);

  if (id === undefined || typeof name !== 'string' || knownStatus === undefined) return undefined;
  return { id, source: 'manual', status: knownStatus, name };
}

function readSequence(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * Upgrades what an earlier version stored. Version 1 kept purchase records and manual items
 * that stayed `purchased`: the records are dropped, because that stock is already in the
 * inventory, and so are those items, because a confirmed purchase now leaves the list. A
 * removed manual item stays removed.
 *
 * Nothing is trusted: only the fields this store owns are read, each one by its shape, so a
 * stored state of any version, or a malformed one, hydrates into a valid list. The id counter
 * starts after the highest manual id found, dropped items included, so no id is handed out twice.
 */
export function migrateShoppingListState(persistedState: unknown): PersistedShoppingListState {
  const stored = isRecord(persistedState) ? persistedState : {};
  const storedManualItems = readStoredManualItems(stored.manualItems);
  const storedManualItemIds = storedManualItems.flatMap((item) => readManualItemId(item) ?? []);

  return {
    cartIds: readIds(stored.cartIds),
    removedIds: readIds(stored.removedIds),
    manualItems: storedManualItems.flatMap((item) => readManualItem(item) ?? []),
    lastManualItemSequence: Math.max(
      readSequence(stored.lastManualItemSequence),
      getHighestManualItemSequence(storedManualItemIds)
    ),
    groupingMode: stored.groupingMode === 'supermarket' ? 'supermarket' : 'category',
  };
}

export const useShoppingListStore = create<ShoppingListState>()(
  persist(
    (set, get) => ({
      cartIds: [],
      removedIds: [],
      manualItems: [],
      lastManualItemSequence: 0,
      groupingMode: 'category',
      offers: MOCK_SUPERMARKET_OFFERS,
      // Marking is staging: nothing reaches the inventory until the purchase is confirmed.
      addToCart: (itemIds) => {
        set((state) => {
          // A removed planned item is not on the list, so it cannot be put in the cart.
          const addedIds = [...new Set(itemIds)].filter(
            (id) =>
              !isManualItemId(id) && !state.cartIds.includes(id) && !state.removedIds.includes(id)
          );

          return {
            cartIds: addedIds.length > 0 ? [...state.cartIds, ...addedIds] : state.cartIds,
            manualItems: moveManualItems(state.manualItems, 'needed', 'in_cart', itemIds),
          };
        });
      },
      takeOutOfCart: (itemIds) => {
        set((state) => ({
          cartIds: state.cartIds.some((id) => itemIds.includes(id))
            ? state.cartIds.filter((id) => !itemIds.includes(id))
            : state.cartIds,
          manualItems: moveManualItems(state.manualItems, 'in_cart', 'needed', itemIds),
        }));
      },
      /**
       * Buys the cart. `items` is the list as it is derived right now: it says which planned
       * rows still exist and how much each one is missing, while the store says which ones
       * are in the cart. So an id whose row is gone (its meal was cooked, the plan changed)
       * is dropped without touching the inventory, and a second call finds the cart empty.
       *
       * The inventory covers the plan from then on, so the bought rows leave the list by
       * themselves. A manual item has no stock to cover it: it is deleted. There is no undo.
       */
      confirmPurchase: (items) => {
        const { cartIds, removedIds } = get();

        for (const item of items) {
          if (item.source !== 'planned_meal') continue;
          if (!cartIds.includes(item.id) || removedIds.includes(item.id)) continue;

          useInventoryStore.getState().addItem(item.ingredientId, item.amountToBuy);
        }

        set((state) => ({
          cartIds: [],
          manualItems: state.manualItems.filter((item) => item.status !== 'in_cart'),
        }));
      },
      // A removed row leaves the cart too: restoring it brings it back as needed.
      removeItem: (item) => {
        set((state) => {
          if (item.source === 'manual') {
            return {
              manualItems: state.manualItems.map((manualItem) =>
                manualItem.id === item.id ? { ...manualItem, status: 'removed' } : manualItem
              ),
            };
          }

          return {
            cartIds: state.cartIds.includes(item.id)
              ? state.cartIds.filter((id) => id !== item.id)
              : state.cartIds,
            removedIds: state.removedIds.includes(item.id)
              ? state.removedIds
              : [...state.removedIds, item.id],
          };
        });
      },
      // Like removing, restoring never puts a row in the cart: it comes back as needed.
      restoreItem: (itemId) => {
        set((state) => ({
          removedIds: state.removedIds.includes(itemId)
            ? state.removedIds.filter((id) => id !== itemId)
            : state.removedIds,
          manualItems: moveManualItems(state.manualItems, 'removed', 'needed', [itemId]),
        }));
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

        set((state) => {
          // The stored ids are read too, so a state restored with a counter that is behind
          // them still never repeats one.
          const sequence =
            Math.max(
              state.lastManualItemSequence,
              getHighestManualItemSequence(state.manualItems.map((item) => item.id))
            ) + 1;

          return {
            lastManualItemSequence: sequence,
            manualItems: [
              ...state.manualItems,
              {
                id: `${MANUAL_ID_PREFIX}${sequence}`,
                source: 'manual',
                status: 'needed',
                name: trimmedName,
              },
            ],
          };
        });
      },
      setGroupingMode: (groupingMode) => set({ groupingMode }),
    }),
    {
      name: 'shopping-list-storage',
      version: 2,
      storage: createJSONStorage(() => safeAsyncStorage),
      // Runs when the stored version is another one.
      migrate: migrateShoppingListState,
      // Only what the user did is stored. The offers are catalogue data: persisting them
      // would freeze a stale copy on the device every time their source changes.
      partialize: ({
        cartIds,
        removedIds,
        manualItems,
        lastManualItemSequence,
        groupingMode,
      }): PersistedShoppingListState => ({
        cartIds,
        removedIds,
        manualItems,
        lastManualItemSequence,
        groupingMode,
      }),
    }
  )
);
