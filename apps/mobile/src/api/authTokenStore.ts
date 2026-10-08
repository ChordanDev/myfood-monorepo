import type {
  AuthSession,
  CurrentMe,
  ProfileUpdateUser,
  StoredAuthSession,
} from '@/features/auth/types/auth';
import { normalizeCurrentMe, withUpdatedProfile } from '@/features/auth/utils/currentMe';
import { secureStorage } from '@/services/secureStorage';
import { newRequestId } from '@/services/requestId';

export const ACCESS_TOKEN_KEY = 'auth_access_token';
export const REFRESH_TOKEN_KEY = 'auth_refresh_token';
export const ME_KEY = 'auth_me';
export const ONBOARDING_COMPLETED_USER_ID_KEY = 'auth_onboarding_completed_user_id';
export const DEVICE_ID_KEY = 'auth_device_id';

type TokenPair = Pick<AuthSession, 'accessToken' | 'refreshToken' | 'tokenType'>;

type AccessTokenListener = (accessToken: string | null) => void;

const accessTokenListeners = new Set<AccessTokenListener>();

/**
 * Subscribes to access token changes: the listener receives the new token
 * once tokens are persisted and `null` once the session is cleared. Returns
 * the function that removes the subscription.
 */
export function subscribeToAccessToken(listener: AccessTokenListener): () => void {
  accessTokenListeners.add(listener);
  return () => {
    accessTokenListeners.delete(listener);
  };
}

function notifyAccessToken(accessToken: string | null): void {
  for (const listener of accessTokenListeners) {
    try {
      listener(accessToken);
    } catch {
      // The tokens are already stored: a failing listener must not fail the write.
    }
  }
}

export function withLocalOnboardingCompletion(
  me: CurrentMe,
  completedUserId: string | null
): CurrentMe {
  if (completedUserId !== me.user.id) return me;
  return {
    ...me,
    onboarding: { ...me.onboarding, isComplete: true },
  };
}

export async function getAccessToken(): Promise<string | null> {
  return secureStorage.getItem(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return secureStorage.getItem(REFRESH_TOKEN_KEY);
}

export async function getCompletedOnboardingUserId(): Promise<string | null> {
  return secureStorage.getItem(ONBOARDING_COMPLETED_USER_ID_KEY);
}

export async function persistTokens(tokens: TokenPair): Promise<void> {
  await secureStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  await secureStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  notifyAccessToken(tokens.accessToken);
}

export async function persistSession(session: AuthSession): Promise<void> {
  const completedUserId = await secureStorage.getItem(ONBOARDING_COMPLETED_USER_ID_KEY);
  const shouldPersistLocalCompletion = session.me.onboarding.isComplete;
  const shouldApplyLocalCompletion = completedUserId === session.me.user.id;
  const me = withLocalOnboardingCompletion(session.me, completedUserId);

  await persistTokens(session);
  await secureStorage.setItem(ME_KEY, JSON.stringify(me));

  if (shouldPersistLocalCompletion || shouldApplyLocalCompletion) {
    await secureStorage.setItem(ONBOARDING_COMPLETED_USER_ID_KEY, session.me.user.id);
  } else if (completedUserId && completedUserId !== session.me.user.id) {
    await secureStorage.deleteItem(ONBOARDING_COMPLETED_USER_ID_KEY);
  }
}

export async function persistOnboardingCompletionForStoredSession(): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredSession();
  if (!storedSession) return null;

  const completedSession: StoredAuthSession = {
    ...storedSession,
    me: {
      ...storedSession.me,
      onboarding: { ...storedSession.me.onboarding, isComplete: true },
    },
  };
  await secureStorage.setItem(ONBOARDING_COMPLETED_USER_ID_KEY, storedSession.me.user.id);
  await persistSession(completedSession);
  return completedSession;
}

export async function persistProfileForStoredSession(
  user: ProfileUpdateUser
): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredSession();
  if (!storedSession || storedSession.me.user.id !== user.id) return null;

  const updatedSession: StoredAuthSession = {
    ...storedSession,
    me: withUpdatedProfile(storedSession.me, user),
  };
  // Only the `me` snapshot is rewritten: writing the tokens back could
  // overwrite a refresh-token rotation that landed after the read above.
  await secureStorage.setItem(ME_KEY, JSON.stringify(updatedSession.me));
  return updatedSession;
}

export async function getStoredSession(): Promise<StoredAuthSession | null> {
  const [accessToken, refreshToken, meJson, completedUserId] = await Promise.all([
    secureStorage.getItem(ACCESS_TOKEN_KEY),
    secureStorage.getItem(REFRESH_TOKEN_KEY),
    secureStorage.getItem(ME_KEY),
    secureStorage.getItem(ONBOARDING_COMPLETED_USER_ID_KEY),
  ]);

  if (!accessToken || !refreshToken || !meJson) {
    return null;
  }

  try {
    const parsedMe = normalizeCurrentMe(JSON.parse(meJson) as CurrentMe);
    const me = withLocalOnboardingCompletion(parsedMe, completedUserId);
    return { accessToken, refreshToken, tokenType: 'Bearer', me };
  } catch {
    await clearSession();
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await secureStorage.deleteItem(ACCESS_TOKEN_KEY);
  await secureStorage.deleteItem(REFRESH_TOKEN_KEY);
  await secureStorage.deleteItem(ME_KEY);
  await secureStorage.deleteItem(ONBOARDING_COMPLETED_USER_ID_KEY);
  notifyAccessToken(null);
}

export async function getDeviceId(): Promise<string> {
  const existing = await secureStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const randomId = newRequestId();
  await secureStorage.setItem(DEVICE_ID_KEY, randomId);
  return randomId;
}
