import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import { MOCK_MASTER_RECIPES } from '@/mocks/domainMocks';
import { useInventoryStore } from './useInventoryStore';
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

describe('meal confirmation', () => {
  const recipe: MasterRecipe = {
    ...MOCK_MASTER_RECIPES[0],
    id: 'recipe-1',
    ingredients: [{ ingredientId: 'rice', amount: 100 }],
  };
  const initialInventory = [{ ingredientId: 'rice', amount: 500 }];

  function seedEntry(overrides: Partial<MealPlanEntry> = {}) {
    const entry: MealPlanEntry = {
      id: 'entry-1',
      date: '2026-08-24',
      type: 'cena',
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
    expect(getInventory()).toEqual([{ ingredientId: 'rice', amount: 400 }]);
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
