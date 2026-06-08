import type { CurrentMe } from '@/features/auth/types/auth';
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

const me: CurrentMe = {
  user: { id: 'user-1', email: 'user@example.com', displayName: null },
  account: {
    id: 'account-1',
    type: 'individual',
    trialEndsAt: '2026-06-14T00:00:00Z',
    subscriptionStatus: 'none',
    access: { canUseApp: true, reason: null },
  },
  membership: { role: 'owner' },
  onboarding: { isComplete: false },
};

function mockJsonResponse(payload: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

describe('authService', () => {
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

  it('calls the login request-code endpoint and returns backend cooldown', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({
        status: 'code_sent',
        expiresInSeconds: 600,
        resendAvailableInSeconds: 60,
      })
    );

    const response = await authService.requestVerificationCode('user@example.com', 'login');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/login/request-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      })
    );
    expect(response.resendAvailableInSeconds).toBe(60);
  });

  it('stores access token, refresh token, and me after signup verification', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        tokenType: 'Bearer',
        me,
      })
    );

    const session = await authService.verifyAndSignUp('user@example.com', '123456');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/signup/verify-code',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"code":"123456"'),
      })
    );
    expect(session.me.account.access.canUseApp).toBe(true);
    await expect(authService.getStoredSession()).resolves.toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      me,
    });
  });

  it('refreshes with rotation, persists the new refresh token, and then reloads /me', async () => {
    await authService.persistSession({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      tokenType: 'Bearer',
      me,
    });
    fetchMock
      .mockReturnValueOnce(
        mockJsonResponse(
          {
            error: { code: 'access_token_expired', message: 'expired' },
          },
          false,
          401
        )
      )
      .mockReturnValueOnce(
        mockJsonResponse({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          tokenType: 'Bearer',
        })
      )
      .mockReturnValueOnce(mockJsonResponse(me));

    const session = await authService.restoreSessionWithFreshMe();

    expect(session?.accessToken).toBe('new-access');
    expect(session?.refreshToken).toBe('new-refresh');
    await expect(authService.getStoredSession()).resolves.toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('preserves the stored session when /me fails because the network is unavailable', async () => {
    await authService.persistSession({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      tokenType: 'Bearer',
      me,
    });
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const session = await authService.restoreSessionWithFreshMe();

    expect(session).toMatchObject({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      me,
    });
    await expect(authService.getStoredSession()).resolves.toMatchObject({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
    });
  });

  it('sends the refresh token with logout when available', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(null));

    await authService.logout('access-1', 'refresh-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'refresh-1' }),
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
  });

  it('throws stable AuthApiError codes from backend envelopes', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({ error: { code: 'code_invalid', message: 'Code invalid' } }, false, 422)
    );

    await expect(authService.verifyAndSignIn('user@example.com', '000000')).rejects.toMatchObject({
      code: 'code_invalid',
      status: 422,
    });
  });

  it('normalizes unknown backend error codes instead of surfacing arbitrary messages', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse(
        { error: { code: 'unexpected_backend_code', message: 'Internal implementation detail' } },
        false,
        500
      )
    );

    await expect(
      authService.requestVerificationCode('user@example.com', 'login')
    ).rejects.toMatchObject({
      code: 'unknown_error',
      message: 'Request failed',
      status: 500,
    });
  });

  it('fails clearly when EXPO_PUBLIC_API_URL is missing', async () => {
    process.env.EXPO_PUBLIC_API_URL = '';

    await expect(
      authService.requestVerificationCode('user@example.com', 'login')
    ).rejects.toMatchObject({
      code: 'configuration_error',
    });
  });
});
