import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import type { AuthSession, CurrentMe } from '@/features/auth/types/auth';
import { fixtureRecipe } from '@/features/recipe/fixtures/recipeDetail';
import { useRecipeCacheStore } from '@/features/recipe/store/useRecipeCacheStore';
import * as authService from '@/services/authService';
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

jest.mock('@/features/recipe/api/recipeApi', () => ({ getRecipe: jest.fn() }));

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

const STORAGE_KEY = 'recipe-cache-storage';

const RECIPE = fixtureRecipe();

const EMPTY_CACHE = { recipesByVersionId: {}, versionIdByRecipeId: {} };

// The store persists every change, so this also writes the cached Recipe to storage.
function fillRecipeCache() {
  useRecipeCacheStore.setState({
    recipesByVersionId: { [RECIPE.recipeVersionId]: RECIPE },
    versionIdByRecipeId: { [RECIPE.id]: RECIPE.recipeVersionId },
  });
}

function cachedRecipes() {
  const { recipesByVersionId, versionIdByRecipeId } = useRecipeCacheStore.getState();
  return { recipesByVersionId, versionIdByRecipeId };
}

describe('AuthProvider — recipe cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useRecipeCacheStore.getState().clear();
  });

  it('keeps the cached Recipes when the same account is restored', async () => {
    fillRecipeCache();
    const tree = await mountSignedIn('account-1');

    expect(useRecipeCacheStore.getState().getCachedRecipe(RECIPE.id)).toEqual(RECIPE);
    expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();
    act(() => tree.unmount());
  });

  it('clears the cached Recipes and their stored entry on sign-out', async () => {
    const tree = await mountSignedIn('account-1');
    fillRecipeCache();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await act(async () => {
      await auth.current!.signOut();
    });

    expect(cachedRecipes()).toEqual(EMPTY_CACHE);
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    act(() => tree.unmount());
  });

  it('clears the cached Recipes and their stored entry when another account signs in', async () => {
    jest.spyOn(authService, 'refreshCurrentSession').mockResolvedValue(makeSession('account-2'));
    const tree = await mountSignedIn('account-1');
    fillRecipeCache();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await act(async () => {
      await auth.current!.refreshMe();
    });

    expect(cachedRecipes()).toEqual(EMPTY_CACHE);
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    act(() => tree.unmount());
  });
});
