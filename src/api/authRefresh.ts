import type { AuthSession } from '@/features/auth/types/auth';
import { clearSession, getRefreshToken, persistTokens } from './authTokenStore';
import { ApiError, isSessionInvalidAuthError } from './errors';
import { rawApiRequest, REFRESH_REQUEST_TIMEOUT_MS } from './transport';

export type RefreshResponse = Pick<AuthSession, 'accessToken' | 'refreshToken' | 'tokenType'>;

let refreshInFlight: Promise<RefreshResponse> | null = null;
let refreshInFlightToken: string | null = null;

export async function refreshTokens(refreshToken?: string | null): Promise<RefreshResponse> {
  const token = refreshToken ?? (await getRefreshToken());
  if (!token) {
    await clearSession();
    throw new ApiError('unauthenticated', 'No refresh token available.', 401);
  }

  if (refreshInFlight && refreshInFlightToken === token) return refreshInFlight;

  refreshInFlightToken = token;
  refreshInFlight = refreshTokensOnce(token).finally(() => {
    if (refreshInFlightToken === token) {
      refreshInFlight = null;
      refreshInFlightToken = null;
    }
  });

  return refreshInFlight;
}

async function refreshTokensOnce(token: string): Promise<RefreshResponse> {
  try {
    const tokens = await rawApiRequest<RefreshResponse>('/api/auth/refresh', {
      init: {
        method: 'POST',
        body: JSON.stringify({ refreshToken: token }),
      },
      timeoutMs: REFRESH_REQUEST_TIMEOUT_MS,
      retry: false,
    });
    await persistTokens(tokens);
    return tokens;
  } catch (error) {
    if (isSessionInvalidAuthError(error)) {
      await clearSession();
    }
    throw error;
  }
}

export function __resetRefreshInFlightForTests(): void {
  refreshInFlight = null;
  refreshInFlightToken = null;
}
