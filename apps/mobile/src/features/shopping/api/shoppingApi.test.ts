/// <reference types="node" />
import { ApiError } from '@/api/errors';
import {
  CART_SESSION_ID,
  MANUAL_DISH_SOAP,
  RICE_LINE_ID,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_VALIDATION_ERROR,
  TOMATO_ITEM_IDS,
  toCheckoutResponse,
  toDeleteItemResponse,
  toManualItemResponse,
  toSetStatusResponse,
  toShoppingErrorResponse,
  toShoppingListResponse,
} from '../fixtures';
import {
  addManualShoppingItem,
  cancelCart,
  confirmCheckout,
  deleteShoppingItem,
  getShoppingList,
  markInCart,
  renewCart,
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

// The read per ingredient with other `lines` on its Cart, valid or not.
function withCartLines(lines: unknown) {
  return {
    ...SHOPPING_LIST_BY_INGREDIENT,
    cart: { ...SHOPPING_LIST_BY_INGREDIENT.cart, lines },
  };
}

// The same read with one line on its Cart: the oil, with these members instead of its own.
function withCartLine(members: Record<string, unknown>) {
  const [oil] = SHOPPING_LIST_BY_INGREDIENT.cart!.lines;

  return withCartLines([{ ...oil, ...members }]);
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
      ['a cart without its lines', { data: withCartLines(undefined) }],
      ['a cart whose lines are not a list', { data: withCartLines({}) }],
      [
        'a cart with only the count of its items',
        {
          data: {
            ...withCartLines(undefined),
            cart: { ...SHOPPING_LIST_BY_INGREDIENT.cart, lines: undefined, itemsCount: 2 },
          },
        },
      ],
      ['a cart line that is not an object', { data: withCartLines(['line']) }],
      ['a cart line without an id', { data: withCartLine({ id: undefined }) }],
      ['a cart line with an empty id', { data: withCartLine({ id: '' }) }],
      ['a cart line whose name is not text', { data: withCartLine({ name: null }) }],
      ['a cart line whose unit is not text', { data: withCartLine({ unit: 3 }) }],
      ['a cart line without a quantity', { data: withCartLine({ quantityMilli: undefined }) }],
      [
        'a cart line whose quantity is not a number',
        { data: withCartLine({ quantityMilli: '2' }) },
      ],
      ['a cart line whose quantity is not whole', { data: withCartLine({ quantityMilli: 1.5 }) }],
      ['a cart line whose quantity is negative', { data: withCartLine({ quantityMilli: -1 }) }],
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

    it('accepts a Cart that holds no line', async () => {
      const read = withCartLines([]);
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: read }));

      await expect(getShoppingList()).resolves.toEqual(read);
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

describe('the Cart lease', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  const MARKED = {
    sessionId: 'session-1',
    leaseExpiresAt: '2026-10-09T12:15:00Z',
    items: [{ itemId: 'item-1', reservationToken: 'token-1', quantityMilli: 200000 }],
  };

  // The marked Cart with other `items`, valid or not.
  function withMarkedItems(items: unknown) {
    return { ...MARKED, items };
  }

  // The same Cart with its one item, with these members instead of its own.
  function withMarkedItem(members: Record<string, unknown>) {
    return withMarkedItems([{ ...MARKED.items[0], ...members }]);
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
      ['no items', { data: { ...MARKED, items: undefined } }],
      ['an item that is not an object', { data: withMarkedItems(['item-1']) }],
      ['an item without an id', { data: withMarkedItem({ itemId: undefined }) }],
      ['an item with an empty id', { data: withMarkedItem({ itemId: '' }) }],
      [
        'an item without a reservation token',
        { data: withMarkedItem({ reservationToken: undefined }) },
      ],
      [
        'an item with an empty reservation token',
        { data: withMarkedItem({ reservationToken: '' }) },
      ],
      ['an item with a negative quantity', { data: withMarkedItem({ quantityMilli: -1 }) }],
      [
        'an item whose quantity is not a number',
        { data: withMarkedItem({ quantityMilli: '200000' }) },
      ],
      ['an item whose quantity is not whole', { data: withMarkedItem({ quantityMilli: 1.5 }) }],
      [
        'a malformed item after a valid one',
        { data: withMarkedItems([...MARKED.items, { itemId: 'item-2' }]) },
      ],
    ])('rejects %s as unintelligible', async (_name, body) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(body));

      await expect(markInCart(['item-1'])).rejects.toMatchObject({
        code: 'unknown_error',
        message: 'Malformed cart response',
      });
    });

    it('accepts a Cart that reserved no item', async () => {
      const marked = withMarkedItems([]);
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: marked }));

      await expect(markInCart(['item-1'])).resolves.toEqual(marked);
    });

    it('accepts an item reserved at a quantity of zero', async () => {
      const marked = withMarkedItem({ quantityMilli: 0 });
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: marked }));

      await expect(markInCart(['item-1'])).resolves.toEqual(marked);
    });

    it('answers the lease and the items, and no other member of the answer', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: { ...MARKED, status: 'active' } }));

      await expect(markInCart(['item-1'])).resolves.toEqual(MARKED);
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
    const CANCELLED = { sessionId: 'session-1', updatedRows: 2, status: 'abandoned' };

    it('deletes the session and returns the abandoned Cart', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: CANCELLED }));

      await expect(cancelCart('session-1')).resolves.toEqual(CANCELLED);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.example.test/api/cart/session-1');
      expect(init.method).toBe('DELETE');
    });

    it('accepts a Cart that held no item', async () => {
      const empty = { ...CANCELLED, updatedRows: 0 };
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: empty }));

      await expect(cancelCart('session-1')).resolves.toEqual(empty);
    });

    it.each([
      ['an empty body', null],
      ['a body without `data`', CANCELLED],
      ['no session id', { data: { ...CANCELLED, sessionId: undefined } }],
      ['no status', { data: { ...CANCELLED, status: undefined } }],
      ['a status other than abandoned', { data: { ...CANCELLED, status: 'active' } }],
      ['no count of the items it released', { data: { ...CANCELLED, updatedRows: undefined } }],
      ['a count that is not a number', { data: { ...CANCELLED, updatedRows: '2' } }],
      ['a count that is not whole', { data: { ...CANCELLED, updatedRows: 1.5 } }],
    ])('rejects %s as unintelligible', async (_name, body) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(body));

      await expect(cancelCart('session-1')).rejects.toMatchObject({
        code: 'unknown_error',
        message: 'Malformed cart response',
      });
    });

    it('surfaces an unknown session as `cart_not_found`', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({ error: { code: 'cart_not_found', message: 'gone' } }, false, 404)
      );

      await expect(cancelCart('session-1')).rejects.toMatchObject({ code: 'cart_not_found' });
    });
  });

  describe('confirmCheckout', () => {
    const CONFIRM_URL = 'https://api.example.test/api/checkout/confirm';
    const RESULT = toCheckoutResponse().data;

    it('posts the session, the type and the lines that were adjusted, authenticated', async () => {
      const lines = [{ itemId: RICE_LINE_ID, quantityMilli: 250_000 }];
      fetchMock.mockReturnValueOnce(mockJsonResponse(toCheckoutResponse()));

      await expect(
        confirmCheckout({ sessionId: CART_SESSION_ID, checkoutType: 'physical', lines })
      ).resolves.toEqual(RESULT);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(CONFIRM_URL);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        sessionId: CART_SESSION_ID,
        checkoutType: 'physical',
        lines,
      });
      expect(init.headers.Authorization ?? init.headers.get?.('Authorization')).toBe(
        'Bearer access-1'
      );
    });

    it('sends no lines when every line is bought as the Cart holds it', async () => {
      fetchMock.mockReturnValue(mockJsonResponse(toCheckoutResponse()));

      await confirmCheckout({ sessionId: CART_SESSION_ID, checkoutType: 'physical' });
      await confirmCheckout({ sessionId: CART_SESSION_ID, checkoutType: 'physical', lines: [] });

      for (const [, init] of fetchMock.mock.calls) {
        expect(JSON.parse(init.body)).toEqual({
          sessionId: CART_SESSION_ID,
          checkoutType: 'physical',
        });
      }
    });

    it('reads an online purchase that waits for its delivery', async () => {
      const pending = { ...RESULT, status: 'pending_delivery', checkoutType: 'online' };
      fetchMock.mockReturnValueOnce(mockJsonResponse({ data: pending }));

      await expect(
        confirmCheckout({ sessionId: CART_SESSION_ID, checkoutType: 'online' })
      ).resolves.toEqual(pending);
    });

    it('asks again when the network fails: the server answers a repeated confirm the same', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('Network request failed'))
        .mockReturnValueOnce(mockJsonResponse(toCheckoutResponse()));

      await expect(
        confirmCheckout({ sessionId: CART_SESSION_ID, checkoutType: 'physical' })
      ).resolves.toEqual(RESULT);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['an empty body', null],
      ['a body without `data`', RESULT],
      ['no session id', { data: { ...RESULT, checkoutSessionId: undefined } }],
      ['a status it does not know', { data: { ...RESULT, status: 'draft' } }],
      ['a type it does not know', { data: { ...RESULT, checkoutType: 'barter' } }],
      ['a count that is not a number', { data: { ...RESULT, movedToInventoryCount: '2' } }],
      ['no total', { data: { ...RESULT, actualTotalCents: undefined } }],
    ])('rejects %s as unintelligible', async (_name, body) => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(body));

      await expect(
        confirmCheckout({ sessionId: CART_SESSION_ID, checkoutType: 'physical' })
      ).rejects.toMatchObject({ code: 'unknown_error', message: 'Malformed checkout response' });
    });

    it.each([
      ['cart_expired', 409],
      ['cart_locked', 409],
      ['checkout_session_not_found', 404],
      ['validation_error', 422],
    ])('surfaces a refused confirm as `%s`', async (code, status) => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({ error: { code, message: 'refused' } }, false, status)
      );

      const error = await confirmCheckout({
        sessionId: CART_SESSION_ID,
        checkoutType: 'physical',
      }).catch((caught) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code, status });
    });
  });
});
