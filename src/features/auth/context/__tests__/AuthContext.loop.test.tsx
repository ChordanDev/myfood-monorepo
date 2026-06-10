import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import type { CurrentMe } from '@/features/auth/types/auth';
import * as authService from '@/services/authService';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../../hooks/useAuth';

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

// Mock react-native-safe-area-context to bypass the nativewind
// SafeAreaProvider shim that reads Platform.OS at module load.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaConsumer: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 0, height: 0 }),
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

function makeSession(me: CurrentMe) {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    tokenType: 'Bearer',
    me,
  };
}

interface CapturedContext {
  me: CurrentMe | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  refreshMe: () => Promise<void>;
}

interface ConsumerProps {
  captures: CapturedContext[];
}

function Consumer({ captures }: ConsumerProps) {
  const ctx = useAuth();
  captures.push({
    me: ctx.me,
    isAuthenticated: ctx.isAuthenticated,
    isLoading: ctx.isLoading,
    refreshMe: ctx.refreshMe,
  });
  return <Text testID="consumer">ctx</Text>;
}

interface RenderOptions {
  restore?: jest.Mock;
  refresh?: jest.Mock;
  initialMe?: CurrentMe | null;
}

interface RenderResult {
  tree: ReturnType<typeof create>;
  captures: CapturedContext[];
  refreshCalls: { mock: jest.Mock };
  unmount: () => void;
}

function renderProvider({ restore, refresh, initialMe = null }: RenderOptions): RenderResult {
  const refreshCalls = { mock: jest.fn() };
  const wrappedRefresh: jest.Mock = refresh
    ? jest.fn().mockImplementation(refresh)
    : (jest.fn().mockResolvedValue(null) as unknown as jest.Mock);
  jest
    .spyOn(authService, 'restoreSessionWithFreshMe')
    .mockImplementation(restore ?? (async () => (initialMe ? makeSession(initialMe) : null)));
  jest.spyOn(authService, 'refreshCurrentSession').mockImplementation(async () => {
    refreshCalls.mock();
    return wrappedRefresh();
  });

  const captures: CapturedContext[] = [];

  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(
      <AuthProvider>
        <Consumer captures={captures} />
      </AuthProvider>
    );
  });

  return {
    tree: tree!,
    captures,
    refreshCalls,
    unmount: () => {
      act(() => {
        tree!.unmount();
      });
    },
  };
}

