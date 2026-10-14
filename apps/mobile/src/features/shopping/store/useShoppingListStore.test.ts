/// <reference types="node" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '@/api/errors';
import { useInventoryStore } from '@/features/inventory/store';
import { useMealPlanStore } from '@/store';
import {
  EMPTY_SHOPPING_LIST,
  MANUAL_DISH_SOAP,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_VALIDATION_ERROR,
  SHOPPING_LIST_WITH_MANUAL_AND_REMOVED,
  TOMATO_ITEM_IDS,
  toDeleteItemResponse,
  toManualItemResponse,
  toSetStatusResponse,
  toShoppingErrorResponse,
  toShoppingListResponse,
} from '../fixtures';
import type { ShoppingListRead } from '../types';
import { migrateShoppingListState, useShoppingListStore } from './useShoppingListStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

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

const STORAGE_KEY = 'shopping-list-storage';

// Two users who sign in on the same device, one after the other.
const USER_A = 'user-a';
const USER_B = 'user-b';
const LIST_URL = 'https://api.example.test/api/shopping-list';

const fetchMock = jest.fn();
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 422) {
  return { ok, status, text: () => Promise.resolve(JSON.stringify(payload)) } as Response;
}

function listResponse(read: ShoppingListRead) {
  return jsonResponse(toShoppingListResponse(read));
}

// Answers the next request with this read.
function answerWith(read: ShoppingListRead) {
  fetchMock.mockResolvedValueOnce(listResponse(read));
}

function rejectTheFilters() {
  fetchMock.mockResolvedValueOnce(jsonResponse(SHOPPING_LIST_VALIDATION_ERROR, false, 422));
}

// The server cannot be reached: the transport asks twice before it gives up.
function failTheNetwork() {
  fetchMock
    .mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockRejectedValueOnce(new TypeError('Network request failed'));
}

// A request the test answers when it chooses to.
function holdTheNextRequest() {
  let answer!: (read: ShoppingListRead) => void;
  let fail!: () => void;

  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      answer = (read) => resolve(listResponse(read));
      fail = () => resolve(jsonResponse(null, false, 500));
    })
  );

  return { answer: (read: ShoppingListRead) => answer(read), fail: () => fail() };
}

// Lets the requests that were asked for reach `fetch`.
function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const requestedUrls = () => fetchMock.mock.calls.map(([url]) => url as string);

const shopping = () => useShoppingListStore.getState();

// A day already chosen when the test starts, by the user who is signed in unless another one
// is named.
function holdChosenDay(chosenUntilDate: string, chosenUntilDateOwnerId: string = USER_A) {
  useShoppingListStore.setState({ chosenUntilDate, chosenUntilDateOwnerId });
}

function storedState() {
  const [key, value] = jest.mocked(AsyncStorage.setItem).mock.lastCall ?? [];

  expect(key).toBe(STORAGE_KEY);
  return JSON.parse(value ?? '');
}

beforeEach(async () => {
  mockSecureStore.clear();
  mockSecureStore.set('auth_access_token', 'access-1');
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  await AsyncStorage.clear();
  // Every test starts with an empty cache that belongs to the user who is signed in.
  useShoppingListStore.setState(
    { ...useShoppingListStore.getInitialState(), ownerId: USER_A },
    true
  );
  jest.mocked(AsyncStorage.setItem).mockClear();
});

afterAll(() => {
  process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
});

describe('before the first read', () => {
  it('holds no list, no error, no user and the default preferences', () => {
    expect(useShoppingListStore.getInitialState()).toMatchObject({
      ownerId: null,
      list: null,
      status: 'idle',
      error: null,
      chosenUntilDate: undefined,
      chosenUntilDateOwnerId: undefined,
      groupBy: 'ingredient',
    });
  });
});

