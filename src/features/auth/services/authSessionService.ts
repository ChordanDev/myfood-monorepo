import { refreshTokens } from '@/api/authRefresh';
import {
  clearSession,
  getCompletedOnboardingUserId,
  getStoredSession,
  persistSession,
  withLocalOnboardingCompletion,
} from '@/api/authTokenStore';
import {
  isRefreshableAuthError,
  isSessionInvalidAuthError,
  isTransientAuthError,
} from '@/api/errors';
import { getMe } from '../api/authApi';
import type { AuthSession, CurrentMe } from '../types/auth';
import { withPreservedProfileFields } from '../utils/currentMe';

// Every fresh /me goes through here: the local completion flag and the
// profile fields the server does not serve yet both come from the stored
// snapshot.
function withLocalState(me: CurrentMe, stored: CurrentMe | null, completedUserId: string | null) {
  return withPreservedProfileFields(withLocalOnboardingCompletion(me, completedUserId), stored);
}

export async function restoreSessionWithFreshMe(): Promise<AuthSession | null> {
  const storedSession = await getStoredSession();
  if (!storedSession) return null;

  try {
    const me = await getMe();
    const completedUserId = await getCompletedOnboardingUserId();
    const latestSession = (await getStoredSession()) ?? storedSession;
    const freshSession = {
      ...latestSession,
      me: withLocalState(me, latestSession.me, completedUserId),
    };
    await persistSession(freshSession);
    return freshSession;
  } catch (error) {
    if (isTransientAuthError(error)) {
      return storedSession;
    }

    if (!isRefreshableAuthError(error)) {
      throw error;
    }
  }

  try {
    const tokens = await refreshTokens(storedSession.refreshToken);
    const me = await getMe();
    const completedUserId = await getCompletedOnboardingUserId();
    const refreshedSession: AuthSession = {
      ...tokens,
      me: withLocalState(me, storedSession.me, completedUserId),
    };
    await persistSession(refreshedSession);
    return refreshedSession;
  } catch (error) {
    if (isTransientAuthError(error)) {
      return storedSession;
    }

    if (isSessionInvalidAuthError(error)) {
      await clearSession();
      return null;
    }

    throw error;
  }
}

export async function refreshCurrentSession(): Promise<AuthSession | null> {
  const storedSession = await getStoredSession();
  if (!storedSession) return null;

  const tokens = await refreshTokens(storedSession.refreshToken);
  const me = await getMe();
  const completedUserId = await getCompletedOnboardingUserId();
  const session: AuthSession = {
    ...tokens,
    me: withLocalState(me, storedSession.me, completedUserId),
  };
  await persistSession(session);
  return session;
}
