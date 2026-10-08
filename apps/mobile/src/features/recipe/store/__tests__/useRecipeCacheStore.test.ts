import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '@/api/errors';
import { getRecipe } from '../../api/recipeApi';
import recipeDetail from '../../fixtures/recipeDetail.json';
import type { Recipe } from '../../types/recipe';
import { useRecipeCacheStore } from '../useRecipeCacheStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../../api/recipeApi', () => ({ getRecipe: jest.fn() }));

const STORAGE_KEY = 'recipe-cache-storage';

// The frozen payload is checked against `Recipe` field by field in the recipeApi test.
const RECIPE = recipeDetail.data as Recipe;

const EMPTY_CACHE = { recipesByVersionId: {}, versionIdByRecipeId: {} };

const getRecipeMock = jest.mocked(getRecipe);

function cache() {
  return useRecipeCacheStore.getState();
}

beforeEach(() => {
  getRecipeMock.mockReset();
  useRecipeCacheStore.setState(EMPTY_CACHE);
});

describe('loadRecipe', () => {
  it('fetches a recipe once and serves it from the cache afterwards', async () => {
    getRecipeMock.mockResolvedValue(RECIPE);
    expect(cache().getCachedRecipe(RECIPE.id)).toBeUndefined();

    const first = await cache().loadRecipe(RECIPE.id);
    const second = await cache().loadRecipe(RECIPE.id);

    expect(getRecipeMock).toHaveBeenCalledTimes(1);
    expect(getRecipeMock).toHaveBeenCalledWith(RECIPE.id);
    expect(first).toEqual(RECIPE);
    expect(second).toEqual(RECIPE);
    expect(cache().getCachedRecipe(RECIPE.id)).toEqual(RECIPE);
  });

  it('does not fetch a known version that is cached, even under a recipe id it never saw', async () => {
    useRecipeCacheStore.setState({
      recipesByVersionId: { [RECIPE.recipeVersionId]: RECIPE },
      versionIdByRecipeId: {},
    });
    const known = { recipeVersionId: RECIPE.recipeVersionId };

    const loaded = await cache().loadRecipe(RECIPE.id, known);

    expect(getRecipeMock).not.toHaveBeenCalled();
    expect(loaded).toEqual(RECIPE);
    expect(cache().getCachedRecipe(RECIPE.id, known)).toEqual(RECIPE);
  });

  it('ignores a known version that belongs to another recipe', async () => {
    useRecipeCacheStore.setState({
      recipesByVersionId: { [RECIPE.recipeVersionId]: RECIPE },
      versionIdByRecipeId: {},
    });
    const known = { recipeVersionId: RECIPE.recipeVersionId };
    const other: Recipe = { ...RECIPE, id: 'another-recipe', recipeVersionId: 'another-version' };
    getRecipeMock.mockResolvedValue(other);

    expect(cache().getCachedRecipe(other.id, known)).toBeUndefined();

    const loaded = await cache().loadRecipe(other.id, known);

    expect(getRecipeMock).toHaveBeenCalledWith(other.id);
    expect(loaded).toEqual(other);
  });

  it('fetches when the known version is not cached', async () => {
    getRecipeMock.mockResolvedValue(RECIPE);

    await cache().loadRecipe(RECIPE.id, { recipeVersionId: RECIPE.recipeVersionId });

    expect(getRecipeMock).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent loads of the same recipe', async () => {
    let resolveRequest: (recipe: Recipe) => void = () => {};
    getRecipeMock.mockReturnValue(
      new Promise<Recipe>((resolve) => {
        resolveRequest = resolve;
      })
    );

    const loads = [cache().loadRecipe(RECIPE.id), cache().loadRecipe(RECIPE.id)];
    resolveRequest(RECIPE);

    await expect(Promise.all(loads)).resolves.toEqual([RECIPE, RECIPE]);
    expect(getRecipeMock).toHaveBeenCalledTimes(1);
  });

  it('caches nothing when the load fails, and the next load fetches again', async () => {
    const failure = new ApiError('network_error', 'Network request failed');
    getRecipeMock.mockRejectedValueOnce(failure).mockResolvedValueOnce(RECIPE);

    await expect(cache().loadRecipe(RECIPE.id)).rejects.toBe(failure);
    expect(cache().getCachedRecipe(RECIPE.id)).toBeUndefined();
    expect(cache().recipesByVersionId).toEqual({});

    await expect(cache().loadRecipe(RECIPE.id)).resolves.toEqual(RECIPE);
    expect(getRecipeMock).toHaveBeenCalledTimes(2);
  });
});

describe('clear', () => {
  it('drops every cached recipe', async () => {
    getRecipeMock.mockResolvedValue(RECIPE);
    await cache().loadRecipe(RECIPE.id);

    cache().clear();

    expect(cache().getCachedRecipe(RECIPE.id)).toBeUndefined();
    await cache().loadRecipe(RECIPE.id);
    expect(getRecipeMock).toHaveBeenCalledTimes(2);
  });
});

describe('persistence', () => {
  it('stores the recipes and the index, and serves them after a restart without a request', async () => {
    getRecipeMock.mockResolvedValue(RECIPE);
    await cache().loadRecipe(RECIPE.id);

    const stored = (await AsyncStorage.getItem(STORAGE_KEY)) ?? '';
    expect(JSON.parse(stored).state).toEqual({
      recipesByVersionId: { [RECIPE.recipeVersionId]: RECIPE },
      versionIdByRecipeId: { [RECIPE.id]: RECIPE.recipeVersionId },
    });

    // A restart: the memory is empty and the storage still holds what was written.
    useRecipeCacheStore.setState(EMPTY_CACHE);
    await AsyncStorage.setItem(STORAGE_KEY, stored);
    await useRecipeCacheStore.persist.rehydrate();

    await expect(cache().loadRecipe(RECIPE.id)).resolves.toEqual(RECIPE);
    expect(getRecipeMock).toHaveBeenCalledTimes(1);
  });
});
