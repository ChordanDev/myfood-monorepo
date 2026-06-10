import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import type {
  AuthContextValue,
  AuthFlow,
  AuthSession,
  CurrentMe,
  OnboardingCompletionRequest,
  OnboardingCompletionResponse,
  SlotCookingTimes,
  SlotCookingTimesPayload,
  UserPreferences,
  UserPreferencesPayload,
} from '../types/auth';
import * as authService from '@/services/authService';
import { isTransientAuthError } from '@/services/authService';
import { reconcileAfterCompletion } from '../utils/postCompletion';

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

function getAccessState(me: CurrentMe | null) {
  const canUseApp = me?.account.access.canUseApp ?? false;
  const accessReason = me?.account.access.reason ?? null;

  return {
    canUseApp,
    accessReason,
    isTrialExpired: !canUseApp && accessReason === 'trial_expired',
  };
}

function withLocalTrialExpired(me: CurrentMe): CurrentMe {
  return {
    ...me,
    account: {
      ...me.account,
      access: { canUseApp: false, reason: 'trial_expired' },
    },
  };
}

function getTrialExpiryDelay(me: CurrentMe | null): number | null {
  if (!me?.account.access.canUseApp || me.account.subscriptionStatus === 'active') return null;
  if (!me.account.trialEndsAt) return null;

  const expiresAt = new Date(me.account.trialEndsAt).getTime();
  if (!Number.isFinite(expiresAt)) return null;

  return Math.max(expiresAt - Date.now(), 0);
}

