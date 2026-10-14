import {
  getStoredSession,
  persistProfileForStoredSession,
  persistSession,
} from '@/api/authTokenStore';
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

  // `completeOnboarding` reads a non-null `refreshCurrentSession()` as "a GET
  // /api/me succeeded" (issue #216), so the service has to keep that promise.
  describe('refreshCurrentSession freshness', () => {
    const refreshedTokens = {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      tokenType: 'Bearer',
    };

    // The profile fields the completion answer wrote into the stored snapshot.
    async function storeCompletionAnswer() {
      const { user } = fixtureCurrentMe();
      const answer = {
        ...user,
        displayName: 'Completion answer',
        householdSize: 5,
        cookingSkill: 'advanced' as const,
      };
      await persistProfileForStoredSession(answer);
      return answer;
    }

    it('overwrites the stored completion answer with what a fresh /me returned', async () => {
      const answer = await storeCompletionAnswer();
      expect((await getStoredSession())?.me.user).toEqual(answer);

      const fresh = fixtureCurrentMe();
      fresh.user = {
        ...fresh.user,
        displayName: 'Fresh name',
        householdSize: 3,
        cookingSkill: 'beginner',
      };
      fetchMock
        .mockReturnValueOnce(mockJsonResponse(refreshedTokens))
        .mockReturnValueOnce(mockJsonResponse(fresh));

      const session = await refreshCurrentSession();

      expect(session?.me.user).toEqual(fresh.user);
      expect(session?.me.user).not.toEqual(answer);
      expect((await getStoredSession())?.me.user).toEqual(fresh.user);
      const [url, init] = fetchMock.mock.calls[1];
      expect(String(url)).toMatch(/\/api\/me$/);
      expect(init.method).toBe('GET');
    });

    // A resolved session means a GET /api/me answered: when it fails, the
    // call rejects instead of handing back the stored snapshot.
    it.each([
      {
        when: 'answers 500',
        error: { code: 'unknown_error', status: 500 },
        meResponse: () =>
          Promise.resolve({
            ok: false,
            status: 500,
            text: () =>
              Promise.resolve(
                JSON.stringify({ error: { code: 'internal_error', message: 'boom' } })
              ),
          } as Response),
      },
      {
        when: 'is unreachable',
        error: { code: 'network_error' },
        meResponse: () => Promise.reject(new TypeError('Network request failed')),
      },
    ])('rejects without storing a snapshot when /me $when', async ({ error, meResponse }) => {
      const answer = await storeCompletionAnswer();
      fetchMock
        .mockReturnValueOnce(mockJsonResponse(refreshedTokens))
        .mockImplementation(meResponse);

      await expect(refreshCurrentSession()).rejects.toMatchObject(error);

      expect((await getStoredSession())?.me.user).toEqual(answer);
    });

    it('resolves null without any request when no session is stored', async () => {
      mockSecureStore.clear();

      await expect(refreshCurrentSession()).resolves.toBeNull();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
