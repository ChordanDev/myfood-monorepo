// AuthContext optimistic-latch behavior (Judgment Day C2 follow-up, root-cause fix).
//
// The bug, in one paragraph:
//   - Pre-fix, `AuthContext.applySession` cleared the optimistic-complete
//     flag unconditionally on every successful `applySession` call that
//     carried a `me` payload.
//   - The `completeOnboarding` flow sets the optimistic flag, then a
//     background `refreshCurrentSession()` runs; if the /me snapshot it
//     returns still reports `me.onboarding.isComplete=false` (the server
//     has not yet propagated completion, or the read is racy), the
//     optimistic flag is cleared and `isComplete` flips from true to
//     false in the same tick.
//   - When `OnboardingScreen` re-renders with `isComplete=false` it
//     redirects back to `/onboarding`, the user is bounced, and the
//     "Maximum update depth exceeded" loop restarts.
//
// The fix contract:
//   - The optimistic flag is a one-way latch. Once set, it only clears
//     when a fresh /me snapshot confirms `me.onboarding.isComplete=true`
//     (the server is the new source of truth and is even more optimistic
//     than our local flag).
//   - The latch lives in the AuthContext, not the screen, so a remount
//     of any consumer cannot reset it.
//
// These tests mount the REAL `AuthProvider` and exercise it through the
// public API only (no internal-state peeking). They use controlled
// mocks of `@/services/authService` to drive the post-completion flow.
//
/* eslint-disable @typescript-eslint/no-require-imports */

import { createElement as h } from 'react';
import { act, create } from 'react-test-renderer';
import type { AuthSession, CurrentMe } from '@/features/auth/types/auth';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { useAuth } from '@/features/auth/hooks/useAuth';

// Pull in the mock module so the tests can configure the mock
// functions. The `require` call is hoisted by jest.mock; using
// `require` here (not at the top) avoids referencing the mock before
// jest has had a chance to install it.
const mockAuthService = jest.requireMock('@/services/authService');

// Mocked surface of @/services/authService. Each test wires its own
// behavior; defaults are fail-loud so a missing mock is obvious.
// Lives in a separate CommonJS file so the hoisted jest.mock factory
// only references `require(...)`, which Jest's static analyzer allows.
jest.mock('@/services/authService', () => require('../fixtures/authServiceMock'));

// Mock expo-secure-store — AuthProvider never touches it but the real
// module imports native code on some platforms.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// AuthProvider itself only subscribes to AppState; keep the native surface
// deterministic so these tests remain focused on provider behavior.
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
    getCurrentState: () => 'active',
  },
  Appearance: {
    getColorScheme: () => 'light',
    addChangeListener: () => ({ remove: () => undefined }),
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => undefined }),
    removeEventListener: () => undefined,
  },
  TurboModuleRegistry: { get: () => null },
  Dimensions: {
    get: () => ({ window: { width: 1024, height: 768, scale: 1, fontScale: 1 } }),
    addEventListener: () => ({ remove: () => undefined }),
  },
  PixelRatio: { get: () => 1, getFontScale: () => 1 },
  Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  View: ({ children }: { children: unknown }) => children,
  Text: ({ children }: { children: unknown }) => children,
}));

function makeMe(overrides: Partial<CurrentMe> = {}): CurrentMe {
  return {
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
    onboarding: { isComplete: false },
    ...overrides,
  };
}

function makeSession(me: CurrentMe): AuthSession {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    tokenType: 'Bearer',
    me,
  };
}

interface Probe {
  isComplete: boolean | null;
  meOnboardingIsComplete: boolean | null;
}

function AuthProbe({
  probes,
  sink,
}: {
  probes: Probe[];
  sink: { v: ReturnType<typeof useAuth> | null };
}) {
  const auth = useAuth();
  probes.push({
    isComplete: auth.isComplete,
    meOnboardingIsComplete: auth.me?.onboarding.isComplete ?? null,
  });
  // Update the sink in the same render so the sink value tracks the
  // probe exactly. Without this, sibling probes can render in
  // different commits and the sink can lag the probe.
  // eslint-disable-next-line react-hooks/immutability -- Test harness exposes the latest context value to assertions.
  sink.v = auth;
  return null;
}

