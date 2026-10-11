/// <reference types="node" />
import { fixtureProfileUpdate } from '@/features/auth/fixtures/profileUpdate';
import profileUpdateFixture from '@/features/auth/fixtures/profileUpdate.json';
import type {
  OnboardingCompletionRequest,
  ProfileUpdatePayload,
  UserPreferencesPayload,
  SlotCookingTimesPayload,
} from '@/features/auth/types/auth';
import {
  fixtureInvalidCookingSkill,
  fixtureOnboardingCompletion,
} from '@/features/onboarding/fixtures/onboardingCompletion';
import onboardingCompletionFixture from '@/features/onboarding/fixtures/onboardingCompletion.json';
import {
  fixtureInvalidDiet,
  fixtureInvalidHardRestriction,
  fixturePreferences,
} from '@/features/preferences/fixtures/preferences';
import preferencesFixture from '@/features/preferences/fixtures/preferences.json';
import {
  fixtureInvalidHungerLevel,
  fixtureSlotCookingTimes,
  fixtureValidationErrorDinnerCookingTimeMinutes,
} from '@/features/preferences/fixtures/slotCookingTimes';
import slotCookingTimesFixture from '@/features/preferences/fixtures/slotCookingTimes.json';
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
  timezone: 'America/Argentina/Buenos_Aires',
};

const profilePayload: ProfileUpdatePayload = {
  displayName: 'Lucca Giordana',
  householdSize: 2,
  cookingSkill: 'intermediate',
};

// The response bodies, the refusals included, are the frozen fixtures the api pins; the
// request bodies above are what the app builds, so they stay inline.
const profileResponse = fixtureProfileUpdate();

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
    fetchMock.mockReturnValueOnce(mockJsonResponse(onboardingCompletionFixture));

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
    expect(result).toEqual(fixtureOnboardingCompletion());
  });

  // Every refusal the api answers to an onboarding body with an invalid field.
  it.each([
    ['validation_error', fixtureValidationErrorDinnerCookingTimeMinutes()],
    ['invalid_cooking_skill', fixtureInvalidCookingSkill()],
    ['invalid_diet', fixtureInvalidDiet()],
    ['invalid_hard_restriction', fixtureInvalidHardRestriction()],
    ['invalid_hunger_level', fixtureInvalidHungerLevel()],
  ])('maps a refused onboarding completion to a typed %s error', async (code, envelope) => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(envelope, false, 422));

    await expect(authService.completeOnboarding('access-1', validPayload)).rejects.toMatchObject({
      code,
      status: 422,
    });
  });

  it('GETs /api/me/preferences with bearer token', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(preferencesFixture));

    const result = await authService.getUserPreferences('access-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/preferences',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(fixturePreferences());
  });

  it('PUTs /api/me/preferences with bearer token and returns the stored preferences', async () => {
    const payload: UserPreferencesPayload = {
      diet: 'pescatarian',
      hardRestrictions: ['shellfish'],
      softPreferences: ['cilantro'],
    };
    fetchMock.mockReturnValueOnce(mockJsonResponse(preferencesFixture));

    const result = await authService.updateUserPreferences('access-1', payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/preferences',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        body: JSON.stringify(payload),
      })
    );
    expect(result).toEqual(fixturePreferences());
  });

  it('maps invalid_diet to a typed error', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(fixtureInvalidDiet(), false, 422));

    await expect(
      authService.updateUserPreferences('access-1', {
        diet: 'made-up-diet',
        hardRestrictions: [],
        softPreferences: [],
      })
    ).rejects.toMatchObject({ code: 'invalid_diet', status: 422 });
  });

  it('GETs /api/me/slot-cooking-times with bearer token', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(slotCookingTimesFixture));

    const result = await authService.getSlotCookingTimes('access-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/slot-cooking-times',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(fixtureSlotCookingTimes());
  });

  it('PUTs /api/me/slot-cooking-times with bearer token and returns the stored slot cooking times', async () => {
    const payload: SlotCookingTimesPayload = {
      breakfast: { cookingTimeMinutes: 10, hungerLevel: 'light' },
      lunch: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
      dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
    };
    fetchMock.mockReturnValueOnce(mockJsonResponse(slotCookingTimesFixture));

    const result = await authService.updateSlotCookingTimes('access-1', payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/slot-cooking-times',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        body: JSON.stringify(payload),
      })
    );
    expect(result).toEqual(fixtureSlotCookingTimes());
  });

  it('maps the validation_error of a refused slot cooking time to a typed error', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse(fixtureValidationErrorDinnerCookingTimeMinutes(), false, 422)
    );

    await expect(
      authService.updateSlotCookingTimes('access-1', {
        breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        lunch: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        dinner: { cookingTimeMinutes: -1, hungerLevel: 'normal' },
      })
    ).rejects.toMatchObject({
      code: 'validation_error',
      message: 'The field dinner.cookingTimeMinutes is not valid.',
      status: 422,
    });
  });

  it('PUTs /api/me/profile with bearer token and returns the updated user', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(profileUpdateFixture));

    const result = await authService.updateProfile('access-1', profilePayload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/profile',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        body: JSON.stringify(profilePayload),
      })
    );
    expect(result).toEqual(profileResponse);
  });

  it('PUTs /api/me/profile with the stored access token when none is passed', async () => {
    mockSecureStore.set('auth_access_token', 'stored-access');
    fetchMock.mockReturnValueOnce(mockJsonResponse(profileUpdateFixture));

    await authService.updateProfile(profilePayload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/me/profile',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer stored-access' }),
        body: JSON.stringify(profilePayload),
      })
    );
  });

  it('rejects with a typed error when the profile update fails', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({ error: { code: 'not_found', message: 'Not Found' } }, false, 404)
    );

    await expect(authService.updateProfile('access-1', profilePayload)).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });

  it('rejects a successful profile update that comes back with an empty body', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') } as Response)
    );

    const update = authService.updateProfile('access-1', profilePayload);

    await expect(update).rejects.toBeInstanceOf(authService.AuthApiError);
    await expect(update).rejects.toMatchObject({ code: 'unknown_error' });
  });

  it.each([
    ['is not wrapped in a user', profileResponse.user],
    ['has a user without an id', { user: { ...profileResponse.user, id: undefined } }],
    ['has a user with an empty id', { user: { ...profileResponse.user, id: '' } }],
    ['has a user that is not an object', { user: 'user-1' }],
  ])('rejects a profile update response that %s', async (_case, body) => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(body));

    const update = authService.updateProfile('access-1', profilePayload);

    await expect(update).rejects.toBeInstanceOf(authService.AuthApiError);
    await expect(update).rejects.toMatchObject({ code: 'unknown_error' });
  });

  it('fills the profile fields the update response omits with null', async () => {
    const { id, email } = profileResponse.user;
    fetchMock.mockReturnValueOnce(mockJsonResponse({ user: { id, email } }));

    const result = await authService.updateProfile('access-1', profilePayload);

    expect(result).toEqual({
      user: {
        id,
        email,
        displayName: null,
        householdSize: null,
        cookingSkill: null,
      },
    });
  });
});
