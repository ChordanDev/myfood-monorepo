import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import { MOCK_MASTER_RECIPES } from '@/mocks/domainMocks';
import { useInventoryStore } from '@/features/inventory/store';
import { buildInventoryItem } from '@/features/inventory/mocks';
import { useMealPlanStore } from './useMealPlanStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('favorite recipes', () => {
  beforeEach(() => {
    useMealPlanStore.setState({ favoriteRecipeIds: [] });
  });

  it('marks a recipe as favorite', () => {
    useMealPlanStore.getState().toggleFavoriteRecipe('recipe-1');

    expect(useMealPlanStore.getState().favoriteRecipeIds).toEqual(['recipe-1']);
  });

  it('removes a recipe that was already favorite', () => {
    useMealPlanStore.getState().toggleFavoriteRecipe('recipe-1');
    useMealPlanStore.getState().toggleFavoriteRecipe('recipe-1');

    expect(useMealPlanStore.getState().favoriteRecipeIds).toEqual([]);
  });

  it('keeps the other favorites when one is removed', () => {
    useMealPlanStore.getState().toggleFavoriteRecipe('recipe-1');
    useMealPlanStore.getState().toggleFavoriteRecipe('recipe-2');
    useMealPlanStore.getState().toggleFavoriteRecipe('recipe-1');

    expect(useMealPlanStore.getState().favoriteRecipeIds).toEqual(['recipe-2']);
  });
});

describe('marking a meal as cooked', () => {
  const recipe = MOCK_MASTER_RECIPES[0];
  const entry: MealPlanEntry = {
    id: 'entry-1',
    date: '2026-08-25',
    type: 'lunch',
    recipeId: recipe.id,
    isCooked: false,
  };
  // The inventory counts in thousandths of the unit; the recipe amounts are display units.
  const rice = buildInventoryItem({
    id: 'inv-i1',
    ingredientId: 'i1',
    name: 'Rice',
    quantityMilli: 500_000,
    unit: 'g',
  });
  const oil = buildInventoryItem({
    id: 'inv-i5',
    ingredientId: 'i5',
    name: 'Olive oil',
    quantityMilli: 4_000,
    unit: 'ml',
  });

  beforeEach(() => {
    useMealPlanStore.setState({ entries: [entry], recipes: [recipe] });
    useInventoryStore.setState({ items: [rice, oil] });
  });

  it('consumes the recipe ingredients from the inventory without going below zero', () => {
    useMealPlanStore.getState().markAsCooked('entry-1');

    // The oil ran out, so its lot left the inventory.
    expect(useInventoryStore.getState().items).toEqual([{ ...rice, quantityMilli: 400_000 }]);
    expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
  });

  it('does not consume the ingredients twice', () => {
    useMealPlanStore.getState().markAsCooked('entry-1');
    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(useInventoryStore.getState().items[0].quantityMilli).toBe(400_000);
  });
});

describe('meal confirmation', () => {
  const recipe: MasterRecipe = {
    ...MOCK_MASTER_RECIPES[0],
    id: 'recipe-1',
    ingredients: [{ ingredientId: 'rice', amount: 100 }],
  };
  const rice = buildInventoryItem({
    id: 'inv-rice',
    ingredientId: 'rice',
    name: 'Rice',
    quantityMilli: 500_000,
    unit: 'g',
  });
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
    expect(getInventory()).toEqual([{ ...rice, quantityMilli: 400_000 }]);
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

  it('loads the fixture plan and keeps the favorites when it was stored before the API meal slot codes', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    useMealPlanStore.setState({ entries: [], favoriteRecipeIds: [] });
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          entries: [{ ...storedEntry, type: 'legacy-slot' }],
          favoriteRecipeIds: ['recipe-1', 'recipe-2'],
        },
      })
    );

    await useMealPlanStore.persist.rehydrate();

    expect(useMealPlanStore.getState().entries).toEqual(fixtures);
    expect(useMealPlanStore.getState().favoriteRecipeIds).toEqual(['recipe-1', 'recipe-2']);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
