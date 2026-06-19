// Integration test for the redirect ping-pong between IndexScreen and
// OnboardingScreen (Judgment Day C2 follow-up).
//
// The bug:
//   - Pre-fix, `app/index.tsx` read `isComplete` directly from
//     `me?.onboarding.isComplete` (the server-confirmed value).
//   - `app/onboarding.tsx` reads `isComplete` from the AuthContext
//     (which ORs in the optimistic "I just submitted" flag).
//   - During the optimistic window, the two screens disagreed about
//     the route: OnboardingScreen said "go to /" and IndexScreen said
//     "go to /onboarding". The router ping-ponged.
//
// This test mounts the *actual* `app/index.tsx` component with a
// controlled AuthContext and exercises:
//   1. Initial state: isComplete=false -> IndexScreen redirects to
//      /onboarding.
//   2. The optimistic window: isComplete=true (from the optimistic
//      flag) while me.onboarding.isComplete is still false. The fixed
//      IndexScreen must redirect to /(tabs)/home, not /onboarding.
//   3. Content-equal me reference change: the route stays at
//      /(tabs)/home (hook memoization keeps the string stable).

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { act, create } from 'react-test-renderer';
import type { CurrentMe, AuthContextValue } from '@/features/auth/types/auth';
import { AuthContext } from '../../src/features/auth/context/AuthContext';
import IndexScreen from '../index';

// Mock the modules imported by `app/index.tsx` and its dependencies.
// We use only React.createElement (no JSX) so the babel preset does
// not inject `react-native-css-interop` references that would conflict
// with jest.mock hoisting.
jest.mock('expo-router', () => {
  // The mocked Redirect captures the href so the test can assert the
  // route the screen would have rendered.
  const ReactMock = require('react');
  return {
    Redirect: ({ href }: { href: string | { pathname: string } }) => {
      const value = typeof href === 'string' ? href : href.pathname;
      return ReactMock.createElement('RedirectMock', { testID: 'redirect' }, value);
    },
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  };
});

jest.mock('../../src/features/auth', () => {
  // Stub the AuthLandingScreen and TrialExpiredScreen — we only care
  // about the redirect path in this test, not the actual landing/expired UI.
  const ReactMock = require('react');
  const mockAuthContext = require('../../src/features/auth/context/AuthContext').AuthContext;
  return {
    AuthLandingScreen: () => ReactMock.createElement('AuthLandingMock'),
    TrialExpiredScreen: () => ReactMock.createElement('TrialExpiredMock'),
    useAuth: () => {
      const ctx = ReactMock.useContext(mockAuthContext);
      if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
      return ctx;
    },
  };
});

jest.mock('../../src/constants/theme', () => ({
  COLORS: { bgDarkest: '#000', accentYellow: '#ff0' },
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

function renderIndexScreenWithValue(value: AuthContextValue) {
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(
      React.createElement(AuthContext.Provider, { value }, React.createElement(IndexScreen))
    );
  });
  return { tree: tree! };
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

function hasNodeType(root: any, type: string): boolean {
  function walk(node: any): boolean {
    if (node?.type === type) return true;
    const children = node?.children ?? [];
    for (const child of children) {
      if (typeof child === 'string' || child === null || child === undefined) continue;
      if (walk(child)) return true;
    }
    return false;
  }
  return walk(root);
}

describe('IndexScreen — redirect ping-pong with OnboardingScreen (Judgment Day C2 follow-up)', () => {
  it('renders AuthLandingScreen instead of redirecting to onboarding when unauthenticated', () => {
    const { tree } = renderIndexScreenWithValue(buildContext(null));
    expect(findRedirectHref(tree.root)).toBeNull();
    expect(hasNodeType(tree.root, 'AuthLandingMock')).toBe(true);
    unmountTree(tree);
  });

  it('routes to /onboarding when the user is authenticated but not complete (initial state)', () => {
    const me = makeMe({ onboarding: { isComplete: false } });
    const { tree } = renderIndexScreenWithValue(buildContext(me));
    expect(findRedirectHref(tree.root)).toBe('/onboarding');
    unmountTree(tree);
  });

  it('routes to /onboarding when isComplete=false (initial / pre-submit state)', () => {
    const me = makeMe({ onboarding: { isComplete: false } });
    const { tree } = renderIndexScreenWithValue(buildContext(me, { isComplete: false }));
    expect(findRedirectHref(tree.root)).toBe('/onboarding');
    unmountTree(tree);
  });

  it('routes to /(tabs)/home (NOT /onboarding) when isComplete=true even if me.onboarding.isComplete is still false (the optimistic window)', () => {
    // This is the smoking gun. The post-completion flow sets the
    // optimistic flag (isComplete=true) but me.onboarding.isComplete is
    // still false because the background /me refresh has not yet
    // returned. The AuthContext exposes isComplete=true.
    //
    // Pre-fix: IndexScreen read me.onboarding.isComplete=false, routed
    // to /onboarding. OnboardingScreen saw isComplete=true and routed
    // to /. The screens disagreed and the router ping-ponged.
    //
    // Post-fix: IndexScreen reads isComplete from the AuthContext, sees
    // true, and routes to /(tabs)/home. No ping-pong.
    const me = makeMe({ onboarding: { isComplete: false } });
    const { tree } = renderIndexScreenWithValue(buildContext(me, { isComplete: true }));
    expect(findRedirectHref(tree.root)).toBe('/(tabs)/home');
    unmountTree(tree);
  });

  // The previous "stays on /(tabs)/home when me reference changes"
  // test was tautological: it drove both updates with isComplete=true
  // and me.onboarding.isComplete=true, so the gate unconditionally
  // returns 'Tabs' regardless of me reference identity. The `me`
  // reference is not even read by the gate (it reads the primitive
  // `isComplete` / `canUseApp` / `isAuthenticated`), so the test could
  // not distinguish memoized from non-memoized output. The contract
  // this test claimed to verify — "the route stays at Tabs when the
  // gate inputs are stable, even if a stale /me arrives between them"
  // — is actually exercised end-to-end by
  // `src/features/auth/context/__tests__/AuthContext.optimisticLatch.test.tsx`
  // ("isComplete stays true even if a subsequent /me returns a stale
  // snapshot ..."), which mounts the real AuthProvider, drives a
  // completeOnboarding + stale /me refresh, and asserts the latch
  // held.
});
