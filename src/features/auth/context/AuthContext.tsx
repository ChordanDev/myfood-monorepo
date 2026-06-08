import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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

export function AuthProvider({ children }: AuthProviderProps) {
  const [me, setMe] = useState<CurrentMe | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = useCallback((session: AuthSession | null) => {
    setMe(session?.me ?? null);
    setAccessToken(session?.accessToken ?? null);
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

    try {
      await authService.logout(tokenForLogout);
    } catch (error) {
      console.warn('[AuthProvider] Error cerrando sesión remota:', error);
    } finally {
      await authService.clearSession();
      applySession(null);
    }
  }, [accessToken, applySession]);

  const refreshMe = useCallback(async () => {
    const session = await authService.refreshCurrentSession();
    applySession(session);
  }, [applySession]);

  const requestVerificationCode = useCallback(async (email: string, flow: AuthFlow) => {
    return authService.requestVerificationCode(email, flow);
  }, []);

  const sendVerificationCode = useCallback(async (email: string, flow: AuthFlow = 'login') => {
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
