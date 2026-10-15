/// <reference types="node" />
import { ApiError } from '@/api/errors';
import {
  LEFTOVER_LENTILS,
  OPEN_LEFTOVERS,
  toLeftoverResponse,
  toLeftoversResponse,
} from '../fixtures';
import {
  consumePreparedLeftover,
  createPreparedLeftover,
  discardPreparedLeftover,
  listPreparedLeftovers,
} from './leftoversApi';

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

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 404) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

describe('prepared leftovers api', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

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

  it('lists open leftovers in the order the server gives', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)));

    await expect(listPreparedLeftovers()).resolves.toEqual(OPEN_LEFTOVERS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/leftovers/prepared');
    expect(init.method).toBe('GET');
  });

  it('rejects a list that is not a list of leftovers', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ data: [{ id: 1 }] }));

    await expect(listPreparedLeftovers()).rejects.toMatchObject({ code: 'unknown_error' });
  });

  it('creates a leftover with a POST of the given fields', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(toLeftoverResponse(LEFTOVER_LENTILS), true, 201));
    const input = { title: 'Lentil stew', portions: 3, consumeByDate: '2026-10-11' };

    await expect(createPreparedLeftover(input)).resolves.toEqual(LEFTOVER_LENTILS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/leftovers/prepared');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(input);
  });

  it('sends the actionId a leftover is stored under', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(toLeftoverResponse(LEFTOVER_LENTILS), true, 201));
    const input = { title: 'Lentil stew', portions: 3, actionId: 'action-1' };

    await createPreparedLeftover(input);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it('names the Scheduled meal a leftover comes from', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(toLeftoverResponse(LEFTOVER_LENTILS), true, 201));
    const input = { title: 'Lentil stew', portions: 3, scheduledMealId: 'meal-1' };

    await expect(createPreparedLeftover(input)).resolves.toEqual(LEFTOVER_LENTILS);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it('consumes a leftover with a POST of its actionId to its consume path', async () => {
    const updated = { ...LEFTOVER_LENTILS, portions: 2 };
    fetchMock.mockReturnValueOnce(jsonResponse(toLeftoverResponse(updated)));

    await expect(consumePreparedLeftover('leftover-1', 'action-1')).resolves.toEqual(updated);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/leftovers/prepared/leftover-1/consume');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ actionId: 'action-1' });
  });

  it('discards a leftover with a POST to its discard path', async () => {
    const discarded = { ...LEFTOVER_LENTILS, discardedAt: '2026-10-10T08:00:00Z' };
    fetchMock.mockReturnValueOnce(jsonResponse(toLeftoverResponse(discarded)));

    await expect(discardPreparedLeftover('leftover-1')).resolves.toEqual(discarded);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.test/api/leftovers/prepared/leftover-1/discard'
    );
  });

  it('surfaces the not found code of the server', async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({ error: { code: 'prepared_leftover_not_found', message: 'nope' } }, false)
    );

    const failure = await consumePreparedLeftover('gone', 'action-1').catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: 'prepared_leftover_not_found' });
  });

  it.each([
    ['sourceMealId', { sourceMealId: 7 }],
    ['sourceMealId', { sourceMealId: undefined }],
    ['consumedAt', { consumedAt: 1 }],
    ['discardedAt', { discardedAt: false }],
  ])('rejects a leftover whose %s is neither a string nor null', async (_field, change) => {
    // An undefined field is left out of the JSON, as a server that forgot it would.
    fetchMock.mockReturnValueOnce(jsonResponse({ data: { ...LEFTOVER_LENTILS, ...change } }));

    await expect(discardPreparedLeftover('leftover-1')).rejects.toMatchObject({
      code: 'unknown_error',
    });
  });

  it('rejects an answer without a leftover', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ data: null }));

    await expect(discardPreparedLeftover('leftover-1')).rejects.toMatchObject({
      code: 'unknown_error',
    });
  });
});