// Polls the probes array until the last entry matches the predicate.
// Used to wait for async restore effects to settle without coupling
// the test to a specific number of microtask ticks.
async function waitForProbe(
  probes: Probe[],
  predicate: (p: Probe) => boolean,
  maxTicks = 50
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    if (probes.length > 0 && predicate(probes[probes.length - 1])) {
      return;
    }
  }
}

// Polls the sink's `v` (the latest AuthContext value) until the
// predicate matches. The sink is updated on every render via the
// CapturingProbe, so a state change in the provider will surface
// here. Each tick also pumps a few microtasks so the
// `useEffect`-driven `restoreSession` (which sets the accessTokenRef
// synchronously inside `applySession`) has time to flush a render.
async function waitForSinkAuth(
  sink: { v: ReturnType<typeof useAuth> | null },
  predicate: (auth: ReturnType<typeof useAuth>) => boolean,
  maxTicks = 50
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    if (sink.v && predicate(sink.v)) {
      return;
    }
  }
}

// Renders a tree that contains BOTH a `CapturingProbe` (which captures
// the latest AuthContext value for invoking actions) and an `AuthProbe`
// (which records `isComplete` over time). Both probes share the same
// AuthProvider instance, so calls to `sink.v!.completeOnboarding(...)`
// are reflected in subsequent `probes` entries.
interface DualRenderHandle {
  tree: ReturnType<typeof create>;
  probes: Probe[];
  sink: { v: ReturnType<typeof useAuth> | null };
}

function renderDualProbe(): DualRenderHandle {
  const probes: Probe[] = [];
  const sink: { v: ReturnType<typeof useAuth> | null } = { v: null };
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(h(AuthProvider, null, h(AuthProbe, { probes, sink })));
  });
  return {
    tree: tree!,
    probes,
    sink,
  };
}

