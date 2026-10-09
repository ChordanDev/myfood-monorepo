/// <reference types="node" />
import { ApiError } from '@/api/errors';
import {
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_VALIDATION_ERROR,
  toShoppingListResponse,
} from '../fixtures';
import { cancelCart, getShoppingList, markInCart, renewCart } from './shoppingApi';

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

describe('the Cart lease', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  const MARKED = {
    sessionId: 'session-1',
    leaseExpiresAt: '2026-10-09T12:15:00Z',
    items: [{ itemId: 'item-1', reservationToken: 'token-1', quantityMilli: 200000 }],
  };

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

  describe('markInCart', () => {
    it('posts the item ids, authenticated, and returns the Cart out of its `data` wrapper', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: MARKED }));

      await expect(markInCart(['item-1', 'item-2'])).resolves.toEqual(MARKED);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.example.test/api/shopping-items/mark-cart');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ itemIds: ['item-1', 'item-2'] });
      expect(init.headers.Authorization ?? init.headers.get?.('Authorization')).toBe(
        'Bearer access-1'
      );
    });

    it.each([
      ['an empty body', null],
      ['a body without `data`', MARKED],
      ['no session id', { data: { ...MARKED, sessionId: undefined } }],
      ['no lease', { data: { ...MARKED, leaseExpiresAt: undefined } }],
      ['items that are not a list', { data: { ...MARKED, items: {} } }],
    ])('rejects %s as unintelligible', async (_name, body) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(body));

      await expect(markInCart(['item-1'])).rejects.toMatchObject({
        code: 'unknown_error',
        message: 'Malformed cart response',
      });
    });

    it('surfaces a Cart held by another Membership as `cart_locked`', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({ error: { code: 'cart_locked', message: 'held' } }, false, 409)
      );

      const error = await markInCart(['item-1']).catch((caught) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'cart_locked', status: 409 });
    });
  });

  describe('renewCart', () => {
    it('posts the activity of the session and returns the new lease', async () => {
      const lease = { sessionId: 'session-1', leaseExpiresAt: '2026-10-09T12:30:00Z' };
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: lease }));

      await expect(renewCart('session-1')).resolves.toEqual(lease);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.example.test/api/cart/session-1/activity');
      expect(init.method).toBe('POST');
    });

    it('rejects an answer without a lease as unintelligible', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: { sessionId: 'session-1' } }));

      await expect(renewCart('session-1')).rejects.toMatchObject({ code: 'unknown_error' });
    });

    it('surfaces an expired lease as `stale_cart`', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({ error: { code: 'stale_cart', message: 'expired' } }, false, 409)
      );

      await expect(renewCart('session-1')).rejects.toMatchObject({ code: 'stale_cart' });
    });
  });

  describe('cancelCart', () => {
    it('deletes the session and returns the abandoned Cart', async () => {
      const cancelled = { sessionId: 'session-1', updatedRows: 2, status: 'abandoned' };
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: cancelled }));

      await expect(cancelCart('session-1')).resolves.toEqual(cancelled);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.example.test/api/cart/session-1');
      expect(init.method).toBe('DELETE');
    });

    it('surfaces an unknown session as `cart_not_found`', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({ error: { code: 'cart_not_found', message: 'gone' } }, false, 404)
      );

      await expect(cancelCart('session-1')).rejects.toMatchObject({ code: 'cart_not_found' });
    });
  });
});
