import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '@/api/errors';
import { getRecipe } from '../../api/recipeApi';
import { fixtureRecipe } from '../../fixtures/recipeDetail';
import type { Recipe } from '../../types/recipe';
import { useRecipeCacheStore } from '../useRecipeCacheStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../../api/recipeApi', () => ({ getRecipe: jest.fn() }));

const STORAGE_KEY = 'recipe-cache-storage';

const RECIPE = fixtureRecipe();

const EMPTY_CACHE = { recipesByVersionId: {}, versionIdByRecipeId: {} };

const getRecipeMock = jest.mocked(getRecipe);

function cache() {
  return useRecipeCacheStore.getState();
}

// A request the test answers when it chooses to.
function pendingRequest() {
  let resolve: (recipe: Recipe) => void = () => {};
  const request = new Promise<Recipe>((resolveRequest) => {
    resolve = resolveRequest;
  });

  return { request, resolve };
}

beforeEach(() => {
  getRecipeMock.mockReset();
  cache().clear();
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

  it('fetches when the known version is not cached', async () => {
    getRecipeMock.mockResolvedValue(RECIPE);

    await cache().loadRecipe(RECIPE.id, { recipeVersionId: RECIPE.recipeVersionId });

    expect(getRecipeMock).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent loads of the same recipe', async () => {
    const { request, resolve } = pendingRequest();
    getRecipeMock.mockReturnValue(request);

    const loads = [cache().loadRecipe(RECIPE.id), cache().loadRecipe(RECIPE.id)];
    resolve(RECIPE);

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

  it('does not let a load that started before it write the recipe back', async () => {
    const { request, resolve } = pendingRequest();
    getRecipeMock.mockReturnValue(request);
    const load = cache().loadRecipe(RECIPE.id);

    cache().clear();
    resolve(RECIPE);

    // The caller that asked still gets its recipe; the cache stays empty.
    await expect(load).resolves.toEqual(RECIPE);
    expect(cache().getCachedRecipe(RECIPE.id)).toBeUndefined();
    expect(cache().recipesByVersionId).toEqual({});
    expect(cache().versionIdByRecipeId).toEqual({});
  });

  it('forgets the loads in flight, so the next load asks again and is the one cached', async () => {
    const stale = pendingRequest();
    getRecipeMock.mockReturnValueOnce(stale.request).mockResolvedValueOnce(RECIPE);
    const staleLoad = cache().loadRecipe(RECIPE.id);

    cache().clear();
    await cache().loadRecipe(RECIPE.id);
    stale.resolve({ ...RECIPE, name: 'Stale answer' });
    await staleLoad;

    expect(getRecipeMock).toHaveBeenCalledTimes(2);
    expect(cache().getCachedRecipe(RECIPE.id)).toEqual(RECIPE);

    // The stale load finishing must not drop the entry of a newer load either.
    const next = pendingRequest();
    getRecipeMock.mockReturnValue(next.request);
    cache().clear();
    const loads = [cache().loadRecipe(RECIPE.id), cache().loadRecipe(RECIPE.id)];
    next.resolve(RECIPE);
    await Promise.all(loads);

    expect(getRecipeMock).toHaveBeenCalledTimes(3);
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