function hasCompleteSession(
  me: CurrentMe | null,
  accessToken: string | null,
  refreshToken: string | null
): boolean {
  return me !== null && accessToken !== null && refreshToken !== null;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [me, setMe] = useState<CurrentMe | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Set to true when the local gate should treat the user as complete
  // even before the next /me snapshot confirms it. Used by
  // `completeOnboarding` to flip the gate optimistically after a
  // successful POST. Cleared when a fresh /me reports isComplete=false
  // (defensive — should not happen in practice because completion is
  // one-way on the server).
  const [optimisticComplete, setOptimisticComplete] = useState(false);
  const optimisticCompleteRef = useRef(false);
  const accessTokenRef = useRef<string | null>(null);

  const applySession = useCallback((session: AuthSession | null) => {
    const nextAccessToken = session?.accessToken ?? null;
    setMe(session?.me ?? null);
    setAccessToken(nextAccessToken);
    accessTokenRef.current = nextAccessToken;
    setRefreshToken(session?.refreshToken ?? null);
    // Once the next /me snapshot confirms the user's state, the
    // optimistic flag can be cleared — the gate will read from
    // me.onboarding.isComplete from now on.
    if (session?.me) {
      setOptimisticComplete(false);
      optimisticCompleteRef.current = false;
    } else {
      // Logging out / losing the session also drops the optimistic flag.
      setOptimisticComplete(false);
      optimisticCompleteRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const session = await authService.restoreSessionWithFreshMe();
        if (!cancelled) {
          applySession(session);
        }
      } catch (error) {
        console.warn('[AuthProvider] Error restaurando sesión:', error);
        await authService.clearSession();
        if (!cancelled) {
          applySession(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const signIn = useCallback(
    async (email: string, code: string) => {
      const session = await authService.verifyAndSignIn(email, code);
      applySession(session);
    },
    [applySession]
  );

  const signUp = useCallback(
    async (email: string, code: string) => {
      const session = await authService.verifyAndSignUp(email, code);
      applySession(session);
    },
    [applySession]
  );

  const signOut = useCallback(async () => {
    const tokenForLogout = accessToken;
    const refreshTokenForLogout = refreshToken;

    try {
      await authService.logout(tokenForLogout, refreshTokenForLogout);
    } catch (error) {
      console.warn('[AuthProvider] Error cerrando sesión remota:', error);
    } finally {
      await authService.clearSession();
      applySession(null);
    }
  }, [accessToken, refreshToken, applySession]);

  const refreshMe = useCallback(async () => {
    const session = await authService.refreshCurrentSession();
    applySession(session);
  }, [applySession]);

  const completeOnboarding = useCallback(
    async (payload: OnboardingCompletionRequest): Promise<OnboardingCompletionResponse> => {
      const token = accessTokenRef.current;
      if (!token) {
        throw new authService.AuthApiError(
          'unauthenticated',
          'No active session to complete onboarding.'
        );
      }

      // Judgment Day C2: the POST result is the source of truth. The
      // follow-up refreshMe() is a soft read; if it fails the gate
      // must not flip the user back to the Onboarding screen because
      // the server already accepted the completion. The reconciliation
      // policy is unit-tested in `postCompletion.test.ts`.
      const result = await authService.completeOnboarding(token, payload);

      const session = await authService.getStoredSession();
      if (session?.accessToken) {
        const reconcile = await reconcileAfterCompletion({
          wasComplete: optimisticCompleteRef.current,
          persisted: true,
          refresh: () => authService.refreshCurrentSession().then((next) => next ?? session),
          onOptimistic: (next) => {
            setOptimisticComplete(next);
            optimisticCompleteRef.current = next;
          },
          onRefreshed: (value) => {
            applySession(value);
          },
          shouldRetry: (error) => isTransientAuthError(error),
        });
        if (reconcile.outcome === 'refresh-failed') {
          console.warn(
            '[AuthProvider] Background /me refresh after onboarding failed; relying on next session restore.'
          );
        }
      } else {
        // No stored session: just flip the optimistic flag so the
        // gate moves; the next /api/me read will confirm.
        setOptimisticComplete(true);
        optimisticCompleteRef.current = true;
      }

      return result;
    },
    [applySession]
  );

  const fetchUserPreferences = useCallback(async (): Promise<UserPreferences> => {
    const token = accessTokenRef.current;
    if (!token) {
      throw new authService.AuthApiError(
        'unauthenticated',
        'No active session to read preferences.'
      );
    }
    return authService.getUserPreferences(token);
  }, []);

  const saveUserPreferences = useCallback(
    async (payload: UserPreferencesPayload): Promise<UserPreferences> => {
      const token = accessTokenRef.current;
      if (!token) {
        throw new authService.AuthApiError(
          'unauthenticated',
          'No active session to save preferences.'
        );
      }
      return authService.updateUserPreferences(token, payload);
    },
    []
  );

  const fetchSlotCookingTimes = useCallback(async (): Promise<SlotCookingTimes> => {
    const token = accessTokenRef.current;
    if (!token) {
      throw new authService.AuthApiError(
        'unauthenticated',
        'No active session to read slot cooking times.'
      );
    }
    return authService.getSlotCookingTimes(token);
  }, []);

  const saveSlotCookingTimes = useCallback(
    async (payload: SlotCookingTimesPayload): Promise<SlotCookingTimes> => {
      const token = accessTokenRef.current;
      if (!token) {
        throw new authService.AuthApiError(
          'unauthenticated',
          'No active session to save slot cooking times.'
        );
      }
      return authService.updateSlotCookingTimes(token, payload);
    },
    []
  );

  const handleRevalidationError = useCallback(
    async (error: unknown) => {
      if (authService.isTransientAuthError(error)) return;

      if (authService.isSessionInvalidAuthError(error)) {
        await authService.clearSession();
        applySession(null);
        return;
      }

      console.warn('[AuthProvider] Error revalidando sesión:', error);
    },
    [applySession]
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !accessTokenRef.current) return;

      refreshMe().catch(handleRevalidationError);
    });

    return () => subscription.remove();
  }, [handleRevalidationError, refreshMe]);

  useEffect(() => {
    const trialExpiryDelay = getTrialExpiryDelay(me);
    if (trialExpiryDelay === null) return;

    const timeout = setTimeout(() => {
      refreshMe().catch((error) => {
        if (authService.isTransientAuthError(error)) {
          setMe((currentMe) => (currentMe ? withLocalTrialExpired(currentMe) : currentMe));
          return;
        }

        handleRevalidationError(error);
      });
    }, trialExpiryDelay);

    return () => clearTimeout(timeout);
  }, [handleRevalidationError, me, refreshMe]);

  const requestVerificationCode = useCallback((email: string, flow: AuthFlow) => {
    return authService.requestVerificationCode(email, flow);
  }, []);

  const sendVerificationCode = useCallback((email: string, flow: AuthFlow = 'login') => {
    return authService.sendVerificationCode(email, flow);
  }, []);

  const accessState = useMemo(() => getAccessState(me), [me]);

  // isComplete is true if EITHER the server has confirmed it OR the
  // local optimistic flag is set (during the brief window between
  // POST success and the background refresh completion).
  const isComplete = optimisticComplete || (me?.onboarding.isComplete ?? false);

  const value = useMemo<AuthContextValue>(
    () => ({
      me,
      user: me?.user ?? null,
      accessToken,
      refreshToken,
      token: accessToken,
      isLoading,
      isAuthenticated: hasCompleteSession(me, accessToken, refreshToken),
      ...accessState,
      isComplete,
      signIn,
      signUp,
      signOut,
      refreshMe,
      completeOnboarding,
      fetchUserPreferences,
      saveUserPreferences,
      fetchSlotCookingTimes,
      saveSlotCookingTimes,
      requestVerificationCode,
      sendVerificationCode,
    }),
    [
      me,
      accessToken,
      refreshToken,
      isLoading,
      accessState,
      isComplete,
      signIn,
      signUp,
      signOut,
      refreshMe,
      completeOnboarding,
      fetchUserPreferences,
      saveUserPreferences,
      fetchSlotCookingTimes,
      saveSlotCookingTimes,
      requestVerificationCode,
      sendVerificationCode,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
