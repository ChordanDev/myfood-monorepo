import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import type { AuthContextValue, AuthFlow, AuthSession, CurrentMe } from '../types/auth';
import * as authService from '@/services/authService';

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

export function AuthProvider({ children }: AuthProviderProps) {
  const [me, setMe] = useState<CurrentMe | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const accessTokenRef = useRef<string | null>(null);

  const applySession = useCallback((session: AuthSession | null) => {
    const nextAccessToken = session?.accessToken ?? null;
    setMe(session?.me ?? null);
    setAccessToken(nextAccessToken);
    accessTokenRef.current = nextAccessToken;
    setRefreshToken(session?.refreshToken ?? null);
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

  const value = useMemo<AuthContextValue>(
    () => ({
      me,
      user: me?.user ?? null,
      accessToken,
      refreshToken,
      token: accessToken,
      isLoading,
      isAuthenticated: me !== null && accessToken !== null && refreshToken !== null,
      ...accessState,
      signIn,
      signUp,
      signOut,
      refreshMe,
      requestVerificationCode,
      sendVerificationCode,
    }),
    [
      me,
      accessToken,
      refreshToken,
      isLoading,
      accessState,
      signIn,
      signUp,
      signOut,
      refreshMe,
      requestVerificationCode,
      sendVerificationCode,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
