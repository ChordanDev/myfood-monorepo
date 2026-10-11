import { ACCESS_TOKEN_KEY } from '@/api/authTokenStore';
import type { OnboardingCompletionRequest } from '@/features/auth/types/auth';
import { fixtureOnboardingCompletion } from '../../fixtures/onboardingCompletion';
import onboardingCompletionFixture from '../../fixtures/onboardingCompletion.json';
import { completeOnboarding } from '../onboardingApi';

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

function mockJsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

// The request the app builds for the User the frozen response describes.
function requestFor(completion = fixtureOnboardingCompletion()): OnboardingCompletionRequest {
  const { displayName, householdSize, cookingSkill } = completion.user;

  return {
    profile: { displayName, householdSize, cookingSkill },
    preferences: completion.preferences,
    slotCookingTimes: completion.slotCookingTimes,
    timezone: 'America/Argentina/Buenos_Aires',
  };
}

// The response body is the frozen fixture the api controller test pins.
describe('onboardingApi', () => {
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

  it('POSTs /api/onboarding/complete with the stored token and returns the saved groups', async () => {
    const payload = requestFor();
    fetchMock.mockReturnValueOnce(mockJsonResponse(onboardingCompletionFixture));

    const result = await completeOnboarding(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/onboarding/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(result).toEqual(fixtureOnboardingCompletion());
    expect(result.user.onboardingCompletedAt).toBe(
      onboardingCompletionFixture.user.onboardingCompletedAt
    );
  });

  it('sends the token it is given instead of the stored one', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(onboardingCompletionFixture));

    await completeOnboarding('access-2', requestFor());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/onboarding/complete',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-2' }),
      })
    );
  });
});
