/// <reference types="node" />
import { ApiError } from '@/api/errors';
import {
  COOKING_FINISH_WITH_SHORTAGE,
  COOKING_SCHEDULED_MEAL_ID,
  COOKING_SESSION_ID,
  toCookingFinishResponse,
  toCookingStartResponse,
} from '../fixtures';
import { finishCookingSession, startCookingSession } from './cookingApi';

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

describe('the cooking API', () => {
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

  describe('startCookingSession', () => {
    it('posts the meal id and returns the session', async () => {
      fetchMock.mockReturnValue(mockJsonResponse(toCookingStartResponse()));

      const session = await startCookingSession(COOKING_SCHEDULED_MEAL_ID);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.example.test/api/cooking/start');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ scheduledMealId: COOKING_SCHEDULED_MEAL_ID });
      expect(session.sessionId).toBe(COOKING_SESSION_ID);
    });

    it('does not retry a transient failure: the post is not idempotent', async () => {
      fetchMock.mockRejectedValue(new TypeError('Network request failed'));

      await expect(startCookingSession(COOKING_SCHEDULED_MEAL_ID)).rejects.toMatchObject({
        code: 'network_error',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('turns an answer without a session id into an unknown error', async () => {
      fetchMock.mockReturnValue(mockJsonResponse({ data: {} }));

      await expect(startCookingSession(COOKING_SCHEDULED_MEAL_ID)).rejects.toMatchObject({
        code: 'unknown_error',
      });
    });

    it('keeps the code of a refused start', async () => {
      fetchMock.mockReturnValue(
        mockJsonResponse({ error: { code: 'cooking_chat_unavailable', message: 'no' } }, false, 422)
      );

      await expect(startCookingSession(COOKING_SCHEDULED_MEAL_ID)).rejects.toMatchObject({
        code: 'cooking_chat_unavailable',
      });
    });
  });

  describe('finishCookingSession', () => {
    it('posts to the session finish path and returns the consumption', async () => {
      fetchMock.mockReturnValue(mockJsonResponse(toCookingFinishResponse()));

      const finish = await finishCookingSession(COOKING_SESSION_ID);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        `https://api.example.test/api/cooking/sessions/${COOKING_SESSION_ID}/finish`
      );
      expect(init.method).toBe('POST');
      expect(finish).toEqual(COOKING_FINISH_WITH_SHORTAGE);
    });

    it('does not retry a timeout', async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

      await expect(finishCookingSession(COOKING_SESSION_ID)).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('turns an answer without the members of a finish into an unknown error', async () => {
      fetchMock.mockReturnValue(mockJsonResponse({ data: { scheduledMeal: {} } }));

      await expect(finishCookingSession(COOKING_SESSION_ID)).rejects.toMatchObject({
        code: 'unknown_error',
      });
    });

    it('keeps the code of a refused finish', async () => {
      fetchMock.mockReturnValue(
        mockJsonResponse({ error: { code: 'cooking_already_finished', message: 'x' } }, false, 409)
      );

      await expect(finishCookingSession(COOKING_SESSION_ID)).rejects.toMatchObject({
        code: 'cooking_already_finished',
      });
    });
  });
});
