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
  // Id of the user who chose that day, set and cleared with it. A day is a day of their plan:
  // it is stored with them, since the cache belongs to nobody when the app starts, and it is
  // never used to read the list of anyone else.
  chosenUntilDateOwnerId: string | undefined;
  // How the lines are grouped. Unlike the day, it is a preference of the device: it stays
  // when the user changes.
  groupBy: ShoppingGroupBy;
  // Reads the list of the signed-in user with the current preferences, and replaces the
  // cached one with the answer. A list cached for another user is dropped before anything is
  // asked for, and so is a day another user chose. Without a signed-in user (`null`) there
  // is no list and nothing is read.
  refresh: (ownerId: string | null) => Promise<void>;
  // Both keep the preference and read the list of the user of the cache again with it. The
  // day is kept as theirs: without a user of the cache no day is kept.
  setChosenUntilDate: (dateKey: string | undefined) => Promise<void>;
  setGroupBy: (groupBy: ShoppingGroupBy) => Promise<void>;
}

type PersistedShoppingListState = Pick<
  ShoppingListState,
  'chosenUntilDate' | 'chosenUntilDateOwnerId' | 'groupBy'
>;

// No day is chosen, so nobody chose one.
const NO_CHOSEN_DATE = { chosenUntilDate: undefined, chosenUntilDateOwnerId: undefined };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Upgrades what an earlier version stored. Up to version 2 the list lived on the device: the
 * cart, the removed rows and the items added by hand were stored next to a grouping by
 * supermarket. The server owns all of that now. Up to version 3 the chosen day was stored
 * without the user who chose it, so it is dropped: there is nobody to read the list with it
 * for. Only the grouping is kept.
 *
 * Nothing is trusted: only the fields this store owns are read, each one by its shape, so a
 * stored state of any version, or a malformed one, hydrates into valid preferences.
 */
export function migrateShoppingListState(persistedState: unknown): PersistedShoppingListState {
  const stored = isRecord(persistedState) ? persistedState : {};

  return {
    ...NO_CHOSEN_DATE,
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
        // to. The preferences are looked at below, once the stored ones are in the state.
        if (get().ownerId !== ownerId) set({ ownerId, list: null, status: 'idle', error: null });
        if (ownerId === null) return;

        set({ status: 'loading', error: null });
        await storedPreferences;
        // Overtaken while it waited, by a newer read or by a sign-out: nothing is asked for.
        if (!isLastRead()) return;

        // A day another user chose is forgotten before anything is asked for: their plan may
        // have a meal on it too, and the server would then cut this list at a day this user
        // never chose. Whose day it is comes from the state, not from a change of the user
        // of the cache: when the app starts that user is nobody, and the stored day is still
        // the day of whoever chose it.
        if (get().chosenUntilDate !== undefined && get().chosenUntilDateOwnerId !== ownerId) {
          set(NO_CHOSEN_DATE);
        }
        const { chosenUntilDate, groupBy } = get();

        // A chosen day stops being one the list can reach without this device knowing: only
        // the server knows the Account's today and its plan. The day is then forgotten and
        // the list is read again. That read carries no day, so it cannot come back here.
        const forgetChosenDateAndReadAgain = () => {
          set(NO_CHOSEN_DATE);
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
        ...NO_CHOSEN_DATE,
        groupBy: 'ingredient',
        refresh: read,
        setChosenUntilDate: (chosenUntilDate) => {
          const { ownerId } = get();

          set(
            chosenUntilDate === undefined || ownerId === null
              ? NO_CHOSEN_DATE
              : { chosenUntilDate, chosenUntilDateOwnerId: ownerId }
          );
          return read(ownerId);
        },
        setGroupBy: (groupBy) => {
          set({ groupBy });
          return read(get().ownerId);
        },
      };
    },
    {
      name: 'shopping-list-storage',
      version: 4,
      storage: createJSONStorage(() => safeAsyncStorage),
      // Runs when the stored version is another one.
      migrate: migrateShoppingListState,
      // Only how the user reads the list is stored: the day with the user who chose it, and
      // the grouping. The list itself is the server's, and a stored copy, or the user it was
      // read for, would outlive the session it was read in.
      partialize: ({
        chosenUntilDate,
        chosenUntilDateOwnerId,
        groupBy,
      }): PersistedShoppingListState => ({
        chosenUntilDate,
        chosenUntilDateOwnerId,
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
