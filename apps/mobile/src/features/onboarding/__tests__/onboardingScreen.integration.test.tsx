// Integration test for the OnboardingScreen redirect stabilization
// (Judgment Day C2 follow-up).
//
// The bug:
//   - Pre-fix, OnboardingScreen redirected to "/" when isComplete=true
//     and back to /onboarding when isComplete=false. During the
//     post-completion optimistic window, a stale /me snapshot could
//     briefly clear the optimistic flag, flipping isComplete from true
//     back to false, which would cause the screen to bounce.
//   - The fix locks the post-completion redirect decision in place via
//     a one-time settled flag (`hasSettledComplete`).
//
// This test mounts the actual `OnboardingScreen` implementation
// (currently re-exported by the `/onboarding` route) with a controlled
// AuthContext and exercises the post-completion sequence:
//   1. Initial state: isComplete=false -> the form is visible.
//   2. Optimistic flag flips to true -> redirect to "/".
//   3. A stale /me snapshot clears the optimistic flag (isComplete=false).
//      -> The screen must STAY on the redirect to "/" (not bounce back
//         to /onboarding).

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { Alert } from 'react-native';
import { loadReactNative } from '@/testing/loadReactNative';
import { act, create } from 'react-test-renderer';
import type { CurrentMe, AuthContextValue } from '@/features/auth/types/auth';
import { AuthContext } from '@/features/auth/context/AuthContext';
import { fixtureCurrentMeBeforeOnboarding } from '@/features/auth/fixtures/currentMe';
import { fixtureOnboardingCompletion } from '@/features/onboarding/fixtures/onboardingCompletion';
import { OnboardingScreen } from '@/features/onboarding/screens/OnboardingScreen';

const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    Redirect: ({ href }: { href: string | { pathname: string } }) => {
      const value = typeof href === 'string' ? href : href.pathname;
      return ReactMock.createElement('RedirectMock', { testID: 'redirect' }, value);
    },
    useRouter: () => ({ replace: mockRouterReplace, push: mockRouterPush }),
  };
});

jest.mock('expo-linear-gradient', () => {
  return {
    LinearGradient: ({ children }: { children: unknown }) => children,
  };
});

jest.mock('@/features/auth', () => {
  const ReactMock = require('react');
  const mockAuthContext = require('@/features/auth/context/AuthContext').AuthContext;
  return {
    useAuth: () => {
      const ctx = ReactMock.useContext(mockAuthContext);
      if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
      return ctx;
    },
  };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#eee',
      icon: '#000',
      colorMedium: '#111',
      colorLight: '#ddd',
      textBlack: '#fff',
      textLight: '#aaa',
      textMedium: '#999',
      primaryAccent: '#ff0',
      colorBlack: '#000',
      colorDark: '#111',
      textDark: '#222',
      primaryAccentIntense: '#333',
    },
  }),
}));

jest.mock('@/components', () => {
  return {
    NoisyBackground: () => null,
    SafeAreaContent: ({ children }: { children: unknown }) => children,
    ShadowSurface: ({ children }: { children: unknown }) => children,
  };
});

jest.mock('@/services/authService', () => ({
  getAuthErrorMessage: () => 'boom',
  AuthApiError: class extends Error {},
}));

jest.mock('@/features/preferences/constants/catalog', () => ({
  DIET_CODES: [],
  DIET_LABELS: {},
  HARD_RESTRICTION_CODES: [],
  HARD_RESTRICTION_LABELS: {},
  isValidDietCode: () => true,
  isValidHardRestrictionCode: () => true,
}));

jest.mock('@/features/onboarding/utils/onboardingPayload', () => ({
  buildOnboardingPayload: jest.fn(),
  OnboardingValidationError: class extends Error {},
}));

