/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CurrentMe } from '@/features/auth/types/auth';
import * as authService from '../authService';

const mockNewRequestId = jest.fn(() => '123e4567-e89b-42d3-a456-426614174000');

jest.mock('../requestId', () => ({
  newRequestId: () => mockNewRequestId(),
}));

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
  user: {
    id: 'user-1',
    email: 'user@example.com',
    displayName: null,
    householdSize: null,
    cookingSkill: null,
  },
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

const completeMe: CurrentMe = {
  ...me,
  onboarding: { isComplete: true },
};

// The /api/me shape before the backend ships the profile fields.
const meWithoutProfileFields = {
  ...me,
  user: { id: 'user-1', email: 'user@example.com', displayName: null },
};

function mockJsonResponse(payload: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

function fetchHeadersAt(callIndex: number): HeadersInit | undefined {
  return (fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined)?.headers;
}

/**
 * The codes the planning channel replies (issue #11), read from the api
 * allowlist instead of being listed a third time on the mobile side: they are
 * the rows of `@codes` in `ApiError` that follow the "Planning channel"
 * comment. The api source is a read-only fixture, as in
 * `authErrorCodeContract.test.ts`.
 */
function planningChannelErrorCodes(): string[] {
  const apiErrorPath = path.resolve(
    __dirname,
    '../../../../api/lib/meal_planner_api_web/controllers/api_error.ex'
  );
  const source = fs.readFileSync(apiErrorPath, 'utf8');
  const rows = source.match(/# Planning channel \(issue #11\)([\s\S]*?)\n {2}\}/);

  return [...(rows?.[1] ?? '').matchAll(/^ {4}([a-z_]+):/gm)].map((row) => row[1]);
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fetchMock = jest.fn();

describe('authService', () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    mockSecureStore.clear();
    fetchMock.mockReset();
    mockNewRequestId.mockClear();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
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

  it('sends a UUID v4 X-Request-Id header on each API request', async () => {
    mockNewRequestId
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000')
      .mockReturnValueOnce('987e6543-e21b-42d3-b456-426614174999');
    fetchMock
      .mockReturnValueOnce(mockJsonResponse(me))
      .mockReturnValueOnce(mockJsonResponse({ status: 'code_sent', expiresInSeconds: 600 }));

    await authService.getMe('access-1');
    await authService.requestVerificationCode('user@example.com', 'login');

    const firstHeaders = fetchHeadersAt(0);
    const secondHeaders = fetchHeadersAt(1);

    expect(firstHeaders).toEqual(
      expect.objectContaining({ 'X-Request-Id': '123e4567-e89b-42d3-a456-426614174000' })
    );
    expect(secondHeaders).toEqual(
      expect.objectContaining({ 'X-Request-Id': '987e6543-e21b-42d3-b456-426614174999' })
    );
    expect((firstHeaders as Record<string, string>)['X-Request-Id']).toMatch(UUID_V4_REGEX);
    expect((secondHeaders as Record<string, string>)['X-Request-Id']).toMatch(UUID_V4_REGEX);
    expect(mockNewRequestId).toHaveBeenCalledTimes(2);
  });

  it('lets explicit caller headers override the generated X-Request-Id', async () => {
    mockNewRequestId.mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000');
    fetchMock.mockReturnValueOnce(mockJsonResponse(me));

    await authService.getMe('access-1', {
      headers: { 'X-Request-Id': '987e6543-e21b-42d3-b456-426614174999' },
    });

    expect(fetchHeadersAt(0)).toEqual(
      expect.objectContaining({ 'X-Request-Id': '987e6543-e21b-42d3-b456-426614174999' })
    );
  });

  it('forwards caller headers in getUserPreferences', async () => {
    mockNewRequestId.mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000');
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({ dislikedIngredients: [], likedIngredients: [] })
    );

    await authService.getUserPreferences('access-1', {
      headers: { 'X-Custom-Header': 'custom-value' },
    });

    expect(fetchHeadersAt(0)).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer access-1',
        'X-Custom-Header': 'custom-value',
      })
    );
  });

  it('forwards caller headers in getSlotCookingTimes', async () => {
    mockNewRequestId.mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000');
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({
        breakfast: null,
        lunch: null,
        dinner: null,
        snack: null,
      })
    );

    await authService.getSlotCookingTimes('access-1', {
      headers: { 'X-Custom-Header': 'custom-value' },
    });

    expect(fetchHeadersAt(0)).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer access-1',
        'X-Custom-Header': 'custom-value',
      })
    );
  });

  it('strips a caller-supplied Authorization header so the auth layer keeps ownership', async () => {
    mockNewRequestId.mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000');
    fetchMock.mockReturnValueOnce(mockJsonResponse(me));

    await authService.getMe('access-1', {
      // Caller attempts to override the Bearer token. The defensive guard
      // MUST drop this field so the server still receives the correct token.
      headers: { Authorization: 'Bearer attacker-controlled-token' },
    });

    const sentHeaders = fetchHeadersAt(0) as Record<string, string>;
    expect(sentHeaders.Authorization).toBe('Bearer access-1');
    expect(sentHeaders.Authorization).not.toBe('Bearer attacker-controlled-token');
  });

  it('strips a lowercase caller-supplied authorization header (case-insensitive)', async () => {
    mockNewRequestId.mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000');
    fetchMock.mockReturnValueOnce(mockJsonResponse(me));

    await authService.getMe('access-1', {
      headers: { authorization: 'Bearer attacker-controlled-token' },
    });

    const sentHeaders = fetchHeadersAt(0) as Record<string, string>;
    expect(sentHeaders.Authorization).toBe('Bearer access-1');
    expect(sentHeaders.authorization).toBeUndefined();
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

  it('reaches login verification when the React Native runtime has no crypto API', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        tokenType: 'Bearer',
        me,
      })
    );

    await authService.verifyAndSignIn('user@example.com', '123456');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/login/verify-code',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"code":"123456"'),
      })
    );
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
    // getMe now retries once on transient errors, so mock both attempts.
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));

    const session = await authService.restoreSessionWithFreshMe();

    expect(session).toMatchObject({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      me,
    });
    await expect(authService.getStoredSession()).resolves.toMatchObject({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      me,
    });
  });

  it('restores local onboarding completion when the next /me response is stale for the same user', async () => {
    await authService.persistSession({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      tokenType: 'Bearer',
      me,
    });
    await authService.persistOnboardingCompletionForStoredSession();

    fetchMock.mockReturnValueOnce(mockJsonResponse(me));

    const session = await authService.restoreSessionWithFreshMe();

    expect(session?.me.onboarding.isComplete).toBe(true);
    await expect(authService.getStoredSession()).resolves.toMatchObject({
      me: { onboarding: { isComplete: true } },
    });
  });

  it('restores local onboarding completion while offline after completion was persisted', async () => {
    await authService.persistSession({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      tokenType: 'Bearer',
      me,
    });
    await authService.persistOnboardingCompletionForStoredSession();
    // getMe now retries once on transient errors, so mock both attempts.
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));

    const session = await authService.restoreSessionWithFreshMe();

    expect(session).toMatchObject({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
      me: { onboarding: { isComplete: true } },
    });
  });

  it('does not apply local onboarding completion to a different user', async () => {
    await authService.persistSession({
      accessToken: 'complete-access',
      refreshToken: 'complete-refresh',
      tokenType: 'Bearer',
      me: completeMe,
    });

    const otherUserMe: CurrentMe = {
      ...me,
      user: { ...me.user, id: 'user-2', email: 'other@example.com' },
    };
    await authService.persistSession({
      accessToken: 'other-access',
      refreshToken: 'other-refresh',
      tokenType: 'Bearer',
      me: otherUserMe,
    });

    await expect(authService.getStoredSession()).resolves.toMatchObject({
      accessToken: 'other-access',
      me: {
        user: { id: 'user-2' },
        onboarding: { isComplete: false },
      },
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

  describe('planning channel error codes (issue #11)', () => {
    const channelCodes = planningChannelErrorCodes();

    it('reads the channel codes from the api allowlist', () => {
      // Guards the table below against an extractor that silently finds
      // nothing, or only part of the rows.
      expect(channelCodes).toHaveLength(29);
      expect(new Set(channelCodes).size).toBe(29);
      expect(channelCodes[0]).toBe('generation_in_progress');
      expect(channelCodes[28]).toBe('optimizer_timeout');
    });

    it.each(channelCodes)(
      'passes the %s code through instead of collapsing it to unknown_error',
      async (code) => {
        const message = `Server text for ${code}`;
        fetchMock.mockReturnValueOnce(mockJsonResponse({ error: { code, message } }, false, 422));

        await expect(
          authService.requestVerificationCode('user@example.com', 'login')
        ).rejects.toMatchObject({ code, message, status: 422 });
      }
    );
  });

  it('fails clearly when EXPO_PUBLIC_API_URL is missing', async () => {
    process.env.EXPO_PUBLIC_API_URL = '';

    await expect(
      authService.requestVerificationCode('user@example.com', 'login')
    ).rejects.toMatchObject({
      code: 'configuration_error',
    });
  });

  describe('apiRequest timeout (AbortController)', () => {
    it('aborts the request and throws a transient AuthApiError when the server never responds', async () => {
      // The mock honors the AbortSignal so the production timeout actually
      // triggers an abort the same way a real fetch would.
      fetchMock.mockImplementationOnce(
        (_url: unknown, init: RequestInit | undefined) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              if (signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
              }
              signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }
          })
      );

      const start = Date.now();
      await expect(
        authService.getMe('access-1', { timeoutMs: 100, retry: false })
      ).rejects.toMatchObject({
        name: 'AuthApiError',
        code: 'timeout',
      });
      const elapsed = Date.now() - start;

      // The abort must happen close to the 100ms timeout, not block forever.
      expect(elapsed).toBeLessThan(1000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The AbortController signal MUST be passed to fetch.
      const callArgs = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(callArgs?.signal).toBeDefined();
    });

    it('cleans up the timeout after a successful response (no leaked timers)', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(me));

      const result = await authService.getMe('access-1', {
        timeoutMs: 60_000,
        retry: false,
      });

      expect(result).toEqual(me);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The signal MUST be passed to fetch on the happy path too.
      const callArgs = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(callArgs?.signal).toBeDefined();
    });

    it('classifies timeout errors as transient so callers can retry', () => {
      const timeoutError = new authService.AuthApiError('timeout', 'Request timeout');
      const networkError = new authService.AuthApiError('network_error', 'offline');

      expect(authService.isTransientAuthError(timeoutError)).toBe(true);
      expect(authService.isTransientAuthError(networkError)).toBe(true);
      expect(
        authService.isTransientAuthError(new authService.AuthApiError('code_invalid', 'x'))
      ).toBe(false);
    });
  });

  describe('getDeviceId', () => {
    const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    it('returns a UUID v4 on first call and the same value on subsequent calls (persisted via SecureStore)', async () => {
      // After Item 5, getDeviceId must use a real UUID generator instead of
      // `expo-${Date.now()}-...`. The pre-Item-5 implementation produced a
      // non-UUID string that would fail a v4 regex check.
      const first = await authService.getDeviceId();
      const second = await authService.getDeviceId();

      expect(first).toMatch(UUID_V4_REGEX);
      expect(second).toBe(first);
    });

    it('produces a different UUID each time storage is empty', async () => {
      mockNewRequestId
        .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174000')
        .mockReturnValueOnce('987e6543-e21b-42d3-b456-426614174999');
      // Two independent test runs (each starts with an empty mock store)
      // should produce two different UUIDs. UUID v4 has ~5.3×10³⁶
      // possible values, so a collision is astronomically unlikely.
      mockSecureStore.clear();
      const a = await authService.getDeviceId();

      mockSecureStore.clear();
      const b = await authService.getDeviceId();

      expect(a).toMatch(UUID_V4_REGEX);
      expect(b).toMatch(UUID_V4_REGEX);
      expect(a).not.toBe(b);
    });
  });

  describe('isSessionInvalidAuthError', () => {
    it('returns true for refresh_token_session_mismatch so a future device-revoke flow clears the local session', () => {
      // refresh_token_session_mismatch is in KNOWN_AUTH_ERROR_CODES (so the
      // user sees a Spanish message) but, until now, it was missing from
      // SESSION_INVALID_AUTH_ERROR_CODES. Any future code path that surfaces
      // this code outside of signOut — e.g. a device-revoke endpoint — must
      // also clear the local session, otherwise the user would be silently
      // logged out server-side while remaining "logged in" locally.
      const error = new authService.AuthApiError(
        'refresh_token_session_mismatch',
        'session mismatch',
        401
      );

      expect(authService.isSessionInvalidAuthError(error)).toBe(true);
    });

    it('returns true for the other session-invalid codes already covered', () => {
      const codes = [
        'refresh_token_invalid',
        'refresh_token_revoked',
        'refresh_token_replayed',
        'refresh_token_expired',
      ] as const;
      for (const code of codes) {
        const error = new authService.AuthApiError(code, code, 401);
        expect(authService.isSessionInvalidAuthError(error)).toBe(true);
      }
    });

    it('returns false for codes that should NOT clear the local session', () => {
      const codes = [
        'access_token_expired',
        'unauthenticated',
        'code_invalid',
        'network_error',
      ] as const;
      for (const code of codes) {
        const error = new authService.AuthApiError(code, code, 401);
        expect(authService.isSessionInvalidAuthError(error)).toBe(false);
      }
    });
  });

  describe('profile fields on me', () => {
    it('reads household size and cooking skill from /api/me when the backend sends them', async () => {
      const meWithProfile: CurrentMe = {
        ...me,
        user: { ...me.user, householdSize: 3, cookingSkill: 'advanced' },
      };
      fetchMock.mockReturnValueOnce(mockJsonResponse(meWithProfile));

      await expect(authService.getMe('access-1')).resolves.toEqual(meWithProfile);
    });

    it('fills the profile fields with null when /api/me omits them', async () => {
      fetchMock.mockReturnValueOnce(mockJsonResponse(meWithoutProfileFields));

      const result = await authService.getMe('access-1');

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'user@example.com',
        displayName: null,
        householdSize: null,
        cookingSkill: null,
      });
    });

    it('fills the profile fields with null on the session returned by code verification', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          tokenType: 'Bearer',
          me: meWithoutProfileFields,
        })
      );

      const session = await authService.verifyAndSignIn('user@example.com', '123456');

      expect(session.me.user.householdSize).toBeNull();
      expect(session.me.user.cookingSkill).toBeNull();
    });

    it('fills the profile fields with null on a session stored before they existed', async () => {
      mockSecureStore.set('auth_access_token', 'stored-access');
      mockSecureStore.set('auth_refresh_token', 'stored-refresh');
      mockSecureStore.set('auth_me', JSON.stringify(meWithoutProfileFields));

      const session = await authService.getStoredSession();

      expect(session?.me.user.householdSize).toBeNull();
      expect(session?.me.user.cookingSkill).toBeNull();
    });

    it('writes an updated profile to the stored session and keeps the rest of it', async () => {
      await authService.persistSession({
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        tokenType: 'Bearer',
        me: completeMe,
      });

      const session = await authService.persistProfileForStoredSession({
        id: 'user-1',
        email: 'user@example.com',
        displayName: 'Lucca Giordana',
        householdSize: 2,
        cookingSkill: 'intermediate',
      });

      const expectedMe: CurrentMe = {
        ...completeMe,
        user: {
          ...completeMe.user,
          displayName: 'Lucca Giordana',
          householdSize: 2,
          cookingSkill: 'intermediate',
        },
      };
      expect(session?.me).toEqual(expectedMe);
      await expect(authService.getStoredSession()).resolves.toEqual({
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        tokenType: 'Bearer',
        me: expectedMe,
      });
    });

    it('rewrites only the me snapshot so a concurrent token rotation is not overwritten', async () => {
      await authService.persistSession({
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        tokenType: 'Bearer',
        me,
      });
      const { setItemAsync } = jest.requireMock('expo-secure-store') as {
        setItemAsync: jest.Mock;
      };
      setItemAsync.mockClear();

      await authService.persistProfileForStoredSession({
        id: 'user-1',
        email: 'user@example.com',
        displayName: 'Lucca',
        householdSize: 1,
        cookingSkill: 'beginner',
      });

      expect(setItemAsync.mock.calls.map(([key]) => key)).toEqual(['auth_me']);
    });

    it('does not write a profile that belongs to another user or to no session', async () => {
      const otherUser = {
        id: 'user-2',
        email: 'other@example.com',
        displayName: 'Other',
        householdSize: 5,
        cookingSkill: 'advanced' as const,
      };

      await expect(authService.persistProfileForStoredSession(otherUser)).resolves.toBeNull();

      await authService.persistSession({
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        tokenType: 'Bearer',
        me,
      });

      await expect(authService.persistProfileForStoredSession(otherUser)).resolves.toBeNull();
      await expect(authService.getStoredSession()).resolves.toMatchObject({ me });
    });
  });

  describe('single-attempt retry on transient errors', () => {
    it('retries getMe once on a transient network error and returns the successful response', async () => {
      mockNewRequestId
        .mockReturnValueOnce('111e4567-e89b-42d3-a456-426614174000')
        .mockReturnValueOnce('222e4567-e89b-42d3-a456-426614174000');
      fetchMock
        .mockRejectedValueOnce(new Error('offline'))
        .mockReturnValueOnce(mockJsonResponse(me));

      const result = await authService.getMe('access-1');

      expect(result).toEqual(me);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Both attempts MUST hit /api/me with a fresh AbortController signal.
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.test/api/me');
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.test/api/me');
      // The retry MUST use a fresh X-Request-Id so server-side traces can
      // distinguish the two attempts and avoid deduplicating them.
      const firstId = (fetchHeadersAt(0) as Record<string, string>)['X-Request-Id'];
      const secondId = (fetchHeadersAt(1) as Record<string, string>)['X-Request-Id'];
      expect(firstId).toBe('111e4567-e89b-42d3-a456-426614174000');
      expect(secondId).toBe('222e4567-e89b-42d3-a456-426614174000');
      expect(secondId).not.toBe(firstId);
      expect(mockNewRequestId).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry refreshTokens when the first attempt hits a transient error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'));

      await expect(authService.refreshTokens('refresh-1')).rejects.toMatchObject({
        code: 'network_error',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws a typed unauthenticated error when refreshing without a refresh token', async () => {
      await expect(authService.refreshTokens()).rejects.toMatchObject({
        name: 'AuthApiError',
        code: 'unauthenticated',
        status: 401,
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does NOT retry verifyCode when the first attempt hits a transient error (OTP could be consumed)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'));

      await expect(authService.verifyAndSignIn('user@example.com', '000000')).rejects.toMatchObject(
        { code: 'network_error' }
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry logout when the first attempt hits a transient error', async () => {
      await authService.persistSession({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        tokenType: 'Bearer',
        me,
      });
      fetchMock.mockRejectedValueOnce(new Error('offline'));

      await expect(authService.logout('access-1', 'refresh-1')).rejects.toMatchObject({
        code: 'network_error',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry when the first attempt fails with a non-transient error (e.g. code_invalid)', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({ error: { code: 'code_invalid', message: 'x' } }, false, 422)
      );

      await expect(authService.getMe('access-1')).rejects.toMatchObject({ code: 'code_invalid' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('surfaces the error after retrying once when both attempts hit transient failures', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('offline-2'));

      await expect(authService.getMe('access-1')).rejects.toMatchObject({ code: 'network_error' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('refresh coordination', () => {
    it('deduplicates concurrent refreshTokens calls so a rotating refresh token is used once', async () => {
      fetchMock.mockReturnValueOnce(
        mockJsonResponse({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          tokenType: 'Bearer',
        })
      );

      const [first, second] = await Promise.all([
        authService.refreshTokens('refresh-1'),
        authService.refreshTokens('refresh-1'),
      ]);

      expect(first).toEqual(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.test/api/auth/refresh',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ refreshToken: 'refresh-1' }),
        })
      );
    });

    it('replays an authenticated client request once after a deduped refresh', async () => {
      await authService.persistSession({
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        tokenType: 'Bearer',
        me,
      });
      fetchMock
        .mockReturnValueOnce(
          mockJsonResponse(
            { error: { code: 'access_token_expired', message: 'expired' } },
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
        .mockReturnValueOnce(
          mockJsonResponse({ diet: null, hardRestrictions: [], softPreferences: [] })
        );

      const result = await authService.getUserPreferences();

      expect(result).toEqual({ diet: null, hardRestrictions: [], softPreferences: [] });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.test/api/me/preferences');
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.test/api/auth/refresh');
      expect(fetchMock.mock.calls[2]?.[0]).toBe('https://api.example.test/api/me/preferences');
      expect(fetchHeadersAt(2)).toEqual(
        expect.objectContaining({ Authorization: 'Bearer new-access' })
      );
      await expect(authService.getStoredSession()).resolves.toMatchObject({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
    });

    it('deduplicates refresh and replays both concurrent authenticated 401 responses with the rotated access token', async () => {
      await authService.persistSession({
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        tokenType: 'Bearer',
        me,
      });
      const prefs = { diet: null, hardRestrictions: [], softPreferences: [] };
      fetchMock
        .mockReturnValueOnce(
          mockJsonResponse(
            { error: { code: 'access_token_expired', message: 'expired' } },
            false,
            401
          )
        )
        .mockReturnValueOnce(
          mockJsonResponse({ error: { code: 'unauthenticated', message: 'expired' } }, false, 401)
        )
        .mockReturnValueOnce(
          mockJsonResponse({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            tokenType: 'Bearer',
          })
        )
        .mockReturnValueOnce(mockJsonResponse(prefs))
        .mockReturnValueOnce(mockJsonResponse(prefs));

      const [first, second] = await Promise.all([
        authService.getUserPreferences(),
        authService.getUserPreferences(),
      ]);

      expect(first).toEqual(prefs);
      expect(second).toEqual(prefs);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        'https://api.example.test/api/me/preferences',
        'https://api.example.test/api/me/preferences',
        'https://api.example.test/api/auth/refresh',
        'https://api.example.test/api/me/preferences',
        'https://api.example.test/api/me/preferences',
      ]);
      expect(fetchHeadersAt(0)).toEqual(
        expect.objectContaining({ Authorization: 'Bearer old-access' })
      );
      expect(fetchHeadersAt(1)).toEqual(
        expect.objectContaining({ Authorization: 'Bearer old-access' })
      );
      expect(fetchHeadersAt(3)).toEqual(
        expect.objectContaining({ Authorization: 'Bearer new-access' })
      );
      expect(fetchHeadersAt(4)).toEqual(
        expect.objectContaining({ Authorization: 'Bearer new-access' })
      );
      await expect(authService.getStoredSession()).resolves.toMatchObject({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
    });
  });
});
