/// <reference types="node" />
import { ApiError } from '@/api/errors';
import {
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_VALIDATION_ERROR,
  toShoppingListResponse,
} from '../fixtures';
import { getShoppingList } from './shoppingApi';

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

describe('getShoppingList', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  // The URL of the only request the test made.
  function requestedUrl() {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return fetchMock.mock.calls[0][0];
  }

  beforeEach(() => {
    mockSecureStore.clear();
    mockSecureStore.set('auth_access_token', 'access-1');
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  describe('the request', () => {
    beforeEach(() => {
      fetchMock.mockReturnValue(mockJsonResponse(toShoppingListResponse(SHOPPING_LIST_BY_MEAL)));
    });

    it('asks for the whole list, grouped as the server defaults, without params', async () => {
      await getShoppingList();

      expect(requestedUrl()).toBe('https://api.example.test/api/shopping-list');
    });

    it('sends no param for a filter that is not set', async () => {
      await getShoppingList({ untilDate: undefined, groupBy: undefined });

      expect(requestedUrl()).toBe('https://api.example.test/api/shopping-list');
    });

    it('limits the list to a date', async () => {
      await getShoppingList({ untilDate: '2026-10-10' });

      expect(requestedUrl()).toBe(
        'https://api.example.test/api/shopping-list?untilDate=2026-10-10'
      );
    });

    it.each(['ingredient', 'meal'] as const)(
      'asks for the lines grouped by %s',
      async (groupBy) => {
        await getShoppingList({ groupBy });

        expect(requestedUrl()).toBe(
          `https://api.example.test/api/shopping-list?groupBy=${groupBy}`
        );
      }
    );

    it('sends both filters together', async () => {
      await getShoppingList({ untilDate: '2026-10-10', groupBy: 'meal' });

      expect(requestedUrl()).toBe(
        'https://api.example.test/api/shopping-list?untilDate=2026-10-10&groupBy=meal'
      );
    });

    it('is an authenticated GET with the stored access token', async () => {
      await getShoppingList();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.test/api/shopping-list',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/json',
            Authorization: 'Bearer access-1',
          }),
        })
      );
    });
  });

  describe('the answer', () => {
    it.each([
      ['grouped by ingredient', SHOPPING_LIST_BY_INGREDIENT],
      ['grouped by meal', SHOPPING_LIST_BY_MEAL],
      ['limited to a date', SHOPPING_LIST_UNTIL_OCT_10],
    ])('is the read %s, out of its `data` wrapper', async (_name, read) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(toShoppingListResponse(read)));

      await expect(getShoppingList()).resolves.toEqual(read);
    });

    it.each([
      ['an empty body', null],
      ['a body without `data`', SHOPPING_LIST_BY_INGREDIENT],
      ['a `data` that is not an object', { data: [] }],
      ['no planned lines', { data: { ...SHOPPING_LIST_BY_INGREDIENT, planned: undefined } }],
      ['no manual lines', { data: { ...SHOPPING_LIST_BY_INGREDIENT, manual: undefined } }],
      ['no cart member', { data: { ...SHOPPING_LIST_BY_INGREDIENT, cart: undefined } }],
      ['no totals', { data: { ...SHOPPING_LIST_BY_INGREDIENT, totals: undefined } }],
      [
        'planned dates that are not a list',
        { data: { ...SHOPPING_LIST_BY_INGREDIENT, plannedDates: {} } },
      ],
    ])('is rejected as unintelligible with %s', async (_name, body) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(body));

      await expect(getShoppingList()).rejects.toMatchObject({
        code: 'unknown_error',
        message: 'Malformed shopping list response',
      });
    });

    it('accepts a read without a Cart', async () => {
      const read = { ...SHOPPING_LIST_BY_INGREDIENT, cart: null };
      fetchMock.mockReturnValueOnce(mockJsonResponse(toShoppingListResponse(read)));

      await expect(getShoppingList()).resolves.toEqual(read);
    });
  });

  describe('a failure', () => {
    it('surfaces a rejected filter as a validation error', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(SHOPPING_LIST_VALIDATION_ERROR, false, 422));

      const error = await getShoppingList({ untilDate: '2026-10-01' }).catch((caught) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'validation_error', status: 422 });
    });

    it('asks once more when the network fails, as every read of the app does', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('Network request failed'))
        .mockReturnValueOnce(mockJsonResponse(toShoppingListResponse(SHOPPING_LIST_BY_INGREDIENT)));

      await expect(getShoppingList()).resolves.toEqual(SHOPPING_LIST_BY_INGREDIENT);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not ask again when the caller turns the retry off', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

      await expect(getShoppingList({}, { retry: false })).rejects.toMatchObject({
        code: 'network_error',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