async function settle() {
  // Drain microtasks + a macrotask so any pending setTimeout(0) fires
  // inside an act boundary and triggers a re-render.
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  // Drain multiple macrotask cycles so any runaway setTimeout chain
  // has a chance to fire and the test can observe the bounded render
  // count it produces.
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((r) => {
      setImmediate(() => {
        act(() => {
          r();
        });
      });
    });
    for (let j = 0; j < 20; j += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
}

function lastContext(captures: CapturedContext[]): CapturedContext {
  if (captures.length === 0) {
    throw new Error('Consumer never rendered');
  }
  return captures[captures.length - 1];
}

describe('AuthProvider — infinite loop guard (Judgment Day C3)', () => {
  beforeEach(() => {
    mockSecureStore.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not re-render excessively when the trial has expired in the past (loop repro)', async () => {
    // The actual broken condition: trialEndsAt is in the past and
    // canUseApp is true (server has not yet flipped access.canUseApp).
    // The pre-fix effect re-scheduled a setTimeout on every `me`
    // reference change. The setTimeout delay overflowed the 32-bit
    // signed integer range and clamped to 1ms, producing a runaway
    // render count.
    const initialMe = makeMe({
      account: {
        ...makeMe().account,
        trialEndsAt: '2020-01-01T00:00:00Z', // long in the past
        subscriptionStatus: 'none',
        access: { canUseApp: true, reason: null },
      },
    });
    const refreshMock = jest
      .fn()
      .mockResolvedValue(makeSession(makeMe(initialMe.account as never)));

    const { captures, refreshCalls, unmount } = renderProvider({
      initialMe,
      refresh: refreshMock,
    });

    await settle();

    const finalRenders = captures.length;
    const finalCalls = refreshCalls.mock.mock.calls.length;

    // Bounded render count: before the fix the trial-expiry
    // setTimeout fires immediately on every `me` reference change,
    // growing the render count into the dozens. After the fix, the
    // trial effect fires at most once on mount (for already-expired
    // trials) and the render count stays in single digits.
    expect(finalRenders).toBeLessThan(10);
    // The trial effect may legitimately fire refreshMe once for an
    // already-expired trial (so the server can update access), but it
    // must NOT keep firing.
    expect(finalCalls).toBeLessThanOrEqual(1);

    unmount();
  });

  it('does not loop when refreshMe returns content-equal me (different object reference)', async () => {
    const firstMe = makeMe();
    const secondMe = makeMe(); // structurally identical, different object reference

    const refreshMock = jest.fn().mockResolvedValue(makeSession(secondMe));
    const { captures, refreshCalls, unmount } = renderProvider({
      initialMe: firstMe,
      refresh: refreshMock,
    });

    await settle();
    const afterSettleRenders = captures.length;
    const afterSettleRefreshCalls = refreshCalls.mock.mock.calls.length;

    // Call the public refreshMe through the latest captured context.
    await act(async () => {
      await lastContext(captures).refreshMe();
    });
    await settle();

    const finalRenders = captures.length;
    const finalRefreshCalls = refreshCalls.mock.mock.calls.length;
    const explicitRefreshRenders = finalRenders - afterSettleRenders;
    const explicitRefreshCalls = finalRefreshCalls - afterSettleRefreshCalls;

    // The post-settle baseline should have ZERO refresh calls and a
    // bounded render count. The trial-expiry timer overflows to 1ms
    // in the bug; after the fix, the timer is skipped for long delays.
    expect(afterSettleRefreshCalls).toBe(0);
    // The explicit refresh should add exactly 1 refresh invocation.
    expect(explicitRefreshCalls).toBe(1);
    // At most a single re-render is acceptable for a content-equal update.
    expect(explicitRefreshRenders).toBeLessThanOrEqual(1);

    unmount();
  });

  it('keeps me reference stable across refreshMe calls that return content-equal data', async () => {
    const firstMe = makeMe();
    const secondMe = makeMe();

    const refreshMock = jest.fn().mockResolvedValue(makeSession(secondMe));
    const { captures, unmount } = renderProvider({
      initialMe: firstMe,
      refresh: refreshMock,
    });
    await settle();

    // Capture the first non-null me from the captures sequence.
    // After the fix, refreshMe returning content-equal data should
    // not change the `me` reference.
    const firstRef = captures.find((c) => c.me !== null)?.me ?? null;
    expect(firstRef).toEqual(firstMe);

    const beforeCalls = refreshMock.mock.calls.length;
    await act(async () => {
      await lastContext(captures).refreshMe();
    });
    await settle();
    const secondRef = lastContext(captures).me;

    // The explicit refresh should have been invoked exactly once
    // (no chain from the trial/AppState effects).
    expect(refreshMock.mock.calls.length - beforeCalls).toBe(1);
    // me should be structurally equal to secondMe but referentially
    // equal to firstMe (the new content was equivalent, so setMe
    // was skipped or only mutated in place).
    expect(secondRef).toEqual(secondMe);
    expect(secondRef).toBe(firstRef);

    unmount();
  });

  it('does not loop on mount when restoreSessionWithFreshMe returns a stable snapshot', async () => {
    const initialMe = makeMe();
    const { captures, unmount } = renderProvider({ initialMe });

    await settle();

    const renderCountAfterHydration = captures.length;
    expect(renderCountAfterHydration).toBeGreaterThan(0);
    expect(renderCountAfterHydration).toBeLessThan(10);

    const ctx = lastContext(captures);
    expect(ctx.me).toEqual(initialMe);
    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.isLoading).toBe(false);

    unmount();
  });
});
