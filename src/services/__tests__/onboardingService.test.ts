import type {
  OnboardingCompletionRequest,
  OnboardingCompletionResponse,
  UserPreferences,
  UserPreferencesPayload,
  SlotCookingTimes,
  SlotCookingTimesPayload,
} from '@/features/auth/types/auth';
import * as authService from '../authService';

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

const validPayload: OnboardingCompletionRequest = {
  profile: { displayName: 'Lucca', householdSize: 1, cookingSkill: 'beginner' },
  preferences: { diet: 'omnivore', hardRestrictions: [], softPreferences: [] },
  slotCookingTimes: {
    breakfast: { cookingTimeMinutes: 0, hungerLevel: 'light' },
    lunch: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
    dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
  },
};

const completionResponse: OnboardingCompletionResponse = {
  user: {
    id: 'user-1',
    displayName: 'Lucca',
    householdSize: 1,
    cookingSkill: 'beginner',
    onboardingCompletedAt: '2026-06-09T00:00:00Z',
  },
  preferences: { diet: 'omnivore', hardRestrictions: [], softPreferences: [] },
  slotCookingTimes: {
    breakfast: { cookingTimeMinutes: 0, hungerLevel: 'light' },
    lunch: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
    dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
  },
};

describe('authService onboarding/preferences/slot-cooking-times endpoints', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    mockSecureStore.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it('POSTs the full onboarding payload to /api/onboarding/complete with bearer token', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(completionResponse));

    const result = await authService.completeOnboarding('access-1', validPayload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/onboarding/complete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-1',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: JSON.stringify(validPayload),
      })
    );
    expect(result).toEqual(completionResponse);
  });

  it('maps onboarding_invalid and onboarding_already_complete to typed errors', async () => {
    fetchMock
      .mockReturnValueOnce(
        mockJsonResponse({ error: { code: 'onboarding_invalid', message: 'invalid' } }, false, 422)
      )
      .mockReturnValueOnce(
        mockJsonResponse(
          { error: { code: 'onboarding_already_complete', message: 'done' } },
          false,
          409
        )
      );

    await expect(authService.completeOnboarding('access-1', validPayload)).rejects.toMatchObject({
      code: 'onboarding_invalid',
      status: 422,
    });

    await expect(authService.completeOnboarding('access-1', validPayload)).rejects.toMatchObject({
      code: 'onboarding_already_complete',
      status: 409,
    });
  });

  it('GETs /api/me/preferences with bearer token', async () => {
    const prefs: UserPreferences = {
      diet: 'vegetarian',
      hardRestrictions: ['gluten'],
      softPreferences: ['mushrooms'],
    };
    fetchMock.mockReturnValueOnce(mockJsonResponse(prefs));

    const result = await authService.getUserPreferences('access-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/preferences',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(prefs);
  });

  it('PUTs /api/me/preferences with bearer token and returns updated payload', async () => {
    const payload: UserPreferencesPayload = {
      diet: 'pescatarian',
      hardRestrictions: ['shellfish'],
      softPreferences: ['cilantro'],
    };
    fetchMock.mockReturnValueOnce(mockJsonResponse(payload));

    const result = await authService.updateUserPreferences('access-1', payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/preferences',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        body: JSON.stringify(payload),
      })
    );
    expect(result).toEqual(payload);
  });

  it('maps preferences_invalid to a typed error', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({ error: { code: 'preferences_invalid', message: 'bad' } }, false, 422)
    );

    await expect(
      authService.updateUserPreferences('access-1', {
        diet: 'made-up-diet',
        hardRestrictions: [],
        softPreferences: [],
      })
    ).rejects.toMatchObject({ code: 'preferences_invalid', status: 422 });
  });

  it('GETs /api/me/slot-cooking-times with bearer token', async () => {
    const slots: SlotCookingTimes = {
      breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
      lunch: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
      dinner: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
    };
    fetchMock.mockReturnValueOnce(mockJsonResponse(slots));

    const result = await authService.getSlotCookingTimes('access-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/slot-cooking-times',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(slots);
  });

  it('PUTs /api/me/slot-cooking-times with bearer token and returns updated slots', async () => {
    const payload: SlotCookingTimesPayload = {
      breakfast: { cookingTimeMinutes: 10, hungerLevel: 'light' },
      lunch: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
      dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
    };
    fetchMock.mockReturnValueOnce(mockJsonResponse(payload));

    const result = await authService.updateSlotCookingTimes('access-1', payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/slot-cooking-times',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        body: JSON.stringify(payload),
      })
    );
    expect(result).toEqual(payload);
  });

  it('maps slot_cooking_times_invalid to a typed error', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse(
        { error: { code: 'slot_cooking_times_invalid', message: 'bad' } },
        false,
        422
      )
    );

    await expect(
      authService.updateSlotCookingTimes('access-1', {
        breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        lunch: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        dinner: { cookingTimeMinutes: -1, hungerLevel: 'normal' },
      })
    ).rejects.toMatchObject({ code: 'slot_cooking_times_invalid', status: 422 });
  });
});