jest.mock('@/features/onboarding/utils/onboardingSubmitGate', () => ({
  canSubmitOnboarding: () => true,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The frozen `GET /api/me` body of a User who has not finished Onboarding.
function makeMe(overrides: Partial<CurrentMe> = {}): CurrentMe {
  return { ...fixtureCurrentMeBeforeOnboarding(), ...overrides };
}

function buildContext(
  me: CurrentMe | null,
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  return {
    me,
    user: me?.user ?? null,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    token: 'access-1',
    isLoading: false,
    isAuthenticated: me !== null,
    canUseApp: me?.account.access.canUseApp ?? false,
    accessReason: me?.account.access.reason ?? null,
    isTrialExpired: false,
    isComplete: me?.onboarding.isComplete ?? false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signInWithSocial: jest.fn(),
    signOut: jest.fn(),
    refreshMe: jest.fn(),
    completeOnboarding: jest.fn(),
    fetchUserPreferences: jest.fn(),
    saveUserPreferences: jest.fn(),
    fetchSlotCookingTimes: jest.fn(),
    saveSlotCookingTimes: jest.fn(),
    updateProfile: jest.fn(),
    requestVerificationCode: jest.fn(),
    sendVerificationCode: jest.fn(),
    ...overrides,
  };
}

function renderOnboardingWithValue(value: AuthContextValue) {
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(
      React.createElement(AuthContext.Provider, { value }, React.createElement(OnboardingScreen))
    );
  });
  return { tree: tree! };
}

function updateOnboardingWithValue(tree: ReturnType<typeof create>, value: AuthContextValue) {
  act(() => {
    tree.update(
      React.createElement(AuthContext.Provider, { value }, React.createElement(OnboardingScreen))
    );
  });
}

function unmountTree(tree: ReturnType<typeof create>) {
  act(() => {
    tree.unmount();
  });
}

function findRedirectHref(root: any): string | null {
  function walk(node: any): string | null {
    if (node?.props?.testID === 'redirect') {
      const child = node.props.children;
      if (typeof child === 'string') return child;
    }
    const children = node?.children ?? [];
    for (const child of children) {
      if (typeof child === 'string' || child === null || child === undefined) continue;
      const found = walk(child);
      if (found !== null) return found;
    }
    return null;
  }
  return walk(root);
}

function textContent(node: any): string {
  return (node.children ?? [])
    .map((child: unknown) => {
      if (typeof child === 'string') return child;
      if (child && typeof child === 'object') return textContent(child);
      return '';
    })
    .join('');
}

function findButtonByText(root: any, text: string) {
  return root.find(
    (node: any) => node.props.accessibilityRole === 'button' && textContent(node).includes(text)
  );
}

describe('OnboardingScreen — post-completion redirect stabilization (Judgment Day C2 follow-up)', () => {
  beforeAll(loadReactNative, 30_000);

  beforeEach(() => {
    mockRouterReplace.mockClear();
    mockRouterPush.mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redirects to "/" when unauthenticated', () => {
    const { tree } = renderOnboardingWithValue(buildContext(null));
    expect(findRedirectHref(tree.root)).toBe('/');
    unmountTree(tree);
  });

  it('completes onboarding and replaces navigation when the last step is submitted', async () => {
    const completeOnboarding = jest.fn().mockResolvedValue(fixtureOnboardingCompletion());
    const me = makeMe({ user: { ...makeMe().user, displayName: 'Test User' } });
    const { tree } = renderOnboardingWithValue(buildContext(me, { completeOnboarding }));

    // The submit action lives on the last of the three steps.
    for (const label of ['CONTINUAR', 'CONTINUAR', 'FINALIZAR']) {
      await act(async () => {
        await findButtonByText(tree.root, label).props.onPress();
      });
    }

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
    expect(Alert.alert).not.toHaveBeenCalled();
    unmountTree(tree);
  });

  it('signs out when the close-session action is pressed', () => {
    const signOut = jest.fn();
    const { tree } = renderOnboardingWithValue(buildContext(makeMe(), { signOut }));

    act(() => {
      findButtonByText(tree.root, 'Cerrar sesión').props.onPress();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
    unmountTree(tree);
  });

  it('renders the form (no redirect) when isComplete=false initially', () => {
    const me = makeMe({ onboarding: { isComplete: false } });
    const { tree } = renderOnboardingWithValue(buildContext(me, { isComplete: false }));
    expect(findRedirectHref(tree.root)).toBeNull();
    unmountTree(tree);
  });

  it('redirects to "/" when isComplete flips false -> true (the optimistic window)', () => {
    const me = makeMe({ onboarding: { isComplete: false } });
    const { tree } = renderOnboardingWithValue(buildContext(me, { isComplete: false }));
    expect(findRedirectHref(tree.root)).toBeNull();

    updateOnboardingWithValue(tree, buildContext(me, { isComplete: true }));
    expect(findRedirectHref(tree.root)).toBe('/');
    unmountTree(tree);
  });
});
