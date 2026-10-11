import { getStoredSession, persistSession } from '@/api/authTokenStore';
import { fixtureCurrentMe, fixtureCurrentMeBeforeOnboarding } from '../../fixtures/currentMe';
import { refreshCurrentSession, restoreSessionWithFreshMe } from '../authSessionService';

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

const fetchMock = jest.fn();

describe('authSessionService', () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(async () => {
    mockSecureStore.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';

    // The stored snapshot carries a household size and a cooking skill.
    await persistSession({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      tokenType: 'Bearer',
      me: fixtureCurrentMe(),
    });
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  // The server is the only source of the profile fields: null in a fresh
  // /me means "not set", whatever the stored snapshot of the same user says.
  it('restores the session with the null profile fields a fresh /me sends', async () => {
    const fresh = fixtureCurrentMeBeforeOnboarding();
    expect(fresh.user.id).toBe(fixtureCurrentMe().user.id);
    fetchMock.mockReturnValueOnce(mockJsonResponse(fresh));

    const session = await restoreSessionWithFreshMe();

    expect(session?.me.user).toEqual(fresh.user);
    expect(session?.me.user.householdSize).toBeNull();
    expect(session?.me.user.cookingSkill).toBeNull();
    expect((await getStoredSession())?.me.user).toEqual(fresh.user);
  });

  it('refreshes the session with the null profile fields a fresh /me sends', async () => {
    const fresh = fixtureCurrentMeBeforeOnboarding();
    fetchMock
      .mockReturnValueOnce(
        mockJsonResponse({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          tokenType: 'Bearer',
        })
      )
      .mockReturnValueOnce(mockJsonResponse(fresh));

    const session = await refreshCurrentSession();

    expect(session?.accessToken).toBe('new-access');
    expect(session?.me.user).toEqual(fresh.user);
    expect((await getStoredSession())?.me.user).toEqual(fresh.user);
  });

  it('keeps the profile fields a fresh /me sends', async () => {
    const fresh = fixtureCurrentMe();
    fetchMock.mockReturnValueOnce(mockJsonResponse(fresh));

    const session = await restoreSessionWithFreshMe();

    expect(session?.me).toEqual(fresh);
  });
});