describe('reading the list', () => {
  it('fills the cache with the read', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().refresh(USER_A);

    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
    expect(shopping()).toMatchObject({ status: 'ready', error: null });
  });

  it('asks for the list with the current preferences', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().refresh(USER_A);

    expect(requestedUrls()).toEqual([`${LIST_URL}?groupBy=ingredient`]);
  });

  it('is loading from the call until the answer lands', async () => {
    const request = holdTheNextRequest();

    const read = shopping().refresh(USER_A);
    expect(shopping().status).toBe('loading');

    request.answer(SHOPPING_LIST_BY_INGREDIENT);
    await read;

    expect(shopping().status).toBe('ready');
  });

  it('replaces the cache with the next read, whole', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);

    answerWith(SHOPPING_LIST_UNTIL_OCT_10);
    await shopping().refresh(USER_A);

    // Nothing of the first read is left: not the banana the second one does not list, nor the
    // share of the 12th in the rice, nor its totals.
    expect(shopping().list).toEqual(SHOPPING_LIST_UNTIL_OCT_10);
    expect(shopping().list?.planned.map((line) => line.name)).toEqual([
      'Arroz',
      'Pollo',
      'Tomate',
      'Aceite de oliva',
      'Leche',
    ]);
  });

  it('replaces a full list with an empty read, the Cart included', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);

    answerWith(EMPTY_SHOPPING_LIST);
    await shopping().refresh(USER_A);

    expect(shopping().list).toEqual(EMPTY_SHOPPING_LIST);
  });

  it('does not follow the meal plan or the inventory of the device', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);
    const listBefore = shopping().list;

    useMealPlanStore.setState({ entries: [] });
    useInventoryStore.setState({ items: [] });

    expect(shopping().list).toBe(listBefore);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('grouping the lines', () => {
  it('asks for the lines per meal, keeps the choice and replaces the cache', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);

    answerWith(SHOPPING_LIST_BY_MEAL);
    await shopping().setGroupBy('meal');

    expect(requestedUrls()[1]).toBe(`${LIST_URL}?groupBy=meal`);
    expect(shopping().groupBy).toBe('meal');
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_MEAL);
  });

  it('goes back to one line per ingredient', async () => {
    useShoppingListStore.setState({ groupBy: 'meal' });
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().setGroupBy('ingredient');

    expect(requestedUrls()).toEqual([`${LIST_URL}?groupBy=ingredient`]);
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
  });
});

describe('the day the list is asked to reach', () => {
  it('asks for the list until the chosen day, keeps the choice and replaces the cache', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);

    answerWith(SHOPPING_LIST_UNTIL_OCT_10);
    await shopping().setChosenUntilDate('2026-10-10');

    expect(requestedUrls()[1]).toBe(`${LIST_URL}?untilDate=2026-10-10&groupBy=ingredient`);
    expect(shopping().chosenUntilDate).toBe('2026-10-10');
    expect(shopping().list).toEqual(SHOPPING_LIST_UNTIL_OCT_10);
  });

  it('keeps limiting the later reads to the chosen day, in either grouping', async () => {
    holdChosenDay('2026-10-10');
    answerWith(SHOPPING_LIST_BY_MEAL);

    await shopping().setGroupBy('meal');

    expect(requestedUrls()).toEqual([`${LIST_URL}?untilDate=2026-10-10&groupBy=meal`]);
  });

  it('asks for every upcoming meal again when the choice is cleared', async () => {
    holdChosenDay('2026-10-10');
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().setChosenUntilDate(undefined);

    expect(requestedUrls()).toEqual([`${LIST_URL}?groupBy=ingredient`]);
    expect(shopping().chosenUntilDate).toBeUndefined();
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
  });
});

describe('two reads in flight', () => {
  it('ignores the answer to the older request when it lands last', async () => {
    const older = holdTheNextRequest();
    const newer = holdTheNextRequest();

    const olderRead = shopping().refresh(USER_A);
    await nextTick();
    const newerRead = shopping().setGroupBy('meal');
    await nextTick();
    expect(requestedUrls()).toEqual([`${LIST_URL}?groupBy=ingredient`, `${LIST_URL}?groupBy=meal`]);

    newer.answer(SHOPPING_LIST_BY_MEAL);
    await newerRead;
    older.answer(SHOPPING_LIST_BY_INGREDIENT);
    await olderRead;

    expect(shopping().list).toEqual(SHOPPING_LIST_BY_MEAL);
    expect(shopping().status).toBe('ready');
  });

  it('ignores the answer to the older request when it lands first, and keeps loading', async () => {
    const older = holdTheNextRequest();
    const newer = holdTheNextRequest();

    const olderRead = shopping().refresh(USER_A);
    await nextTick();
    const newerRead = shopping().setGroupBy('meal');
    await nextTick();

    older.answer(SHOPPING_LIST_BY_INGREDIENT);
    await olderRead;

    expect(shopping().list).toBeNull();
    expect(shopping().status).toBe('loading');

    newer.answer(SHOPPING_LIST_BY_MEAL);
    await newerRead;

    expect(shopping().list).toEqual(SHOPPING_LIST_BY_MEAL);
  });

  it('ignores the failure of the older request too', async () => {
    const older = holdTheNextRequest();
    const newer = holdTheNextRequest();

    const olderRead = shopping().refresh(USER_A);
    await nextTick();
    const newerRead = shopping().setGroupBy('meal');
    await nextTick();

    newer.answer(SHOPPING_LIST_BY_MEAL);
    await newerRead;
    older.fail();
    await olderRead;

    expect(shopping()).toMatchObject({ status: 'ready', error: null });
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_MEAL);
  });
});

