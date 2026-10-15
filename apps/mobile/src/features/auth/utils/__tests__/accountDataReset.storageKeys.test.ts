import { useInventoryStore } from '@/features/inventory/store';
import { useMealPlanStore } from '@/store/useMealPlanStore';
import { ACCOUNT_DATA_STORAGE_KEYS } from '../accountDataReset';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// The reset removes stored entries by key without loading the stores, so a store that renames
// its key must rename it there too.
it('removes the keys the Account data stores persist under', () => {
  expect([...ACCOUNT_DATA_STORAGE_KEYS].sort()).toEqual(
    [useInventoryStore.persist.getOptions().name, useMealPlanStore.persist.getOptions().name].sort()
  );
});
