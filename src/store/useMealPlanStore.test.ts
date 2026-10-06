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
