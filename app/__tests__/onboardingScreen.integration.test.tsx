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
// This test mounts the *actual* `app/onboarding.tsx` component with a
// controlled AuthContext and exercises the post-completion sequence:
//   1. Initial state: isComplete=false -> the form is visible.
//   2. Optimistic flag flips to true -> redirect to "/".
//   3. A stale /me snapshot clears the optimistic flag (isComplete=false).
//      -> The screen must STAY on the redirect to "/" (not bounce back
//         to /onboarding).

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { act, create } from 'react-test-renderer';
import type { CurrentMe, AuthContextValue } from '@/features/auth/types/auth';
import { AuthContext } from '../../src/features/auth/context/AuthContext';
import OnboardingRoute from '../onboarding';

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    Redirect: ({ href }: { href: string | { pathname: string } }) => {
      const value = typeof href === 'string' ? href : href.pathname;
      return ReactMock.createElement('RedirectMock', { testID: 'redirect' }, value);
    },
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  };
});

jest.mock('expo-linear-gradient', () => {
  return {
    LinearGradient: ({ children }: { children: unknown }) => children,
  };
});

jest.mock('../../src/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      icon: '#000',
      colorMedium: '#111',
      textBlack: '#fff',
      textLight: '#aaa',
      primaryAccent: '#ff0',
      colorBlack: '#000',
      colorDark: '#111',
    },
  }),
}));

jest.mock('../../src/components', () => {
  return {
    NoisyBackground: () => null,
    SafeAreaContent: ({ children }: { children: unknown }) => children,
  };
});

jest.mock('../../src/services/authService', () => ({
  getAuthErrorMessage: () => 'boom',
  AuthApiError: class extends Error {},
}));

jest.mock('../../src/features/preferences/catalog', () => ({
  DIET_CODES: [],
  DIET_LABELS: {},
  HARD_RESTRICTION_CODES: [],
  HARD_RESTRICTION_LABELS: {},
}));

jest.mock('../../src/features/preferences/onboardingPayload', () => ({
  buildOnboardingPayload: jest.fn(),
  OnboardingValidationError: class extends Error {},
}));

jest.mock('../../src/features/preferences/onboardingSubmitGate', () => ({
  canSubmitOnboarding: () => true,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function makeMe(overrides: Partial<CurrentMe> = {}): CurrentMe {
  return {
    user: { id: 'user-1', email: 'user@example.com', displayName: null },
    account: {
      id: 'account-1',
      type: 'individual',
      trialEndsAt: '2099-12-31T00:00:00Z',
      subscriptionStatus: 'none',
      access: { canUseApp: true, reason: null },
    },
    membership: { role: 'owner' },
    onboarding: { isComplete: false },
    ...overrides,
  };
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
    signOut: jest.fn(),
    refreshMe: jest.fn(),
    completeOnboarding: jest.fn(),
    fetchUserPreferences: jest.fn(),
    saveUserPreferences: jest.fn(),
    fetchSlotCookingTimes: jest.fn(),
    saveSlotCookingTimes: jest.fn(),
    requestVerificationCode: jest.fn(),
    sendVerificationCode: jest.fn(),
    ...overrides,
  };
}

function renderOnboardingWithValue(value: AuthContextValue) {
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(
      React.createElement(AuthContext.Provider, { value }, React.createElement(OnboardingRoute))
    );
  });
  return { tree: tree! };
}

function updateOnboardingWithValue(tree: ReturnType<typeof create>, value: AuthContextValue) {
  act(() => {
    tree.update(
      React.createElement(AuthContext.Provider, { value }, React.createElement(OnboardingRoute))
    );
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

describe('OnboardingScreen — post-completion redirect stabilization (Judgment Day C2 follow-up)', () => {
  it('renders the form (no redirect) when isComplete=false initially', () => {
    const me = makeMe({ onboarding: { isComplete: false } });
    const { tree } = renderOnboardingWithValue(buildContext(me, { isComplete: false }));
    expect(findRedirectHref(tree.root)).toBeNull();
    tree.unmount();
  });

  it('redirects to "/" when isComplete flips false -> true (the optimistic window)', () => {
    const me = makeMe({ onboarding: { isComplete: false } });
    const { tree } = renderOnboardingWithValue(buildContext(me, { isComplete: false }));
    expect(findRedirectHref(tree.root)).toBeNull();

    updateOnboardingWithValue(tree, buildContext(me, { isComplete: true }));
    expect(findRedirectHref(tree.root)).toBe('/');
    tree.unmount();
  });

  it('stays on "/" when isComplete briefly flips back to false (the bounce guard)', () => {
    // Race scenario: optimistic flag set, then a stale /me snapshot
    // arrives. applySession clears the optimistic flag because the
    // snapshot's me.onboarding.isComplete is still false. The screen
    // must NOT redirect back to /onboarding.
    const me = makeMe({ onboarding: { isComplete: false } });
    const { tree } = renderOnboardingWithValue(buildContext(me, { isComplete: false }));
    expect(findRedirectHref(tree.root)).toBeNull();

    updateOnboardingWithValue(tree, buildContext(me, { isComplete: true }));
    expect(findRedirectHref(tree.root)).toBe('/');

    updateOnboardingWithValue(tree, buildContext(me, { isComplete: false }));
    expect(findRedirectHref(tree.root)).toBe('/');
    expect(findRedirectHref(tree.root)).not.toBe('/onboarding');
    tree.unmount();
  });
});