describe('AuthContext — optimisticComplete is a one-way latch (Judgment Day C2 follow-up, root-cause fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: empty session, no stored session, no refresh.
    mockAuthService.restoreSessionWithFreshMe.mockResolvedValue(null);
    mockAuthService.getStoredSession.mockResolvedValue(null);
    mockAuthService.persistOnboardingCompletionForStoredSession.mockResolvedValue(null);
    mockAuthService.refreshCurrentSession.mockResolvedValue(null);
    mockAuthService.clearSession.mockResolvedValue(undefined);
    mockAuthService.logout.mockResolvedValue(undefined);
  });

  function setupStaleHydration(me: CurrentMe): DualRenderHandle {
    const session = makeSession(me);
    mockAuthService.restoreSessionWithFreshMe.mockResolvedValue(session);
    mockAuthService.getStoredSession.mockResolvedValue(session);
    mockAuthService.persistOnboardingCompletionForStoredSession.mockResolvedValue(session);
    return renderDualProbe();
  }

  function stubSuccessfulCompleteOnboarding(user: CurrentMe['user']) {
    mockAuthService.completeOnboarding.mockResolvedValue({
      user: { ...user, onboardingCompletedAt: new Date().toISOString() },
      preferences: { diet: null, hardRestrictions: [], softPreferences: [] },
      slotCookingTimes: {
        breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        lunch: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        dinner: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
      },
    });
  }

  const onboardingPayload = {
    profile: { displayName: 'Test', householdSize: 1, cookingSkill: 'beginner' as const },
    preferences: { diet: null, hardRestrictions: [], softPreferences: [] },
    slotCookingTimes: {
      breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' as const },
      lunch: { cookingTimeMinutes: 0, hungerLevel: 'normal' as const },
      dinner: { cookingTimeMinutes: 0, hungerLevel: 'normal' as const },
    },
    timezone: 'UTC',
  };

  it('isComplete stays true even if a subsequent /me returns a stale snapshot with me.onboarding.isComplete=false (the latch holds)', async () => {
    // The smoking gun for the post-onboarding redirect ping-pong.
    // After completeOnboarding succeeds:
    //   1. The optimistic flag is set (isComplete=true).
    //   2. The follow-up refreshMe() returns a stale /me with
    //      me.onboarding.isComplete=false (server has not yet
    //      propagated completion, or the read is racy).
    //   3. Pre-fix: applySession cleared the flag → isComplete=false →
    //      OnboardingScreen bounces back to /onboarding → ping-pong.
    //   4. Post-fix: applySession keeps the flag (only clears when a
    //      fresh /me confirms isComplete=true) → isComplete stays
    //      true → no ping-pong.
    const staleMe = makeMe({ onboarding: { isComplete: false } });
    const handle = setupStaleHydration(staleMe);
    // Wait for the restore effect to populate the accessTokenRef
    // (the React state update for `accessToken` and the ref
    // assignment happen in the same `applySession` call).
    await waitForSinkAuth(handle.sink, (a) => a.accessToken !== null);

    expect(handle.sink.v).not.toBeNull();
    expect(handle.sink.v!.accessToken).not.toBeNull();

    stubSuccessfulCompleteOnboarding(staleMe.user);
    const stalePostSnapshot = makeMe({ onboarding: { isComplete: false } });
    mockAuthService.refreshCurrentSession.mockResolvedValue(makeSession(stalePostSnapshot));

    await act(async () => {
      await handle.sink.v!.completeOnboarding(onboardingPayload);
    });

    // Intermediate probe: capture the auth value at the moment the
    // post-completion /me refresh has just been applied. If the latch
    // regressed, applySession would have cleared the optimistic flag
    // here, flipping isComplete to false. Asserting on the sink
    // directly (not the last probe) is the contract: "isComplete is
    // still true at the moment applySession ran with the stale me".
    const latchProbe = handle.sink.v;
    expect(latchProbe).not.toBeNull();
    expect(latchProbe!.isComplete).toBe(true);
    expect(latchProbe!.me?.onboarding.isComplete).toBe(false);

    await waitForProbe(handle.probes, (p) => p.isComplete === true);

    const finalProbe = handle.probes[handle.probes.length - 1];
    expect(finalProbe.isComplete).toBe(true);
    expect(finalProbe.meOnboardingIsComplete).toBe(false);

    await act(async () => {
      handle.tree.unmount();
    });
  });

  // The profile fields the completion POST answers with in the tests below.
  const completedUser: CurrentMe['user'] = {
    id: 'user-1',
    email: 'user@example.com',
    displayName: 'Lucca',
    householdSize: 3,
    cookingSkill: 'advanced',
  };

  it('takes the profile fields from the follow-up /me, not from the completion answer', async () => {
    // A successful GET /api/me is the only source of displayName,
    // householdSize and cookingSkill. The two answers differ here on
    // purpose: the completion answer must reach neither `me` nor the stored
    // snapshot.
    const handle = setupStaleHydration(makeMe());
    await waitForSinkAuth(handle.sink, (a) => a.accessToken !== null);

    stubSuccessfulCompleteOnboarding(completedUser);
    const freshUser: CurrentMe['user'] = {
      ...completedUser,
      displayName: 'Lucca G.',
      householdSize: 5,
      cookingSkill: 'beginner',
    };
    mockAuthService.refreshCurrentSession.mockResolvedValue(
      makeSession(makeMe({ user: freshUser, onboarding: { isComplete: true } }))
    );
    mockAuthService.persistProfileForStoredSession.mockResolvedValue(null);

    await act(async () => {
      await handle.sink.v!.completeOnboarding(onboardingPayload);
    });
    await waitForSinkAuth(handle.sink, (a) => a.me?.onboarding.isComplete === true);

    expect(handle.sink.v!.me?.user).toEqual(freshUser);
    expect(handle.sink.v!.isComplete).toBe(true);
    expect(mockAuthService.persistProfileForStoredSession).not.toHaveBeenCalled();

    await act(async () => {
      handle.tree.unmount();
    });
  });

  it.each([
    {
      when: 'the follow-up /me fails',
      stubRefresh: () =>
        mockAuthService.refreshCurrentSession.mockRejectedValue(new Error('network down')),
    },
    {
      when: 'the follow-up refresh finds no session to read',
      stubRefresh: () => mockAuthService.refreshCurrentSession.mockResolvedValue(null),
    },
    {
      when: 'there is no stored session to refresh',
      stubRefresh: () =>
        mockAuthService.persistOnboardingCompletionForStoredSession.mockResolvedValue(null),
    },
  ])('falls back to the completion answer when $when', async ({ stubRefresh }) => {
    // Without a fresh /me the completion answer is all there is: it goes to
    // `me` and to the stored snapshot, so the User is not sent back to
    // Onboarding with empty fields.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handle = setupStaleHydration(makeMe());
    await waitForSinkAuth(handle.sink, (a) => a.accessToken !== null);

    stubSuccessfulCompleteOnboarding(completedUser);
    stubRefresh();
    mockAuthService.persistProfileForStoredSession.mockResolvedValue(null);

    await act(async () => {
      await handle.sink.v!.completeOnboarding(onboardingPayload);
    });
    await waitForSinkAuth(handle.sink, (a) => a.me?.user.householdSize === 3);

    expect(handle.sink.v!.me?.user).toEqual(completedUser);
    expect(handle.sink.v!.isComplete).toBe(true);
    expect(mockAuthService.persistProfileForStoredSession).toHaveBeenCalledTimes(1);
    expect(mockAuthService.persistProfileForStoredSession).toHaveBeenCalledWith(completedUser);

    warn.mockRestore();
    await act(async () => {
      handle.tree.unmount();
    });
  });

  it('the optimistic flag clears only when a fresh /me returns me.onboarding.isComplete=true', async () => {
    // Once the server catches up and reports isComplete=true, the
    // optimistic flag is redundant — the server is now the source
    // of truth. The flag clears (no harm), and isComplete remains
    // true via the server-confirmed value.
    const initialMe = makeMe({ onboarding: { isComplete: false } });
    const handle = setupStaleHydration(initialMe);
    // Wait for the post-restore auth value to flow into the sink.
    // (Both probes share the same provider, but the CapturingProbe
    // may render a tick behind the AuthProbe in some scheduler
    // interleavings; the wait guarantees the accessToken is
    // available before the test calls completeOnboarding.)
    await waitForSinkAuth(handle.sink, (a) => a.accessToken !== null, 100);
    if (handle.sink.v === null || handle.sink.v.accessToken === null) {
      throw new Error('AuthContext never settled with a non-null accessToken after restore');
    }

    stubSuccessfulCompleteOnboarding(initialMe.user);

    // First refresh (during completeOnboarding): stale snapshot.
    const staleSnapshot = makeMe({ onboarding: { isComplete: false } });
    mockAuthService.refreshCurrentSession.mockResolvedValueOnce(makeSession(staleSnapshot));

    await act(async () => {
      await handle.sink.v!.completeOnboarding(onboardingPayload);
    });
    await waitForProbe(handle.probes, (p) => p.isComplete === true, 100);

    // Second refresh (user pulled-to-refresh): server now confirms.
    const freshCompleteMe = makeMe({ onboarding: { isComplete: true } });
    mockAuthService.refreshCurrentSession.mockResolvedValueOnce(makeSession(freshCompleteMe));
    await act(async () => {
      await handle.sink.v!.refreshMe();
    });
    await waitForProbe(
      handle.probes,
      (p) => p.isComplete === true && p.meOnboardingIsComplete === true,
      100
    );

    const finalProbe = handle.probes[handle.probes.length - 1];
    expect(finalProbe.isComplete).toBe(true);
    expect(finalProbe.meOnboardingIsComplete).toBe(true);

    await act(async () => {
      handle.tree.unmount();
    });
  });
});
