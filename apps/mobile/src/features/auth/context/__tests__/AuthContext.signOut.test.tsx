import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import type { AuthSession, CurrentMe } from '@/features/auth/types/auth';
import { MILK, RICE } from '@/features/inventory/fixtures';
import { useInventoryStore } from '@/features/inventory/store';
import { SHOPPING_LIST_BY_INGREDIENT } from '@/features/shopping/fixtures';
import { useShoppingListStore } from '@/features/shopping/store/useShoppingListStore';
import * as authService from '@/services/authService';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../../hooks/useAuth';

// Issue #116 — the Inventory and Shopping caches belong to the signed-in Account: signing out
// drops them, so the next Account on the device never sees a lot or an item of the previous one.

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

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

// What the previous Account left on the device: its lots, its list and the day it chose.
function fillAccountCaches(accountId: string) {
  useInventoryStore.setState({ items: [RICE, MILK], loadStatus: 'ready', loadError: null });
  useShoppingListStore.setState({
    ownerId: `user-of-${accountId}`,
    list: SHOPPING_LIST_BY_INGREDIENT,
    status: 'ready',
    chosenUntilDate: '2026-10-10',
    chosenUntilDateOwnerId: `user-of-${accountId}`,
  });
}

async function storedInventoryItems() {
  const stored = await AsyncStorage.getItem('inventory-storage');
  return stored === null ? [] : JSON.parse(stored).state.items;
}

function expectNoCacheOfThePreviousAccount() {
  expect(useInventoryStore.getState().items).toEqual([]);
  expect(useShoppingListStore.getState()).toMatchObject({
    ownerId: null,
    list: null,
    chosenUntilDate: undefined,
    chosenUntilDateOwnerId: undefined,
  });
}

describe('AuthProvider — signing out drops the Inventory and Shopping caches', () => {
  afterEach(async () => {
    jest.restoreAllMocks();
    useInventoryStore.setState({ items: [], loadStatus: 'idle', loadError: null });
    useShoppingListStore.setState(useShoppingListStore.getInitialState(), true);
    await AsyncStorage.clear();
  });

  it('keeps the caches when the same Account is restored', async () => {
    fillAccountCaches('account-1');
    const tree = await mountSignedIn('account-1');

    expect(useInventoryStore.getState().items).toEqual([RICE, MILK]);
    expect(useShoppingListStore.getState().list).toBe(SHOPPING_LIST_BY_INGREDIENT);
    act(() => tree.unmount());
  });

  it('drops them on sign-out, from memory and from storage', async () => {
    const tree = await mountSignedIn('account-1');
    fillAccountCaches('account-1');

    await act(async () => {
      await auth.current!.signOut();
    });

    expectNoCacheOfThePreviousAccount();
    expect(await storedInventoryItems()).toEqual([]);
    act(() => tree.unmount());
  });

  it('resolves the sign-out only once the stored data of the Account is removed', async () => {
    const tree = await mountSignedIn('account-1');
    let finishRemoval!: () => void;
    const removal = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    jest.spyOn(AsyncStorage, 'removeItem').mockImplementationOnce(() => removal);
    let isSignedOut = false;
    let signingOut!: Promise<void>;

    await act(async () => {
      signingOut = auth.current!.signOut().then(() => {
        isSignedOut = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(isSignedOut).toBe(false);

    await act(async () => {
      finishRemoval();
      await signingOut;
    });

    expect(isSignedOut).toBe(true);
    act(() => tree.unmount());
  });

  it('shows another Account that signs in after the sign-out nothing of the previous one', async () => {
    jest.spyOn(authService, 'refreshCurrentSession').mockResolvedValue(makeSession('account-2'));
    const tree = await mountSignedIn('account-1');
    fillAccountCaches('account-1');

    await act(async () => {
      await auth.current!.signOut();
    });
    await act(async () => {
      await auth.current!.refreshMe();
    });

    expect(auth.current!.me?.account.id).toBe('account-2');
    expectNoCacheOfThePreviousAccount();
    expect(await storedInventoryItems()).toEqual([]);
    act(() => tree.unmount());
  });

  it('drops them when another Account signs in without a sign-out', async () => {
    jest.spyOn(authService, 'refreshCurrentSession').mockResolvedValue(makeSession('account-2'));
    const tree = await mountSignedIn('account-1');
    fillAccountCaches('account-1');

    await act(async () => {
      await auth.current!.refreshMe();
    });

    expectNoCacheOfThePreviousAccount();
    act(() => tree.unmount());
  });
});
