import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import { MOCK_MASTER_RECIPES } from '@/mocks/domainMocks';
import { useInventoryStore } from '@/features/inventory/store';
import type { InventoryItem } from '@/features/inventory';
import { useMealPlanStore } from './useMealPlanStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('marking a meal as cooked', () => {
  const recipe = MOCK_MASTER_RECIPES[0];
  const entry: MealPlanEntry = {
    id: 'entry-1',
    date: '2026-08-25',
    type: 'lunch',
    recipeId: recipe.id,
    isCooked: false,
  };
  const rice: InventoryItem = {
    id: 'inv-i1',
    ingredientId: 'i1',
    name: 'Rice',
    category: 'almacen',
    quantity: 500,
    unit: 'g',
    confidence: 'estimated',
  };
  const oil: InventoryItem = {
    id: 'inv-i5',
    ingredientId: 'i5',
    name: 'Olive oil',
    category: 'almacen',
    quantity: 4,
    unit: 'ml',
    confidence: 'estimated',
  };

  beforeEach(() => {
    useMealPlanStore.setState({ entries: [entry], recipes: [recipe] });
    useInventoryStore.setState({ items: [rice, oil] });
  });

  it('consumes the recipe ingredients from the inventory without going below zero', () => {
    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(useInventoryStore.getState().items).toEqual([
      { ...rice, quantity: 400 },
      { ...oil, quantity: 0 },
    ]);
    expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
  });

  it('does not consume the ingredients twice', () => {
    useMealPlanStore.getState().markAsCooked('entry-1');
    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(useInventoryStore.getState().items[0].quantity).toBe(400);
  });
});

describe('meal confirmation', () => {
  const recipe: MasterRecipe = {
    ...MOCK_MASTER_RECIPES[0],
    id: 'recipe-1',
    ingredients: [{ ingredientId: 'rice', amount: 100 }],
  };
  const rice: InventoryItem = {
    id: 'inv-rice',
    ingredientId: 'rice',
    name: 'Rice',
    category: 'almacen',
    quantity: 500,
    unit: 'g',
    confidence: 'estimated',
  };
  const initialInventory = [rice];

  function seedEntry(overrides: Partial<MealPlanEntry> = {}) {
    const entry: MealPlanEntry = {
      id: 'entry-1',
      date: '2026-08-24',
      type: 'dinner',
      recipeId: recipe.id,
      isCooked: false,
      ...overrides,
    };

    useMealPlanStore.setState({ entries: [entry], recipes: [recipe] });
  }

  function getEntry() {
    return useMealPlanStore.getState().entries[0];
  }

  function getInventory() {
    return useInventoryStore.getState().items;
  }

  beforeEach(() => {
    useInventoryStore.setState({ items: initialInventory });
  });

  it('marks an entry as cooked and consumes the recipe ingredients', () => {
    seedEntry();

    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(getEntry().isCooked).toBe(true);
    expect(getInventory()).toEqual([{ ...rice, quantity: 400 }]);
  });

  it('marks an entry as skipped and leaves the inventory untouched', () => {
    seedEntry();

    useMealPlanStore.getState().markAsSkipped('entry-1');

    expect(getEntry()).toMatchObject({ isSkipped: true, isCooked: false });
    expect(getInventory()).toEqual(initialInventory);
  });

  it('does not skip an entry that is already cooked', () => {
    seedEntry({ isCooked: true });

    useMealPlanStore.getState().markAsSkipped('entry-1');

    expect(getEntry().isSkipped).toBeUndefined();
    expect(getEntry().isCooked).toBe(true);
  });

  it('ignores a skip for an entry that does not exist', () => {
    seedEntry();
    const entriesBefore = useMealPlanStore.getState().entries;

    useMealPlanStore.getState().markAsSkipped('missing-entry');

    expect(useMealPlanStore.getState().entries).toBe(entriesBefore);
  });

  it('does not cook an entry that was skipped, and leaves the inventory untouched', () => {
    seedEntry({ isSkipped: true });

    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(getEntry()).toMatchObject({ isSkipped: true, isCooked: false });
    expect(getInventory()).toEqual(initialInventory);
  });
});

describe('a plan stored on the device', () => {
  const STORAGE_KEY = 'meal-plan-storage';
  const fixtures = useMealPlanStore.getInitialState().entries;
  const storedEntry: MealPlanEntry = {
    id: 'stored-1',
    date: '2026-08-25',
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
  };

  beforeEach(() => {
    useMealPlanStore.setState({ entries: fixtures });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await AsyncStorage.clear();
  });

  it('comes back when it was stored with the current version', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, state: { entries: [storedEntry] } })
    );

    await useMealPlanStore.persist.rehydrate();

    expect(useMealPlanStore.getState().entries).toEqual([storedEntry]);
  });

  it('loads the fixture plan and keeps the rest of the stored state when it was stored before the API meal slot codes', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    useMealPlanStore.setState({ entries: [] });
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          entries: [{ ...storedEntry, type: 'legacy-slot' }],
          customKey: 'kept',
        },
      })
    );

    await useMealPlanStore.persist.rehydrate();

    expect(useMealPlanStore.getState().entries).toEqual(fixtures);
    expect(useMealPlanStore.getState()).toMatchObject({ customKey: 'kept' });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