describe('the user the list was read for', () => {
  it('is recorded with the read', async () => {
    useShoppingListStore.setState({ ownerId: null });
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().refresh(USER_A);

    expect(shopping().ownerId).toBe(USER_A);
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
  });

  it('keeps the list on hand while the same user reads again', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);
    const listBefore = shopping().list;
    const request = holdTheNextRequest();

    const read = shopping().refresh(USER_A);

    expect(shopping().list).toBe(listBefore);
    expect(shopping().status).toBe('loading');
    request.answer(SHOPPING_LIST_BY_INGREDIENT);
    await read;
  });

  it('drops the list of another user as soon as a read starts for this one', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);
    const request = holdTheNextRequest();

    const read = shopping().refresh(USER_B);

    // Before any answer: nothing of the other user is left to show.
    expect(shopping()).toMatchObject({
      ownerId: USER_B,
      list: null,
      status: 'loading',
      error: null,
    });

    request.answer(SHOPPING_LIST_BY_MEAL);
    await read;

    expect(shopping().list).toEqual(SHOPPING_LIST_BY_MEAL);
    expect(shopping().ownerId).toBe(USER_B);
  });

  it('drops the error of another user with the list', async () => {
    failTheNetwork();
    await shopping().refresh(USER_A);
    const request = holdTheNextRequest();

    const read = shopping().refresh(USER_B);

    expect(shopping()).toMatchObject({ ownerId: USER_B, status: 'loading', error: null });
    request.answer(SHOPPING_LIST_BY_INGREDIENT);
    await read;
  });

  it('exposes the failure of the first read of this user without the list of the other one', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);

    failTheNetwork();
    await shopping().refresh(USER_B);

    expect(shopping().status).toBe('error');
    expect(shopping().error).toMatchObject({ code: 'network_error' });
    expect(shopping().list).toBeNull();
    expect(shopping().ownerId).toBe(USER_B);
  });

  it('keeps the grouping when the user changes: it is how this device reads the list', async () => {
    useShoppingListStore.setState({ groupBy: 'meal' });
    answerWith(SHOPPING_LIST_BY_MEAL);

    await shopping().refresh(USER_B);

    expect(requestedUrls()).toEqual([`${LIST_URL}?groupBy=meal`]);
    expect(shopping().groupBy).toBe('meal');
  });

  it('ignores an answer that lands for a user who is no longer the current one', async () => {
    const forUserA = holdTheNextRequest();
    const forUserB = holdTheNextRequest();

    const readOfUserA = shopping().refresh(USER_A);
    await nextTick();
    const readOfUserB = shopping().refresh(USER_B);
    await nextTick();

    forUserA.answer(SHOPPING_LIST_BY_MEAL);
    await readOfUserA;

    expect(shopping()).toMatchObject({ ownerId: USER_B, list: null, status: 'loading' });

    forUserB.answer(SHOPPING_LIST_BY_INGREDIENT);
    await readOfUserB;

    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
  });

  it('ignores a failure that lands for a user who is no longer the current one', async () => {
    const forUserA = holdTheNextRequest();
    const forUserB = holdTheNextRequest();

    const readOfUserA = shopping().refresh(USER_A);
    await nextTick();
    const readOfUserB = shopping().refresh(USER_B);
    await nextTick();

    forUserB.answer(SHOPPING_LIST_BY_INGREDIENT);
    await readOfUserB;
    forUserA.fail();
    await readOfUserA;

    expect(shopping()).toMatchObject({ ownerId: USER_B, status: 'ready', error: null });
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
  });

  describe('once nobody is signed in', () => {
    it('drops the list and asks for nothing', async () => {
      answerWith(SHOPPING_LIST_BY_INGREDIENT);
      await shopping().refresh(USER_A);

      await shopping().refresh(null);

      expect(shopping()).toMatchObject({ ownerId: null, list: null, status: 'idle', error: null });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('ignores the answer to a read that was still on its way', async () => {
      const request = holdTheNextRequest();
      const read = shopping().refresh(USER_A);
      await nextTick();

      await shopping().refresh(null);
      request.answer(SHOPPING_LIST_BY_INGREDIENT);
      await read;

      expect(shopping()).toMatchObject({ ownerId: null, list: null, status: 'idle' });
    });

    it('sends nothing for a read that signing out overtook before its request', async () => {
      const read = shopping().refresh(USER_A);
      const signedOut = shopping().refresh(null);
      await Promise.all([read, signedOut]);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(shopping()).toMatchObject({ ownerId: null, list: null, status: 'idle' });
    });

    it('keeps a grouping that is chosen, without reading', async () => {
      await shopping().refresh(null);

      await shopping().setGroupBy('meal');

      expect(shopping()).toMatchObject({ groupBy: 'meal', list: null, status: 'idle' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps no day that is chosen: there is nobody it would belong to', async () => {
      await shopping().refresh(null);

      await shopping().setChosenUntilDate('2026-10-10');

      expect(shopping()).toMatchObject({
        chosenUntilDate: undefined,
        chosenUntilDateOwnerId: undefined,
      });
      expect(shopping()).toMatchObject({ list: null, status: 'idle' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the day of the user who signed out, for when they come back', async () => {
      holdChosenDay('2026-10-10');
      await shopping().refresh(null);
      answerWith(SHOPPING_LIST_UNTIL_OCT_10);

      await shopping().refresh(USER_A);

      expect(requestedUrls()).toEqual([`${LIST_URL}?untilDate=2026-10-10&groupBy=ingredient`]);
      expect(shopping()).toMatchObject({
        chosenUntilDate: '2026-10-10',
        chosenUntilDateOwnerId: USER_A,
      });
    });
  });

  it('reads again for the user of the cache when a preference changes', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_B);

    answerWith(SHOPPING_LIST_BY_MEAL);
    await shopping().setGroupBy('meal');

    expect(shopping().ownerId).toBe(USER_B);
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_MEAL);
  });
});

describe('the user who chose the day', () => {
  it('is recorded with the day', async () => {
    answerWith(SHOPPING_LIST_UNTIL_OCT_10);

    await shopping().setChosenUntilDate('2026-10-10');

    expect(shopping()).toMatchObject({
      chosenUntilDate: '2026-10-10',
      chosenUntilDateOwnerId: USER_A,
    });
  });

  it('is forgotten with the day when the choice is cleared', async () => {
    holdChosenDay('2026-10-10');
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().setChosenUntilDate(undefined);

    expect(shopping()).toMatchObject({
      chosenUntilDate: undefined,
      chosenUntilDateOwnerId: undefined,
    });
  });

  it('keeps the day, and reads with it, every time they read again', async () => {
    answerWith(SHOPPING_LIST_UNTIL_OCT_10);
    await shopping().setChosenUntilDate('2026-10-10');

    answerWith(SHOPPING_LIST_UNTIL_OCT_10);
    await shopping().refresh(USER_A);

    expect(requestedUrls()[1]).toBe(`${LIST_URL}?untilDate=2026-10-10&groupBy=ingredient`);
    expect(shopping()).toMatchObject({
      chosenUntilDate: '2026-10-10',
      chosenUntilDateOwnerId: USER_A,
    });
  });

  describe('once another user reads on the same device', () => {
    // User A limited the list to the 10th, a day the plan of user B has a meal on too: the
    // read of user B would be taken as it comes, cut at a day they never chose.
    beforeEach(async () => {
      answerWith(SHOPPING_LIST_UNTIL_OCT_10);
      await shopping().setChosenUntilDate('2026-10-10');
      fetchMock.mockClear();
    });

    it('asks for every upcoming meal of theirs, and holds no chosen day', async () => {
      answerWith(SHOPPING_LIST_BY_INGREDIENT);

      await shopping().refresh(USER_B);

      expect(requestedUrls()).toEqual([`${LIST_URL}?groupBy=ingredient`]);
      expect(shopping()).toMatchObject({
        ownerId: USER_B,
        chosenUntilDate: undefined,
        chosenUntilDateOwnerId: undefined,
      });
      expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
      expect(shopping().list?.plannedDates).toContain('2026-10-10');
    });

    it('forgets the day in the storage too', async () => {
      answerWith(SHOPPING_LIST_BY_INGREDIENT);

      await shopping().refresh(USER_B);

      expect(storedState()).toEqual({ version: 4, state: { groupBy: 'ingredient' } });
    });

    it('keeps the day they choose as theirs', async () => {
      answerWith(SHOPPING_LIST_BY_INGREDIENT);
      await shopping().refresh(USER_B);

      answerWith(SHOPPING_LIST_UNTIL_OCT_10);
      await shopping().setChosenUntilDate('2026-10-10');

      expect(requestedUrls()[1]).toBe(`${LIST_URL}?untilDate=2026-10-10&groupBy=ingredient`);
      expect(shopping()).toMatchObject({
        chosenUntilDate: '2026-10-10',
        chosenUntilDateOwnerId: USER_B,
      });
    });
  });

  it('is needed to read with a day: one that belongs to nobody is forgotten', async () => {
    useShoppingListStore.setState({ chosenUntilDate: '2026-10-10' });
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().refresh(USER_A);

    expect(requestedUrls()).toEqual([`${LIST_URL}?groupBy=ingredient`]);
    expect(shopping().chosenUntilDate).toBeUndefined();
  });
});

describe('a read that fails', () => {
  it('exposes the error and has no list when it is the first read', async () => {
    failTheNetwork();

    await shopping().refresh(USER_A);

    expect(shopping().status).toBe('error');
    expect(shopping().error).toBeInstanceOf(ApiError);
    expect(shopping().error).toMatchObject({ code: 'network_error' });
    expect(shopping().list).toBeNull();
  });

  it('keeps the last list', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);
    const listBefore = shopping().list;

    failTheNetwork();
    await shopping().refresh(USER_A);

    expect(shopping().status).toBe('error');
    expect(shopping().error).toMatchObject({ code: 'network_error' });
    expect(shopping().list).toBe(listBefore);
  });

  it('keeps the preference the failed read was asked with', async () => {
    failTheNetwork();

    await shopping().setGroupBy('meal');

    expect(shopping().groupBy).toBe('meal');
  });

  it('forgets the error once a read lands', async () => {
    failTheNetwork();
    await shopping().refresh(USER_A);

    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().refresh(USER_A);

    expect(shopping()).toMatchObject({ status: 'ready', error: null });
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
  });

  it('forgets the error while the next read is in flight', async () => {
    failTheNetwork();
    await shopping().refresh(USER_A);
    const request = holdTheNextRequest();

    const read = shopping().refresh(USER_A);

    expect(shopping()).toMatchObject({ status: 'loading', error: null });
    request.answer(SHOPPING_LIST_BY_INGREDIENT);
    await read;
  });
});

