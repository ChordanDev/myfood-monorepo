import { ApiError } from '@/api/errors';
import { addFavorite, listFavorites, removeFavorite } from '../../api/favoritesApi';
import { fixtureFavorites } from '../../fixtures/favorites';
import type { FavoriteSummary } from '../../types/favorites';
import { useFavoritesStore } from '../useFavoritesStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../../api/favoritesApi', () => ({
  listFavorites: jest.fn(),
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
}));

const listMock = jest.mocked(listFavorites);
const addMock = jest.mocked(addFavorite);
const removeMock = jest.mocked(removeFavorite);

const [TORTILLA, LENTEJAS] = fixtureFavorites();

function store() {
  return useFavoritesStore.getState();
}

function ids() {
  return store().favorites.map((favorite) => favorite.recipeId);
}

// A request the test answers when it chooses to.
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const refused = () => new ApiError('recipe_not_found', 'nope', 404);

beforeEach(() => {
  listMock.mockReset();
  addMock.mockReset();
  removeMock.mockReset();
  store().clear();
});

describe('load', () => {
  it('replaces the favorites with the server list, ordered by name', async () => {
    listMock.mockResolvedValue([TORTILLA, LENTEJAS]);

    await store().load();

    expect(store().favorites.map((f) => f.name)).toEqual([
      'Ensalada de lentejas',
      'Tortilla de papas',
    ]);
    expect(store().isFavorite(TORTILLA.recipeId)).toBe(true);
    expect(store().isFavorite('other')).toBe(false);
  });

  it('keeps the cached favorites when the load fails', async () => {
    listMock.mockResolvedValueOnce([TORTILLA]);
    await store().load();
    listMock.mockRejectedValueOnce(new ApiError('network_error', 'offline'));

    await expect(store().load()).rejects.toMatchObject({ code: 'network_error' });

    expect(ids()).toEqual([TORTILLA.recipeId]);
  });

  it('shares one request between concurrent loads', async () => {
    const request = deferred<FavoriteSummary[]>();
    listMock.mockReturnValue(request.promise);

    const first = store().load();
    const second = store().load();
    request.resolve([TORTILLA]);
    await Promise.all([first, second]);

    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('does not write a list that arrives after clear()', async () => {
    const request = deferred<FavoriteSummary[]>();
    listMock.mockReturnValue(request.promise);

    const load = store().load();
    store().clear();
    request.resolve([TORTILLA]);
    await load;

    expect(store().favorites).toEqual([]);
  });

  it('does not drop an optimistic change made while the list was in flight', async () => {
    const list = deferred<FavoriteSummary[]>();
    const add = deferred<FavoriteSummary>();
    listMock.mockReturnValue(list.promise);
    addMock.mockReturnValue(add.promise);

    const load = store().load();
    const toggle = store().toggle(LENTEJAS);
    list.resolve([TORTILLA]);
    await load;

    expect(ids().sort()).toEqual([LENTEJAS.recipeId, TORTILLA.recipeId].sort());

    add.resolve(LENTEJAS);
    await toggle;
  });
});

describe('toggle', () => {
  it('shows the favorite immediately and keeps it once the server confirms', async () => {
    const request = deferred<FavoriteSummary>();
    addMock.mockReturnValue(request.promise);

    const toggle = store().toggle(TORTILLA);

    expect(store().isFavorite(TORTILLA.recipeId)).toBe(true);
    expect(addMock).toHaveBeenCalledWith(TORTILLA.recipeId);

    request.resolve({ ...TORTILLA, name: 'Tortilla (server)' });
    await expect(toggle).resolves.toBe(true);

    expect(store().favorites).toEqual([{ ...TORTILLA, name: 'Tortilla (server)' }]);
  });

  it('reverts an add the server refuses', async () => {
    const request = deferred<FavoriteSummary>();
    addMock.mockReturnValue(request.promise);

    const toggle = store().toggle(TORTILLA);
    expect(store().isFavorite(TORTILLA.recipeId)).toBe(true);
    request.reject(refused());

    await expect(toggle).resolves.toBe(false);
    expect(store().isFavorite(TORTILLA.recipeId)).toBe(false);
  });

  it('reverts an add that fails on the network', async () => {
    addMock.mockRejectedValue(new ApiError('network_error', 'offline'));

    await expect(store().toggle(TORTILLA)).resolves.toBe(false);

    expect(store().favorites).toEqual([]);
  });

  it('removes immediately and keeps it removed once the server confirms', async () => {
    listMock.mockResolvedValue([TORTILLA, LENTEJAS]);
    await store().load();
    const request = deferred<void>();
    removeMock.mockReturnValue(request.promise);

    const toggle = store().toggle(TORTILLA);

    expect(store().isFavorite(TORTILLA.recipeId)).toBe(false);
    expect(removeMock).toHaveBeenCalledWith(TORTILLA.recipeId);

    request.resolve();
    await expect(toggle).resolves.toBe(true);
    expect(ids()).toEqual([LENTEJAS.recipeId]);
  });

  it('puts a refused remove back, in name order', async () => {
    listMock.mockResolvedValue([TORTILLA, LENTEJAS]);
    await store().load();
    removeMock.mockRejectedValue(new ApiError('network_error', 'offline'));

    await expect(store().toggle(LENTEJAS)).resolves.toBe(false);

    expect(ids()).toEqual([LENTEJAS.recipeId, TORTILLA.recipeId]);
  });

  it('is idempotent when the server already had the favorite', async () => {
    listMock.mockResolvedValue([TORTILLA]);
    await store().load();
    removeMock.mockResolvedValue(undefined);
    addMock.mockResolvedValue(TORTILLA);

    await store().toggle(TORTILLA); // remove
    await store().toggle(TORTILLA); // add
    await store().toggle(TORTILLA); // remove again

    expect(store().favorites).toEqual([]);
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledTimes(2);
  });

  it('serializes two quick toggles of one recipe and lands on the last intent', async () => {
    const add = deferred<FavoriteSummary>();
    addMock.mockReturnValue(add.promise);
    removeMock.mockResolvedValue(undefined);

    const first = store().toggle(TORTILLA); // add
    const second = store().toggle(TORTILLA); // remove, while the add is in flight

    expect(store().isFavorite(TORTILLA.recipeId)).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();

    add.resolve(TORTILLA);
    await Promise.all([first, second]);

    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(store().isFavorite(TORTILLA.recipeId)).toBe(false);
  });

  it('reverts to the last confirmed state when a queued toggle fails after an earlier one failed', async () => {
    addMock.mockRejectedValue(refused());
    removeMock.mockRejectedValue(refused());

    const first = store().toggle(TORTILLA); // add
    const second = store().toggle(TORTILLA); // remove
    await Promise.all([first, second]);

    // Nothing was ever confirmed, so the recipe is not a favorite.
    expect(store().isFavorite(TORTILLA.recipeId)).toBe(false);
  });

  it('keeps the later intent when only the earlier toggle fails', async () => {
    const add = deferred<FavoriteSummary>();
    addMock.mockReturnValueOnce(add.promise).mockResolvedValueOnce(TORTILLA);
    removeMock.mockResolvedValue(undefined);

    const first = store().toggle(TORTILLA); // add (fails)
    const second = store().toggle(TORTILLA); // remove
    const third = store().toggle(TORTILLA); // add again

    add.reject(refused());
    await Promise.all([first, second, third]);

    expect(store().isFavorite(TORTILLA.recipeId)).toBe(true);
  });

  it('does not touch the cleared store when a response arrives after clear()', async () => {
    const add = deferred<FavoriteSummary>();
    addMock.mockReturnValue(add.promise);

    const toggle = store().toggle(TORTILLA);
    store().clear();
    add.resolve(TORTILLA);
    await toggle;

    expect(store().favorites).toEqual([]);
  });

  it('does not restore a reverted favorite into a store cleared meanwhile', async () => {
    listMock.mockResolvedValue([TORTILLA]);
    await store().load();
    const remove = deferred<void>();
    removeMock.mockReturnValue(remove.promise);

    const toggle = store().toggle(TORTILLA);
    store().clear();
    remove.reject(refused());
    await expect(toggle).resolves.toBe(false);

    expect(store().favorites).toEqual([]);
  });
});
