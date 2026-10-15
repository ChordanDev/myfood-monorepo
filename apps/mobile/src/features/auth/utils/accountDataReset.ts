import { safeAsyncStorage } from '@/utils/safeAsyncStorage';

/**
 * Stores that cache the signed-in account's data register a reset here, and the auth provider
 * runs them when the session ends or another account signs in. The registry keeps the auth
 * provider free of imports from those stores.
 */
const resetters = new Set<() => void>();

/**
 * Storage keys of the persisted stores that hold the signed-in account's data. A store
 * registers its reset only once it is loaded, so the reset also removes these entries: the data
 * of a store not loaded yet in this session can never load later for the next account. The
 * shopping store is not here: its list is never stored, and the day it stores is kept with the
 * user who chose it and never used for anyone else.
 */
export const ACCOUNT_DATA_STORAGE_KEYS: readonly string[] = [
  'inventory-storage',
  'meal-plan-storage',
];

export function registerAccountDataReset(reset: () => void): void {
  resetters.add(reset);
}

// The loaded stores are emptied at once; the stored entries are gone once it settles.
export async function resetAccountData(): Promise<void> {
  resetters.forEach((reset) => reset());

  await Promise.all(ACCOUNT_DATA_STORAGE_KEYS.map((key) => safeAsyncStorage.removeItem(key)));
}
