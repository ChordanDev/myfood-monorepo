import { ACCESS_TOKEN_KEY } from '@/api/authTokenStore';
import { ApiError } from '@/api/errors';
import favoritesFixture from '../../fixtures/favorites.json';
import { fixtureFavorites } from '../../fixtures/favorites';
import { addFavorite, listFavorites, removeFavorite } from '../favoritesApi';

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

function mockJsonResponse(payload: unknown, ok = true, status = ok ? 200 : 422) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

function mockEmptyResponse(status = 204) {
  return Promise.resolve({ ok: true, status, text: () => Promise.resolve('') } as Response);
}

describe('favoritesApi', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const [tortilla] = fixtureFavorites();

  beforeEach(() => {
    mockSecureStore.clear();
    mockSecureStore.set(ACCESS_TOKEN_KEY, 'access-1');
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  describe('listFavorites', () => {
    it('GETs /api/me/favorites with the bearer token and unwraps the list', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(favoritesFixture));

      const result = await listFavorites();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.test/api/me/favorites',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        })
      );
      expect(result).toEqual(fixtureFavorites());
    });

    it.each([
      ['an empty body', null],
      ['a body without data', {}],
      ['a data that is not a list', { data: {} }],
      [
        'an entry without a recipeId',
        { data: [{ name: 'x', mainIngredients: [], durationMinutes: 1 }] },
      ],
      [
        'an entry with a bad duration',
        { data: [{ recipeId: 'a', name: 'x', mainIngredients: [], durationMinutes: '5' }] },
      ],
      [
        'an entry with bad ingredients',
        { data: [{ recipeId: 'a', name: 'x', mainIngredients: [1], durationMinutes: 5 }] },
      ],
    ])('rejects %s as unknown_error', async (_label, body) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(body));

      await expect(listFavorites()).rejects.toMatchObject({ code: 'unknown_error' });
    });
  });

  describe('addFavorite', () => {
    it('POSTs {recipeId} and returns the unwrapped summary', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: tortilla }));

      const result = await addFavorite(tortilla.recipeId);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.test/api/me/favorites',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ recipeId: tortilla.recipeId }),
          headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        })
      );
      expect(result).toEqual(tortilla);
    });

    it('rejects a malformed 2xx body as unknown_error', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: { recipeId: 1 } }));

      await expect(addFavorite(tortilla.recipeId)).rejects.toMatchObject({
        code: 'unknown_error',
      });
    });

    it('surfaces recipe_not_found from the error envelope', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({ error: { code: 'recipe_not_found', message: 'nope' } }, false, 404)
      );

      const error = await addFavorite('missing').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'recipe_not_found', status: 404 });
    });

    it('surfaces validation_error from the error envelope', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({ error: { code: 'validation_error', message: 'bad' } }, false, 422)
      );

      await expect(addFavorite('')).rejects.toMatchObject({
        code: 'validation_error',
        status: 422,
      });
    });
  });

  describe('removeFavorite', () => {
    it('DELETEs /api/me/favorites/:id (URL-encoded) and resolves on a 204 with no body', async () => {
      fetchMock.mockReturnValueOnce(mockEmptyResponse());

      await expect(removeFavorite('a/b c')).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.test/api/me/favorites/a%2Fb%20c',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        })
      );
    });

    it('surfaces network failures as network_error', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));

      await expect(removeFavorite('a')).rejects.toMatchObject({ code: 'network_error' });
    });
  });
});