describe('a stored day the server rejects', () => {
  // The day was chosen while it was upcoming, and the Account's today has moved past it.
  beforeEach(() => {
    holdChosenDay('2026-10-01');
  });

  it('is cleared, and the list is read again without it', async () => {
    rejectTheFilters();
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().refresh(USER_A);

    expect(requestedUrls()).toEqual([
      `${LIST_URL}?untilDate=2026-10-01&groupBy=ingredient`,
      `${LIST_URL}?groupBy=ingredient`,
    ]);
    expect(shopping().chosenUntilDate).toBeUndefined();
    expect(shopping().chosenUntilDateOwnerId).toBeUndefined();
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
    expect(shopping()).toMatchObject({ status: 'ready', error: null });
  });

  it('is cleared in the storage too, with the user who chose it', async () => {
    rejectTheFilters();
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().refresh(USER_A);

    expect(storedState()).toEqual({ version: 4, state: { groupBy: 'ingredient' } });
  });

  it('is read again only once: a second rejection is the error of the read', async () => {
    rejectTheFilters();
    rejectTheFilters();

    await shopping().refresh(USER_A);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(shopping().status).toBe('error');
    expect(shopping().error).toMatchObject({ code: 'validation_error' });
    expect(shopping().chosenUntilDate).toBeUndefined();
  });

  it('is kept when the read fails for any other reason', async () => {
    failTheNetwork();

    await shopping().refresh(USER_A);

    expect(shopping().chosenUntilDate).toBe('2026-10-01');
    expect(shopping().chosenUntilDateOwnerId).toBe(USER_A);
    expect(shopping().status).toBe('error');
  });
});

