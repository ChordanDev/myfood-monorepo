import { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import type { AuthSession, CurrentMe } from '@/features/auth/types/auth';
import * as authService from '@/services/authService';
import { useMealPlanStore } from '@/store/useMealPlanStore';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../../hooks/useAuth';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/services/authService', () => ({
  ...jest.requireActual('@/services/authService'),
  logout: jest.fn().mockResolvedValue(undefined),
  clearSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaConsumer: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 0, height: 0 }),
}));

function makeSession(accountId: string): AuthSession {
  const me: CurrentMe = {
    user: {
      id: `user-of-${accountId}`,
      email: `${accountId}@example.com`,
      displayName: null,
      householdSize: null,
      cookingSkill: null,
    },
    account: {
      id: accountId,
      type: 'individual',
      trialEndsAt: '2099-12-31T00:00:00Z',
      subscriptionStatus: 'none',
      timezone: null,
      access: { canUseApp: true, reason: null },
    },
    membership: { role: 'owner' },
    onboarding: { isComplete: true },
  };
  return { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', me };
}

const auth: { current: ReturnType<typeof useAuth> | null } = { current: null };

function Probe() {
  const value = useAuth();
  useEffect(() => {
    auth.current = value;
  });
  return null;
}

async function mountSignedIn(accountId: string) {
  jest.spyOn(authService, 'restoreSessionWithFreshMe').mockResolvedValue(makeSession(accountId));
  let tree: ReturnType<typeof create> | null = null;
  await act(async () => {
    tree = create(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
  });
  return tree!;
}

function fillPlanCache() {
  useMealPlanStore.setState({
    entries: [
      {
        id: 'entry-1',
        date: '2026-07-02',
        type: 'lunch',
        recipeId: 'recipe-1',
        isCooked: false,
        isSkipped: false,
      } as never,
    ],
    recipeSummaries: { 'recipe-1': { id: 'recipe-1', name: 'Soup' } as never },
  });
}

describe('AuthProvider — meal plan cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useMealPlanStore.setState({ entries: [], recipeSummaries: {} });
  });

  it('keeps the cached plan when the same account is restored', async () => {
    fillPlanCache();
    const tree = await mountSignedIn('account-1');

    expect(useMealPlanStore.getState().entries).toHaveLength(1);
    act(() => tree.unmount());
  });

  it('clears the cached plan on sign-out', async () => {
    const tree = await mountSignedIn('account-1');
    fillPlanCache();

    await act(async () => {
      await auth.current!.signOut();
    });

    expect(useMealPlanStore.getState().entries).toEqual([]);
    expect(useMealPlanStore.getState().recipeSummaries).toEqual({});
    act(() => tree.unmount());
  });

  it('clears the cached plan when another account signs in', async () => {
    jest.spyOn(authService, 'refreshCurrentSession').mockResolvedValue(makeSession('account-2'));
    const tree = await mountSignedIn('account-1');
    fillPlanCache();

    await act(async () => {
      await auth.current!.refreshMe();
    });

    expect(useMealPlanStore.getState().entries).toEqual([]);
    expect(useMealPlanStore.getState().recipeSummaries).toEqual({});
    act(() => tree.unmount());
  });
});
