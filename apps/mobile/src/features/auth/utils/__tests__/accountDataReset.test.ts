import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerAccountDataReset, resetAccountData } from '../accountDataReset';

// No store is imported here: the stored data of a store that never loaded in this session is
// dropped all the same, so it cannot load later for the next Account.
describe('resetAccountData', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('removes the stored Inventory lots and meal plan of stores that never loaded', async () => {
    await AsyncStorage.setItem('inventory-storage', '{"state":{"items":[{"id":"lot-1"}]}}');
    await AsyncStorage.setItem('meal-plan-storage', '{"state":{"entries":[{"id":"entry-1"}]}}');

    await resetAccountData();

    expect(await AsyncStorage.getItem('inventory-storage')).toBeNull();
    expect(await AsyncStorage.getItem('meal-plan-storage')).toBeNull();
  });

  it('removes the stored Recipe cache of a store that never loaded', async () => {
    await AsyncStorage.setItem(
      'recipe-cache-storage',
      '{"state":{"recipesByVersionId":{"version-1":{"id":"recipe-1"}},"versionIdByRecipeId":{"recipe-1":"version-1"}}}'
    );

    await resetAccountData();

    expect(await AsyncStorage.getItem('recipe-cache-storage')).toBeNull();
  });

  it('keeps the stored Shopping preferences: the list is never stored and the day is kept with its user', async () => {
    const shopping = '{"state":{"groupBy":"meal"},"version":4}';
    await AsyncStorage.setItem('shopping-list-storage', shopping);

    await resetAccountData();

    expect(await AsyncStorage.getItem('shopping-list-storage')).toBe(shopping);
  });

  it('runs the reset of every store that registered', async () => {
    const reset = jest.fn();
    registerAccountDataReset(reset);

    await resetAccountData();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
