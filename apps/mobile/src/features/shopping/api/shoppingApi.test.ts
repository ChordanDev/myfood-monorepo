/// <reference types="node" />
import { ApiError } from '@/api/errors';
import {
  MANUAL_DISH_SOAP,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_VALIDATION_ERROR,
  TOMATO_ITEM_IDS,
  toDeleteItemResponse,
  toManualItemResponse,
  toSetStatusResponse,
  toShoppingErrorResponse,
  toShoppingListResponse,
} from '../fixtures';
import {
  addManualShoppingItem,
  deleteShoppingItem,
  getShoppingList,
  setShoppingItemsStatus,
} from './shoppingApi';

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

describe('changing the list', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  function lastRequest() {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    return { url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) };
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

  describe('addManualShoppingItem', () => {
    it('posts the item in camelCase, authenticated, and answers the new line', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse(toManualItemResponse(MANUAL_DISH_SOAP), true, 201)
      );

      const line = await addManualShoppingItem({
        name: 'Detergente',
        quantityMilli: 2_000,
        unit: 'unit',
      });

      expect(line).toEqual(MANUAL_DISH_SOAP);
      const { url, init, body } = lastRequest();
      expect(url).toBe('https://api.example.test/api/shopping-items/manual');
      expect(init).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      });
      expect(body).toEqual({ name: 'Detergente', quantityMilli: 2_000, unit: 'unit' });
    });

    it('sends only the name when nothing else is given, so the server reads 1 unit', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse(toManualItemResponse(MANUAL_DISH_SOAP), true, 201)
      );

      await addManualShoppingItem({ name: 'Detergente' });

      expect(lastRequest().body).toEqual({ name: 'Detergente' });
    });

    it('does not ask again when the network fails: an add is not safe to repeat', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

      await expect(addManualShoppingItem({ name: 'Detergente' })).rejects.toMatchObject({
        code: 'network_error',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['an empty body', null],
      ['a body without `data`', MANUAL_DISH_SOAP],
      ['a line without an id', { data: { ...MANUAL_DISH_SOAP, id: undefined } }],
      [
        'a line that is not a manual one',
        { data: { ...MANUAL_DISH_SOAP, source: 'planned_meal' } },
      ],
    ])('rejects %s as unintelligible', async (_name, body) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(body, true, 201));

      await expect(addManualShoppingItem({ name: 'Detergente' })).rejects.toMatchObject({
        code: 'unknown_error',
      });
    });

    it('surfaces a refused field as a validation error', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(SHOPPING_LIST_VALIDATION_ERROR, false, 422));

      await expect(addManualShoppingItem({ name: ' ' })).rejects.toMatchObject({
        code: 'validation_error',
        status: 422,
      });
    });
  });

  describe('deleteShoppingItem', () => {
    it('is an authenticated DELETE of the item, and answers its id', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(toDeleteItemResponse(MANUAL_DISH_SOAP.id)));

      await expect(deleteShoppingItem(MANUAL_DISH_SOAP.id)).resolves.toBe(MANUAL_DISH_SOAP.id);

      const { url, init } = lastRequest();
      expect(url).toBe(`https://api.example.test/api/shopping-items/${MANUAL_DISH_SOAP.id}`);
      expect(init).toMatchObject({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      });
      expect(init.body).toBeUndefined();
    });

    it('escapes the id in the path', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(toDeleteItemResponse('a/b')));

      await deleteShoppingItem('a/b');

      expect(lastRequest().url).toBe('https://api.example.test/api/shopping-items/a%2Fb');
    });

    it.each([
      ['shopping_item_not_manual', 422],
      ['shopping_item_not_found', 404],
    ])('surfaces %s', async (code, status) => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse(toShoppingErrorResponse(code, 'Refused.'), false, status)
      );

      await expect(deleteShoppingItem('x')).rejects.toMatchObject({ code, status });
    });

    it('rejects an answer without the id as unintelligible', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: {} }));

      await expect(deleteShoppingItem('x')).rejects.toMatchObject({ code: 'unknown_error' });
    });
  });

  describe('setShoppingItemsStatus', () => {
    it('posts the ids and the status, and answers the change', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse(toSetStatusResponse('removed', TOMATO_ITEM_IDS))
      );

      const change = await setShoppingItemsStatus(TOMATO_ITEM_IDS, 'removed');

      expect(change).toEqual({ status: 'removed', itemIds: TOMATO_ITEM_IDS, updatedRows: 2 });
      const { url, init, body } = lastRequest();
      expect(url).toBe('https://api.example.test/api/shopping-items/set-status');
      expect(init).toMatchObject({ method: 'POST' });
      expect(body).toEqual({ itemIds: TOMATO_ITEM_IDS, status: 'removed' });
    });

    it('restores with `needed`', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse(toSetStatusResponse('needed', TOMATO_ITEM_IDS))
      );

      await setShoppingItemsStatus(TOMATO_ITEM_IDS, 'needed');

      expect(lastRequest().body).toEqual({ itemIds: TOMATO_ITEM_IDS, status: 'needed' });
    });

    it.each([
      ['shopping_item_in_cart', 409],
      ['shopping_item_not_planned', 422],
      ['shopping_item_not_found', 404],
    ])('surfaces %s', async (code, status) => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse(toShoppingErrorResponse(code, 'Refused.'), false, status)
      );

      await expect(setShoppingItemsStatus(['x'], 'removed')).rejects.toMatchObject({
        code,
        status,
      });
    });

    it.each([
      ['an empty body', null],
      ['no itemIds', { data: { status: 'removed', updatedRows: 1 } }],
      ['no status', { data: { itemIds: ['x'], updatedRows: 1 } }],
    ])('rejects %s as unintelligible', async (_name, body) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(body));

      await expect(setShoppingItemsStatus(['x'], 'removed')).rejects.toMatchObject({
        code: 'unknown_error',
      });
    });
  });
});
