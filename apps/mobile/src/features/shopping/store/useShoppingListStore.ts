import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isApiError } from '@/api/errors';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { getShoppingList } from '../api/shoppingApi';
import type { ShoppingGroupBy, ShoppingListLoadStatus, ShoppingListRead } from '../types';

interface ShoppingListState {
  // Id of the signed-in user the list, its status and its error belong to, or `null` when
  // they belong to nobody. The cache lives in memory, so it outlives a sign-out: what was read
  // for one user is never the list of the next one on the same device.
  ownerId: string | null;
  // The last read of the list, whole. The server owns the list: nothing here is derived on
  // the device or merged between reads. `null` until the first read lands.
  list: ShoppingListRead | null;
  status: ShoppingListLoadStatus;
  // What the last read failed with, while `status` is `error`.
  error: unknown;
  // 'YYYY-MM-DD' key of the last day the user chose to buy for. Without one the list reaches
  // the last planned date. It is how this device reads the list, not something to sync.
  chosenUntilDate: string | undefined;
  groupBy: ShoppingGroupBy;
  // Reads the list of the signed-in user with the current preferences, and replaces the
  // cached one with the answer. A list cached for another user is dropped before anything is
  // asked for. Without a signed-in user (`null`) there is no list and nothing is read.
  refresh: (ownerId: string | null) => Promise<void>;
  // Both keep the preference and read the list of the user of the cache again with it.
  setChosenUntilDate: (dateKey: string | undefined) => Promise<void>;
  setGroupBy: (groupBy: ShoppingGroupBy) => Promise<void>;
}

type PersistedShoppingListState = Pick<ShoppingListState, 'chosenUntilDate' | 'groupBy'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDateKey(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * Upgrades what an earlier version stored. Up to version 2 the list lived on the device: the
 * cart, the removed rows and the items added by hand were stored next to a grouping by
 * supermarket. The server owns all of that now, so only the chosen day is kept.
 *
 * Nothing is trusted: only the fields this store owns are read, each one by its shape, so a
 * stored state of any version, or a malformed one, hydrates into valid preferences.
 */
export function migrateShoppingListState(persistedState: unknown): PersistedShoppingListState {
  const stored = isRecord(persistedState) ? persistedState : {};

  return {
    chosenUntilDate: readDateKey(stored.chosenUntilDate),
    groupBy: stored.groupBy === 'meal' ? 'meal' : 'ingredient',
  };
}

// Settles once the stored preferences are in the state, or could not be read. A read waits
// for it, so a list asked for while the app starts is never read without them.
let storedPreferences: Promise<void> = Promise.resolve();

// Number of the last read that was asked for. Only its answer may land: a slower answer to
// an earlier read would otherwise overwrite the list of the preferences chosen after it, or
// the list of the user who signed in after it.
let lastReadNumber = 0;

export const useShoppingListStore = create<ShoppingListState>()(
  persist(
    (set, get) => {
      const read = async (ownerId: string | null): Promise<void> => {
        lastReadNumber += 1;
        const readNumber = lastReadNumber;
        const isLastRead = () => readNumber === lastReadNumber && get().ownerId === ownerId;

        // What was read for another user goes first, so it is gone whatever this read comes
        // to. The preferences stay: they are how this device reads the list.
        if (get().ownerId !== ownerId) set({ ownerId, list: null, status: 'idle', error: null });
        if (ownerId === null) return;

        set({ status: 'loading', error: null });
        await storedPreferences;
        const { chosenUntilDate, groupBy } = get();

        // A chosen day stops being one the list can reach without this device knowing: only
        // the server knows the Account's today and its plan. The day is then forgotten and
        // the list is read again. That read carries no day, so it cannot come back here.
        const forgetChosenDateAndReadAgain = () => {
          set({ chosenUntilDate: undefined });
          return read(ownerId);
        };

        try {
          const list = await getShoppingList({ untilDate: chosenUntilDate, groupBy });
          if (!isLastRead()) return;

          // The day lost its meals: the read is limited to a day the list no longer offers,
          // so it would leave out meals the pill says it reaches.
          if (chosenUntilDate !== undefined && !list.plannedDates.includes(chosenUntilDate)) {
            return forgetChosenDateAndReadAgain();
          }

          set({ list, status: 'ready', error: null });
        } catch (error) {
          if (!isLastRead()) return;

          // The day is before the Account's today: the server rejects the read.
          if (
            chosenUntilDate !== undefined &&
            isApiError(error) &&
            error.code === 'validation_error'
          ) {
            return forgetChosenDateAndReadAgain();
          }

          // The list of the last read that landed stays: it is still the best one known.
          set({ status: 'error', error });
        }
      };

      return {
        ownerId: null,
        list: null,
        status: 'idle',
        error: null,
        chosenUntilDate: undefined,
        groupBy: 'ingredient',
        refresh: read,
        setChosenUntilDate: (chosenUntilDate) => {
          set({ chosenUntilDate });
          return read(get().ownerId);
        },
        setGroupBy: (groupBy) => {
          set({ groupBy });
          return read(get().ownerId);
        },
      };
    },
    {
      name: 'shopping-list-storage',
      version: 3,
      storage: createJSONStorage(() => safeAsyncStorage),
      // Runs when the stored version is another one.
      migrate: migrateShoppingListState,
      // Only how the user reads the list is stored. The list itself is the server's, and a
      // stored copy, or the user it was read for, would outlive the session it was read in.
      partialize: ({ chosenUntilDate, groupBy }): PersistedShoppingListState => ({
        chosenUntilDate,
        groupBy,
      }),
      onRehydrateStorage: () => {
        let settle: () => void = () => {};
        storedPreferences = new Promise((resolve) => {
          settle = resolve;
        });

        // Called when the storage was read, and when reading it failed.
        return () => settle();
      },
    }
  )
);