describe('a stored day the plan no longer has a meal on', () => {
  // The 9th is still upcoming, so the server takes it, but it is not one of the planned dates.
  beforeEach(() => {
    holdChosenDay('2026-10-09');
  });

  it('is cleared, and the list is read again without it', async () => {
    answerWith({ ...SHOPPING_LIST_UNTIL_OCT_10, planned: [] });
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().refresh(USER_A);

    expect(requestedUrls()).toEqual([
      `${LIST_URL}?untilDate=2026-10-09&groupBy=ingredient`,
      `${LIST_URL}?groupBy=ingredient`,
    ]);
    expect(shopping().chosenUntilDate).toBeUndefined();
    expect(shopping().chosenUntilDateOwnerId).toBeUndefined();
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
    expect(shopping().status).toBe('ready');
  });

  it('never shows the read that was limited to it', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().setChosenUntilDate(undefined);
    holdChosenDay('2026-10-09');
    const lists: unknown[] = [];
    const stopListening = useShoppingListStore.subscribe((state) => lists.push(state.list));

    answerWith({ ...SHOPPING_LIST_UNTIL_OCT_10, planned: [] });
    answerWith(SHOPPING_LIST_BY_MEAL);
    await shopping().setGroupBy('meal');
    stopListening();

    expect(lists.every((list) => (list as { planned: unknown[] }).planned.length > 0)).toBe(true);
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_MEAL);
  });
});

describe('a rejection without a stored day', () => {
  it('is the error of the read, and nothing is asked again', async () => {
    rejectTheFilters();

    await shopping().refresh(USER_A);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(shopping().status).toBe('error');
    expect(shopping().error).toMatchObject({ code: 'validation_error' });
  });
});

