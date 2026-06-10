// Pure-function characterization of the index gate. This is the smallest
// unit test that proves the gate's two callers (IndexScreen and
// OnboardingScreen) must read isComplete from the same source.
//
// The bug fixed in `fix/onboarding-redirect-loop`:
//   - OnboardingScreen reads `isComplete` from the AuthContext (which ORs
//     the optimistic flag with me.onboarding.isComplete).
//   - IndexScreen (before the fix) read isComplete directly from
//     `me?.onboarding.isComplete`, ignoring the optimistic flag.
//   - Result: when the user submitted onboarding, OnboardingScreen saw
//     isComplete=true and redirected to "/", but IndexScreen read
//     isComplete=false from the still-stale me and redirected back to
//     "/onboarding". Ping-pong.
//
// This file documents the contract the gate MUST respect so the two
// screens always agree.

import { resolveIndexGate, type IndexGateInput } from '../indexGate';

describe('resolveIndexGate — agreement contract (Judgment Day C2 follow-up)', () => {
  // Three equivalent inputs, expressed in the two ways the screens read them.
  //
  // "stable" — me.onboarding.isComplete is content-equal across two snapshots.
  // "optimistic" — the AuthContext's optimistic-complete flag is set even
  //   though me.onboarding.isComplete is still false (the post-completion
  //   window between POST success and the background /me refresh).
  //
  // Both screens must resolve these to the same route. Pre-fix, the
  // IndexScreen used the "stable" view and OnboardingScreen used the
  // "auth-context" view; the two disagreed during the optimistic window
  // and produced the ping-pong.
  const optimisticWindow: IndexGateInput = {
    isAuthenticated: true,
    isComplete: true, // includes the optimistic flag
    canUseApp: true,
  };
  const optimisticWindowRawMe: { me: { onboarding: { isComplete: boolean } } } = {
    me: { onboarding: { isComplete: false } },
  };
  const postRefresh: IndexGateInput = {
    isAuthenticated: true,
    isComplete: true, // server-confirmed
    canUseApp: true,
  };
  const preSubmit: IndexGateInput = {
    isAuthenticated: true,
    isComplete: false,
    canUseApp: true,
  };

  it('resolves the optimistic window to the post-onboarding route (Tabs), not Onboarding', () => {
    expect(resolveIndexGate(optimisticWindow)).toBe('Tabs');
  });

  it('resolves the post-refresh state to Tabs (consistency with the optimistic window)', () => {
    expect(resolveIndexGate(postRefresh)).toBe('Tabs');
  });

  it('resolves the pre-submit state to Onboarding', () => {
    expect(resolveIndexGate(preSubmit)).toBe('Onboarding');
  });

  it('the optimistic-window input and the post-refresh input yield the same route', () => {
    // The gate is a pure function of (isAuthenticated, isComplete, canUseApp).
    // As long as both screens pass the same input, they will produce the
    // same route. The contract: every caller of resolveIndexGate MUST pass
    // the AuthContext.isComplete value (which includes the optimistic
    // flag), not me?.onboarding.isComplete directly.
    expect(resolveIndexGate(optimisticWindow)).toBe(resolveIndexGate(postRefresh));
  });

  it('documents that me.onboarding.isComplete is NOT a drop-in for isComplete (it ignores the optimistic flag)', () => {
    // This test is the smoking gun. Given the same me value
    // (onboarding.isComplete = false), the "raw" gate computation
    // (which is what the pre-fix IndexScreen did) returns Onboarding,
    // while the "optimistic" gate (which is what the AuthContext exposes
    // to OnboardingScreen) returns Tabs.
    //
    // The pre-fix bug: IndexScreen used the raw computation, OnboardingScreen
    // used the optimistic one. They disagreed during the optimistic window.
    const rawGateInput: IndexGateInput = {
      isAuthenticated: true,
      isComplete: optimisticWindowRawMe.me.onboarding.isComplete,
      canUseApp: true,
    };
    const authContextGateInput: IndexGateInput = optimisticWindow;

    expect(resolveIndexGate(rawGateInput)).toBe('Onboarding');
    expect(resolveIndexGate(authContextGateInput)).toBe('Tabs');
    expect(resolveIndexGate(rawGateInput)).not.toBe(resolveIndexGate(authContextGateInput));
  });
});
