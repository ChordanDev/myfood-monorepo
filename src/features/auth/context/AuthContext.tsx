import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthContextValue, AuthUser } from '../types/auth';
import * as authService from '@/services/authService';

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restaura sesion al montar el provider.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const session = await authService.getStoredSession();
        if (!cancelled && session) {
          setUser(session.user);
          setToken(session.token);
        }
      } catch (error) {
        console.warn('[AuthProvider] Error restaurando sesion:', error);
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
  }, []);

  const signIn = useCallback(async (email: string, code: string) => {
    const session = await authService.verifyAndSignIn(email, code);
    setUser(session.user);
    setToken(session.token);
  }, []);

  const signUp = useCallback(async (email: string, code: string) => {
    const session = await authService.verifyAndSignUp(email, code);
    setUser(session.user);
    setToken(session.token);
  }, []);

  const signOut = useCallback(async () => {
    await authService.clearSession();
    setUser(null);
    setToken(null);
  }, []);

  const sendVerificationCode = useCallback(async (email: string) => {
    await authService.sendVerificationCode(email);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: user !== null,
      signIn,
      signUp,
      signOut,
      sendVerificationCode,
    }),
    [user, token, isLoading, signIn, signUp, signOut, sendVerificationCode]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
