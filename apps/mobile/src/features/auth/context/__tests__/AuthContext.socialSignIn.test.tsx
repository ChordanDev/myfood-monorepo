import { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import type { AuthSession, CurrentMe } from '@/features/auth/types/auth';
import * as authService from '@/services/authService';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../../hooks/useAuth';

// Signing in with a provider token opens the same session a verified email code opens.

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/services/authService', () => ({
  ...jest.requireActual('@/services/authService'),
  signInWithSocial: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaConsumer: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 0, height: 0 }),
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
    trialEndsAt: '2099-12-31T00:00:00Z',
    subscriptionStatus: 'none',
    timezone: null,
    access: { canUseApp: true, reason: null },
  },
  membership: { role: 'owner' },
  onboarding: { isComplete: true },
};

const session: AuthSession = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  tokenType: 'Bearer',
  me,
};

const auth: { current: ReturnType<typeof useAuth> | null } = { current: null };

function Probe() {
  const value = useAuth();
  useEffect(() => {
    auth.current = value;
  });
  return null;
}

async function mountSignedOut() {
  jest.spyOn(authService, 'restoreSessionWithFreshMe').mockResolvedValue(null);
  await act(async () => {
    create(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
  });
}

describe('AuthContext signInWithSocial', () => {
  beforeEach(() => {
    auth.current = null;
    jest.mocked(authService.signInWithSocial).mockReset();
  });

  it('authenticates the app with the session the provider token opened', async () => {
    jest.mocked(authService.signInWithSocial).mockResolvedValue(session);
    await mountSignedOut();
    expect(auth.current?.isAuthenticated).toBe(false);

    await act(async () => {
      await auth.current!.signInWithSocial('google', 'google-id-token');
    });

    expect(authService.signInWithSocial).toHaveBeenCalledWith('google', 'google-id-token');
    expect(auth.current?.isAuthenticated).toBe(true);
    expect(auth.current?.accessToken).toBe('access-1');
    expect(auth.current?.me?.user.email).toBe('user@example.com');
  });

  it('rejects and stays signed out when the API refuses the token', async () => {
    jest.mocked(authService.signInWithSocial).mockRejectedValue(new Error('social_token_invalid'));
    await mountSignedOut();

    await act(async () => {
      await expect(auth.current!.signInWithSocial('apple', 'bad')).rejects.toThrow(
        'social_token_invalid'
      );
    });

    expect(auth.current?.isAuthenticated).toBe(false);
  });
});
