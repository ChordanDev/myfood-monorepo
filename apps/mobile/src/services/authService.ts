import type { AuthSession } from '@/features/auth/types/auth';
import {
  refreshCurrentSession as refreshCurrentSessionImpl,
  restoreSessionWithFreshMe as restoreSessionWithFreshMeImpl,
} from '@/features/auth/services/authSessionService';

export {
  clearSession,
  getDeviceId,
  getStoredSession,
  persistOnboardingCompletionForStoredSession,
  persistProfileForStoredSession,
  persistSession,
} from '@/api/authTokenStore';
export { refreshTokens, type RefreshResponse } from '@/api/authRefresh';
export { REFRESH_REQUEST_TIMEOUT_MS, type RequestOptions } from '@/api/transport';
export {
  ApiError as AuthApiError,
  getAuthErrorMessage,
  isAuthApiError,
  isRefreshableAuthError,
  isSessionInvalidAuthError,
  isTransientAuthError,
} from '@/api/errors';
export {
  getMe,
  logout,
  requestVerificationCode,
  sendVerificationCode,
  verifyAndSignIn,
  verifyAndSignUp,
  verifyCode,
} from '@/features/auth/api/authApi';
export { completeOnboarding } from '@/features/onboarding/api/onboardingApi';
export {
  getSlotCookingTimes,
  getUserPreferences,
  updateProfile,
  updateSlotCookingTimes,
  updateUserPreferences,
} from '@/features/preferences/api/preferencesApi';

export function restoreSessionWithFreshMe(): Promise<AuthSession | null> {
  return restoreSessionWithFreshMeImpl();
}

export function refreshCurrentSession(): Promise<AuthSession | null> {
  return refreshCurrentSessionImpl();
}
