// Smoke test for the new useIndexRoute hook.
// Will be expanded once the redirect-ping-pong integration test
// harness is in place.

import * as React from 'react';
import { act, create } from 'react-test-renderer';
import type { CurrentMe, AuthContextValue } from '@/features/auth/types/auth';
import { AuthContext } from '@/features/auth/context/AuthContext';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useIndexRoute } from '../useIndexRoute';

interface RouteCapture {
  route: ReturnType<typeof useIndexRoute>;
  me: CurrentMe | null;
  isComplete: boolean;
}

function RouteProbe({ captures }: { captures: RouteCapture[] }) {
  const auth = useAuth();
  const route = useIndexRoute();
  captures.push({ route, me: auth.me, isComplete: auth.isComplete });
  return null;
}

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

function renderRouteProbeWithValue(value: AuthContextValue) {
  const captures: RouteCapture[] = [];
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(
      React.createElement(
        AuthContext.Provider,
        { value },
        React.createElement(RouteProbe, { captures })
      )
    );
  });
  return { captures, tree: tree! };
}

function updateTreeWithValue(
  tree: ReturnType<typeof create>,
  value: AuthContextValue,
  captures: RouteCapture[]
) {
  act(() => {
    tree.update(
      React.createElement(
        AuthContext.Provider,
        { value },
        React.createElement(RouteProbe, { captures })
      )
    );
  });
}

describe('useIndexRoute — ping-pong stability (Judgment Day C2 follow-up)', () => {
  // The previous "returns the same route string for two content-equal
  // me snapshots" test was tautological: it asserted
  // `expect(secondRoute).toBe(firstRoute)` on two string literals, and
  // JavaScript interning guarantees the equality holds regardless of
  // whether `useMemo` ran. A meaningful test of hook-level memoization
  // would require spying on `resolveIndexGate` (or counting its
  // invocations across renders), which is a larger refactor than the
  // scope of this fix. The behavioral contract — "the route stays at
  // Tabs when the user is complete and the gate inputs are stable" —
  // is already covered by the `does not flip from Tabs back to
  // Onboarding ...` test below, which actually exercises the gate.

  it('does not flip from Tabs back to Onboarding when only the me reference changes (isComplete=true)', () => {
    const meV1 = makeMe({ onboarding: { isComplete: true } });
    const meV2 = makeMe({ onboarding: { isComplete: true } });

    const { captures, tree } = renderRouteProbeWithValue(buildContext(meV1, { isComplete: true }));
    expect(captures[captures.length - 1].route).toBe('Tabs');

    updateTreeWithValue(tree, buildContext(meV2, { isComplete: true }), captures);

    expect(captures[captures.length - 1].route).toBe('Tabs');
    expect(captures[captures.length - 1].route).not.toBe('Onboarding');

    tree.unmount();
  });

  it('flips from Onboarding to Tabs when isComplete (with optimistic flag) flips false -> true, even when me.onboarding.isComplete is still false', () => {
    const me = makeMe({ onboarding: { isComplete: false } });
    const { captures, tree } = renderRouteProbeWithValue(buildContext(me, { isComplete: false }));
    expect(captures[captures.length - 1].route).toBe('Onboarding');

    updateTreeWithValue(tree, buildContext(me, { isComplete: true }), captures);

    expect(captures[captures.length - 1].route).toBe('Tabs');
    tree.unmount();
  });

  it('routes to TrialExpired (not Tabs) for a complete+locked user, even when me reference changes', () => {
    const meV1 = makeMe({
      onboarding: { isComplete: true },
      account: {
        id: 'account-1',
        type: 'individual',
        trialEndsAt: '2020-01-01T00:00:00Z',
        subscriptionStatus: 'none',
        access: { canUseApp: false, reason: 'trial_expired' },
      },
    });
    const meV2 = makeMe({
      onboarding: { isComplete: true },
      account: {
        id: 'account-1',
        type: 'individual',
        trialEndsAt: '2020-01-01T00:00:00Z',
        subscriptionStatus: 'none',
        access: { canUseApp: false, reason: 'trial_expired' },
      },
    });
    const { captures, tree } = renderRouteProbeWithValue(
      buildContext(meV1, { isComplete: true, canUseApp: false, isTrialExpired: true })
    );
    expect(captures[captures.length - 1].route).toBe('TrialExpired');

    updateTreeWithValue(
      tree,
      buildContext(meV2, { isComplete: true, canUseApp: false, isTrialExpired: true }),
      captures
    );
    expect(captures[captures.length - 1].route).toBe('TrialExpired');
    tree.unmount();
  });
});
