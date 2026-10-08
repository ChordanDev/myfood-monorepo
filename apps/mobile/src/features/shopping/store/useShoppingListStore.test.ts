/// <reference types="node" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '@/api/errors';
import { useInventoryStore } from '@/features/inventory/store';
import { useMealPlanStore } from '@/store';
import {
  EMPTY_SHOPPING_LIST,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_VALIDATION_ERROR,
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

    useMealPlanStore.setState({ entries: [], recipes: [] });
    useInventoryStore.setState({ items: [], ingredients: [] });

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
    useShoppingListStore.setState({ chosenUntilDate: '2026-10-10' });
    answerWith(SHOPPING_LIST_BY_MEAL);

    await shopping().setGroupBy('meal');

    expect(requestedUrls()).toEqual([`${LIST_URL}?untilDate=2026-10-10&groupBy=meal`]);
  });

  it('asks for every upcoming meal again when the choice is cleared', async () => {
    useShoppingListStore.setState({ chosenUntilDate: '2026-10-10' });
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

  it('keeps how the list is read when the user changes', async () => {
    useShoppingListStore.setState({ chosenUntilDate: '2026-10-10', groupBy: 'meal' });
    answerWith(SHOPPING_LIST_BY_MEAL);

    await shopping().refresh(USER_B);

    expect(requestedUrls()).toEqual([`${LIST_URL}?untilDate=2026-10-10&groupBy=meal`]);
    expect(shopping()).toMatchObject({ chosenUntilDate: '2026-10-10', groupBy: 'meal' });
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

    it('keeps a preference that is chosen, without reading', async () => {
      await shopping().refresh(null);

      await shopping().setGroupBy('meal');
      await shopping().setChosenUntilDate('2026-10-10');

      expect(shopping()).toMatchObject({ groupBy: 'meal', chosenUntilDate: '2026-10-10' });
      expect(shopping()).toMatchObject({ list: null, status: 'idle' });
      expect(fetchMock).not.toHaveBeenCalled();
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
    useShoppingListStore.setState({ chosenUntilDate: '2026-10-01' });
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
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
    expect(shopping()).toMatchObject({ status: 'ready', error: null });
  });

  it('is cleared in the storage too', async () => {
    rejectTheFilters();
    answerWith(SHOPPING_LIST_BY_INGREDIENT);

    await shopping().refresh(USER_A);

    expect(storedState()).toEqual({ version: 3, state: { groupBy: 'ingredient' } });
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
    expect(shopping().status).toBe('error');
  });
});

describe('a stored day the plan no longer has a meal on', () => {
  // The 9th is still upcoming, so the server takes it, but it is not one of the planned dates.
  beforeEach(() => {
    useShoppingListStore.setState({ chosenUntilDate: '2026-10-09' });
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
    expect(shopping().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
    expect(shopping().status).toBe('ready');
  });

  it('never shows the read that was limited to it', async () => {
    answerWith(SHOPPING_LIST_BY_INGREDIENT);
    await shopping().setChosenUntilDate(undefined);
    useShoppingListStore.setState({ chosenUntilDate: '2026-10-09' });
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
  it('stores the two preferences under its own key, and nothing of the read', async () => {
    answerWith(SHOPPING_LIST_BY_MEAL);
    await shopping().setGroupBy('meal');
    answerWith(SHOPPING_LIST_UNTIL_OCT_10);
    await shopping().setChosenUntilDate('2026-10-10');

    expect(shopping().list).not.toBeNull();
    expect(storedState()).toEqual({
      version: 3,
      state: { chosenUntilDate: '2026-10-10', groupBy: 'meal' },
    });
  });

  it('brings the preferences back when the storage is read, with no list', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 3, state: { chosenUntilDate: '2026-10-10', groupBy: 'meal' } })
    );

    await useShoppingListStore.persist.rehydrate();

    expect(shopping()).toMatchObject({
      chosenUntilDate: '2026-10-10',
      groupBy: 'meal',
      list: null,
      status: 'idle',
    });
  });

  it('reads the list with the stored preferences when it is asked for before they are back', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 3, state: { chosenUntilDate: '2026-10-10', groupBy: 'meal' } })
    );
    answerWith(SHOPPING_LIST_BY_MEAL);

    const hydration = useShoppingListStore.persist.rehydrate();
    const read = shopping().refresh(USER_A);
    await Promise.all([hydration, read]);

    expect(requestedUrls()).toEqual([`${LIST_URL}?untilDate=2026-10-10&groupBy=meal`]);
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

    it('keeps the chosen day and drops everything else', () => {
      expect(migrateShoppingListState(VERSION_2_STATE)).toEqual({
        chosenUntilDate: '2026-10-12',
        groupBy: 'ingredient',
      });
    });

    it('keeps the chosen day only as a date key', () => {
      for (const stored of [null, 20261012, '12/10/2026', 'tomorrow', ['2026-10-12']]) {
        expect(
          migrateShoppingListState({ ...VERSION_2_STATE, chosenUntilDate: stored }).chosenUntilDate
        ).toBeUndefined();
      }
    });

    it.each([[null], ['garbage'], [42], [[]], [{}]])(
      'has no preference to keep in %p',
      (stored) => {
        expect(migrateShoppingListState(stored)).toEqual({
          chosenUntilDate: undefined,
          groupBy: 'ingredient',
        });
      }
    );

    it('is upgraded by the store when it reads the storage, and written back as version 3', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 2, state: VERSION_2_STATE })
      );

      await useShoppingListStore.persist.rehydrate();

      expect(shopping()).toMatchObject({ chosenUntilDate: '2026-10-12', groupBy: 'ingredient' });
      for (const dropped of ['cartIds', 'removedIds', 'manualItems', 'groupingMode', 'offers']) {
        expect(shopping()).not.toHaveProperty(dropped);
      }
      expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '')).toEqual({
        version: 3,
        state: { chosenUntilDate: '2026-10-12', groupBy: 'ingredient' },
      });
    });
  });
});