describe('persistence', () => {
  // What this version stores once user A limited the list to the 10th, read per meal.
  const STORED_DAY_OF_USER_A = {
    version: 4,
    state: { chosenUntilDate: '2026-10-10', chosenUntilDateOwnerId: USER_A, groupBy: 'meal' },
  };

  it('stores the day, who chose it and the grouping under its own key, and nothing of the read', async () => {
    answerWith(SHOPPING_LIST_BY_MEAL);
    await shopping().setGroupBy('meal');
    answerWith(SHOPPING_LIST_UNTIL_OCT_10);
    await shopping().setChosenUntilDate('2026-10-10');

    expect(shopping().list).not.toBeNull();
    expect(storedState()).toEqual(STORED_DAY_OF_USER_A);
  });

  it('brings the preferences back when the storage is read, with no list', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(STORED_DAY_OF_USER_A));

    await useShoppingListStore.persist.rehydrate();

    expect(shopping()).toMatchObject({
      chosenUntilDate: '2026-10-10',
      chosenUntilDateOwnerId: USER_A,
      groupBy: 'meal',
      list: null,
      status: 'idle',
    });
  });

  it('reads the list with the stored preferences when it is asked for before they are back', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(STORED_DAY_OF_USER_A));
    answerWith(SHOPPING_LIST_BY_MEAL);

    const hydration = useShoppingListStore.persist.rehydrate();
    const read = shopping().refresh(USER_A);
    await Promise.all([hydration, read]);

    expect(requestedUrls()).toEqual([`${LIST_URL}?untilDate=2026-10-10&groupBy=meal`]);
  });

  describe('when the app starts again', () => {
    // Nothing was read yet, so the cache belongs to nobody: only the storage knows who chose
    // the day.
    beforeEach(async () => {
      useShoppingListStore.setState(useShoppingListStore.getInitialState(), true);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(STORED_DAY_OF_USER_A));
      jest.mocked(AsyncStorage.setItem).mockClear();
    });

    it('reads until the stored day for the user who chose it, and keeps it', async () => {
      await useShoppingListStore.persist.rehydrate();
      expect(shopping()).toMatchObject({ ownerId: null, chosenUntilDate: '2026-10-10' });
      answerWith(SHOPPING_LIST_BY_MEAL);

      await shopping().refresh(USER_A);

      expect(requestedUrls()).toEqual([`${LIST_URL}?untilDate=2026-10-10&groupBy=meal`]);
      expect(shopping()).toMatchObject({
        ownerId: USER_A,
        chosenUntilDate: '2026-10-10',
        chosenUntilDateOwnerId: USER_A,
      });
      expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '')).toEqual(
        STORED_DAY_OF_USER_A
      );
    });

    it('drops the stored day for another user, and keeps the grouping', async () => {
      answerWith(SHOPPING_LIST_BY_MEAL);

      // Asked for while the storage is still being read: the day is not in the state yet.
      const hydration = useShoppingListStore.persist.rehydrate();
      const read = shopping().refresh(USER_B);
      await Promise.all([hydration, read]);

      expect(requestedUrls()).toEqual([`${LIST_URL}?groupBy=meal`]);
      expect(shopping()).toMatchObject({
        ownerId: USER_B,
        chosenUntilDate: undefined,
        chosenUntilDateOwnerId: undefined,
        groupBy: 'meal',
      });
      expect(storedState()).toEqual({ version: 4, state: { groupBy: 'meal' } });
    });
  });

  describe('of preferences stored by version 3', () => {
    // What version 3 wrote: the day was kept for the device, whoever was signed in.
    const VERSION_3_STATE = { chosenUntilDate: '2026-10-10', groupBy: 'meal' };

    it('drops the chosen day, which has no user to belong to, and keeps the grouping', () => {
      expect(migrateShoppingListState(VERSION_3_STATE)).toEqual({
        chosenUntilDate: undefined,
        chosenUntilDateOwnerId: undefined,
        groupBy: 'meal',
      });
    });

    it('does not trust a user stored next to the day', () => {
      expect(
        migrateShoppingListState({ ...VERSION_3_STATE, chosenUntilDateOwnerId: USER_A })
      ).toEqual({
        chosenUntilDate: undefined,
        chosenUntilDateOwnerId: undefined,
        groupBy: 'meal',
      });
    });

    it('is upgraded by the store when it reads the storage, and written back as version 4', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 3, state: VERSION_3_STATE })
      );

      await useShoppingListStore.persist.rehydrate();

      expect(shopping()).toMatchObject({
        chosenUntilDate: undefined,
        chosenUntilDateOwnerId: undefined,
        groupBy: 'meal',
      });
      expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '')).toEqual({
        version: 4,
        state: { groupBy: 'meal' },
      });
    });
  });

  describe('of a list stored by version 2', () => {
    // What version 2 wrote: the cart, the removed rows and the items added by hand lived on
    // the device, next to the grouping by supermarket.
    const VERSION_2_STATE = {
      cartIds: ['planned:i2'],
      removedIds: ['planned:i1'],
      manualItems: [{ id: 'manual:1', source: 'manual', status: 'needed', name: 'Servilletas' }],
      lastManualItemSequence: 1,
      groupingMode: 'supermarket',
      chosenUntilDate: '2026-10-12',
    };

    it('drops everything, the chosen day included, and reads per ingredient', () => {
      expect(migrateShoppingListState(VERSION_2_STATE)).toEqual({
        chosenUntilDate: undefined,
        chosenUntilDateOwnerId: undefined,
        groupBy: 'ingredient',
      });
    });

    it.each([[null], ['garbage'], [42], [[]], [{}]])(
      'has no preference to keep in %p',
      (stored) => {
        expect(migrateShoppingListState(stored)).toEqual({
          chosenUntilDate: undefined,
          chosenUntilDateOwnerId: undefined,
          groupBy: 'ingredient',
        });
      }
    );

    it('is upgraded by the store when it reads the storage, and written back as version 4', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 2, state: VERSION_2_STATE })
      );

      await useShoppingListStore.persist.rehydrate();

      expect(shopping()).toMatchObject({ chosenUntilDate: undefined, groupBy: 'ingredient' });
      for (const dropped of ['cartIds', 'removedIds', 'manualItems', 'groupingMode', 'offers']) {
        expect(shopping()).not.toHaveProperty(dropped);
      }
      expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '')).toEqual({
        version: 4,
        state: { groupBy: 'ingredient' },
      });
    });
  });
});

