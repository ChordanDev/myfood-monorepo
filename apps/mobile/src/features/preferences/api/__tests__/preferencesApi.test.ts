import { ACCESS_TOKEN_KEY } from '@/api/authTokenStore';
import { ApiError } from '@/api/errors';
import { fixturePreferences } from '../../fixtures/preferences';
import preferencesFixture from '../../fixtures/preferences.json';
import {
  fixtureSlotCookingTimes,
  fixtureSlotCookingTimesNotFoundError,
} from '../../fixtures/slotCookingTimes';
import slotCookingTimesFixture from '../../fixtures/slotCookingTimes.json';
import slotCookingTimesNotFoundFixture from '../../fixtures/slotCookingTimesNotFound.json';
import {
  getSlotCookingTimes,
  getUserPreferences,
  updateSlotCookingTimes,
  updateUserPreferences,
} from '../preferencesApi';

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

// Each response body is the frozen fixture the api controller tests pin.
describe('preferencesApi', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

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

  it('GETs /api/me/preferences with the stored token and returns the body as it is', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(preferencesFixture));

    const result = await getUserPreferences();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/preferences',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(fixturePreferences());
  });

  it('PUTs /api/me/preferences and returns the stored preferences', async () => {
    const payload = { ...fixturePreferences(), diet: 'vegan' };
    fetchMock.mockReturnValueOnce(mockJsonResponse(preferencesFixture));

    const result = await updateUserPreferences(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/preferences',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(fixturePreferences());
  });

  it('GETs /api/me/slot-cooking-times with the stored token and returns the three slots', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(slotCookingTimesFixture));

    const result = await getSlotCookingTimes();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/slot-cooking-times',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(fixtureSlotCookingTimes());
  });

  it('surfaces the 404 of a User with no saved times as slot_cooking_times_not_found', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(slotCookingTimesNotFoundFixture, false, 404));

    const error = await getSlotCookingTimes().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'slot_cooking_times_not_found',
      status: 404,
      message: slotCookingTimesNotFoundFixture.error.message,
    });
    expect(error).toEqual(fixtureSlotCookingTimesNotFoundError());
  });

  it('PUTs /api/me/slot-cooking-times and returns the stored slots', async () => {
    const payload = {
      ...fixtureSlotCookingTimes(),
      lunch: { cookingTimeMinutes: 60, hungerLevel: 'strong' as const },
    };
    fetchMock.mockReturnValueOnce(mockJsonResponse(slotCookingTimesFixture));

    const result = await updateSlotCookingTimes(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/slot-cooking-times',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(fixtureSlotCookingTimes());
  });
});