describe('changing the list', () => {
  // The method and the path of every request, in the order they went out.
  const requests = () =>
    fetchMock.mock.calls.map(
      ([url, init]) => `${init.method} ${(url as string).replace('https://api.example.test', '')}`
    );

  function answerChange(payload: unknown, status = 200) {
    fetchMock.mockResolvedValueOnce(jsonResponse(payload, true, status));
  }

  function refuseChange(code: string, status: number) {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(toShoppingErrorResponse(code, 'Refused.'), false, status)
    );
  }

  beforeEach(() => {
    useShoppingListStore.setState({ list: SHOPPING_LIST_BY_INGREDIENT, status: 'ready' });
  });

  it('holds no change and no error before any is asked for', () => {
    expect(shopping()).toMatchObject({ pendingChanges: 0, changeError: null });
  });

  describe('adding an item by hand', () => {
    it('posts it, then replaces the cached list with a fresh read from the server', async () => {
      answerChange(toManualItemResponse(MANUAL_DISH_SOAP), 201);
      answerWith(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);

      const added = await shopping().addManualItem({ name: 'Detergente' });

      expect(added).toBe(true);
      expect(requests()).toEqual([
        'POST /api/shopping-items/manual',
        'GET /api/shopping-list?groupBy=ingredient',
      ]);
      expect(shopping().list).toEqual(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);
      expect(shopping()).toMatchObject({ status: 'ready', changeError: null, pendingChanges: 0 });
    });

    it('reads the list with the preferences of the user', async () => {
      useShoppingListStore.setState({ groupBy: 'meal' });
      answerChange(toManualItemResponse(MANUAL_DISH_SOAP), 201);
      answerWith(SHOPPING_LIST_BY_MEAL);

      await shopping().addManualItem({ name: 'Detergente' });

      expect(requestedUrls()[1]).toBe(`${LIST_URL}?groupBy=meal`);
    });

    it('counts the change as pending until it lands', async () => {
      const held = holdTheNextRequest();

      const adding = shopping().addManualItem({ name: 'Detergente' });
      await nextTick();
      expect(shopping().pendingChanges).toBe(1);

      held.fail();
      await adding;
      expect(shopping().pendingChanges).toBe(0);
    });
  });

  describe('deleting an item added by hand', () => {
    it('deletes it, then reads the list again', async () => {
      answerChange(toDeleteItemResponse(MANUAL_DISH_SOAP.id));
      answerWith(SHOPPING_LIST_BY_INGREDIENT);

      const deleted = await shopping().deleteItem(MANUAL_DISH_SOAP.id);

      expect(deleted).toBe(true);
      expect(requests()).toEqual([
        `DELETE /api/shopping-items/${MANUAL_DISH_SOAP.id}`,
        'GET /api/shopping-list?groupBy=ingredient',
      ]);
      expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
    });
  });

  describe('removing and restoring planned items', () => {
    it('removes them, then shows the list the server answers, removed line included', async () => {
      answerChange(toSetStatusResponse('removed', TOMATO_ITEM_IDS));
      answerWith(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);

      const removed = await shopping().setItemsStatus(TOMATO_ITEM_IDS, 'removed');

      expect(removed).toBe(true);
      expect(requests()).toEqual([
        'POST /api/shopping-items/set-status',
        'GET /api/shopping-list?groupBy=ingredient',
      ]);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        itemIds: TOMATO_ITEM_IDS,
        status: 'removed',
      });
      expect(shopping().list?.totals.removed).toBe(1);
    });

    it('restores them with `needed`', async () => {
      useShoppingListStore.setState({ list: SHOPPING_LIST_WITH_MANUAL_AND_REMOVED });
      answerChange(toSetStatusResponse('needed', TOMATO_ITEM_IDS));
      answerWith(SHOPPING_LIST_BY_INGREDIENT);

      await shopping().setItemsStatus(TOMATO_ITEM_IDS, 'needed');

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).status).toBe('needed');
      expect(shopping().list?.totals.removed).toBe(0);
    });
  });

  describe('a change the server refuses', () => {
    it('keeps the list, remembers why and answers false', async () => {
      refuseChange('shopping_item_in_cart', 409);

      const removed = await shopping().setItemsStatus(TOMATO_ITEM_IDS, 'removed');

      expect(removed).toBe(false);
      expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
      expect(shopping().changeError).toMatchObject({ code: 'shopping_item_in_cart' });
      expect(shopping().pendingChanges).toBe(0);
    });

    it('does not read the list again for a failure that says nothing about it', async () => {
      refuseChange('shopping_item_in_cart', 409);

      await shopping().setItemsStatus(TOMATO_ITEM_IDS, 'removed');

      expect(requests()).toEqual(['POST /api/shopping-items/set-status']);
    });

    it.each([
      ['shopping_item_not_found', 404],
      ['shopping_item_not_manual', 422],
      ['shopping_item_not_planned', 422],
    ])('reads the list again on %s: it was stale', async (code, status) => {
      refuseChange(code, status);
      answerWith(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);

      await shopping().deleteItem('gone');

      expect(requests()).toEqual([
        'DELETE /api/shopping-items/gone',
        'GET /api/shopping-list?groupBy=ingredient',
      ]);
      expect(shopping().list).toEqual(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);
      expect(shopping().changeError).toMatchObject({ code });
    });

    it('keeps the cached list when the network fails, without asking twice', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

      const added = await shopping().addManualItem({ name: 'Detergente' });

      expect(added).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(shopping().changeError).toMatchObject({ code: 'network_error' });
      expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
    });

    it('forgets the error when the next change starts, or when it is dismissed', async () => {
      refuseChange('shopping_item_in_cart', 409);
      await shopping().setItemsStatus(TOMATO_ITEM_IDS, 'removed');
      expect(shopping().changeError).not.toBeNull();

      shopping().clearChangeError();
      expect(shopping().changeError).toBeNull();

      refuseChange('shopping_item_in_cart', 409);
      await shopping().setItemsStatus(TOMATO_ITEM_IDS, 'removed');
      answerChange(toSetStatusResponse('removed', TOMATO_ITEM_IDS));
      answerWith(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);
      await shopping().setItemsStatus(TOMATO_ITEM_IDS, 'removed');
      expect(shopping().changeError).toBeNull();
    });
  });

  describe('against the reads', () => {
    it('is not overwritten by the slower answer of a read asked for before it', async () => {
      const oldRead = holdTheNextRequest();
      const reading = shopping().refresh(USER_A);
      await nextTick();

      answerChange(toSetStatusResponse('removed', TOMATO_ITEM_IDS));
      answerWith(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);
      await shopping().setItemsStatus(TOMATO_ITEM_IDS, 'removed');

      oldRead.answer(SHOPPING_LIST_BY_INGREDIENT);
      await reading;

      expect(shopping().list).toEqual(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);
    });

    it('leaves the cache alone when another user signed in while it was on its way', async () => {
      const held = holdTheNextRequest();
      const adding = shopping().addManualItem({ name: 'Detergente' });
      await nextTick();

      useShoppingListStore.setState({ ownerId: USER_B, list: EMPTY_SHOPPING_LIST });
      held.fail();
      await adding;

      expect(requests()).toEqual(['POST /api/shopping-items/manual']);
      expect(shopping()).toMatchObject({ ownerId: USER_B, list: EMPTY_SHOPPING_LIST });
      expect(shopping().changeError).toBeNull();
    });

    it('asks for nothing without a user of the cache', async () => {
      useShoppingListStore.setState({ ownerId: null });

      await expect(shopping().addManualItem({ name: 'Detergente' })).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
