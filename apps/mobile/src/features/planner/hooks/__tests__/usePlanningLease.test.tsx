/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import * as planningApi from '../../api/planningApi';
import { PLANNING_RENEW_INTERVAL_MS, usePlanningLease } from '../usePlanningLease';

jest.mock('../../api/planningApi');

// The screen is in focus until a test says otherwise; the cleanup is what leaving it runs.
let mockSetFocused: ((focused: boolean) => void) | undefined;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');

  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        let cleanup = effect();
        mockSetFocused = (focused) => {
          if (focused && !cleanup) cleanup = effect();
          if (!focused && cleanup) {
            cleanup();
            cleanup = undefined;
          }
        };
        return () => cleanup?.();
      }, [effect]);
    },
  };
});

const api = planningApi as jest.Mocked<typeof planningApi>;

type Lease = ReturnType<typeof usePlanningLease>;

function setup(sessionId: string | null) {
  const result: { current: Lease } = { current: undefined as unknown as Lease };
  let appStateListener: ((state: string) => void) | undefined;
  let renderer: ReturnType<typeof create> | undefined;

  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: string) => void;
    return { remove: () => (appStateListener = undefined) } as ReturnType<
      typeof AppState.addEventListener
    >;
  });

  function Harness({ session }: { session: string | null }) {
    result.current = usePlanningLease(session);
    return null;
  }

  act(() => {
    renderer = create(<Harness session={sessionId} />);
  });

  return {
    result,
    setSession: (session: string | null) =>
      act(() => renderer?.update(<Harness session={session} />)),
    setAppState: (state: string) => act(() => appStateListener?.(state)),
    setFocused: (focused: boolean) => act(() => mockSetFocused?.(focused)),
    unmount: () => act(() => renderer?.unmount()),
  };
}

async function tick(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('usePlanningLease', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    (AppState as { currentState: string }).currentState = 'active';
    api.renewPlanningSession.mockResolvedValue({
      sessionId: 'session-1',
      leaseExpiresAt: '2030-01-01T12:02:00Z',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renews the session at once and then every 60 seconds while the screen is open', async () => {
    const { unmount } = setup('session-1');
    await tick(0);

    expect(api.renewPlanningSession).toHaveBeenCalledTimes(1);
    expect(api.renewPlanningSession).toHaveBeenCalledWith('session-1');

    await tick(PLANNING_RENEW_INTERVAL_MS);
    await tick(PLANNING_RENEW_INTERVAL_MS);

    expect(api.renewPlanningSession).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('renews nothing while there is no session', async () => {
    setup(null);

    await tick(PLANNING_RENEW_INTERVAL_MS * 3);

    expect(api.renewPlanningSession).not.toHaveBeenCalled();
  });

  it('stops renewing once the session is over for the screen', async () => {
    const { setSession } = setup('session-1');
    await tick(0);

    setSession(null);
    await tick(PLANNING_RENEW_INTERVAL_MS * 3);

    expect(api.renewPlanningSession).toHaveBeenCalledTimes(1);
  });

  it('does not renew while the screen is out of focus or the app is in the background', async () => {
    const { setFocused, setAppState } = setup('session-1');
    await tick(0);

    setFocused(false);
    await tick(PLANNING_RENEW_INTERVAL_MS * 2);
    expect(api.renewPlanningSession).toHaveBeenCalledTimes(1);

    setFocused(true);
    await tick(0);
    expect(api.renewPlanningSession).toHaveBeenCalledTimes(2);

    setAppState('background');
    await tick(PLANNING_RENEW_INTERVAL_MS * 2);
    expect(api.renewPlanningSession).toHaveBeenCalledTimes(2);
  });

  it.each(['lost_lock', 'terminal_lock', 'not_found'] as const)(
    'tells that the session is lost and stops renewing on %s',
    async (code) => {
      api.renewPlanningSession.mockRejectedValue(new ApiError(code, 'gone', 409));
      const { result } = setup('session-1');
      await tick(0);

      expect(result.current.isLeaseLost).toBe(true);

      await tick(PLANNING_RENEW_INTERVAL_MS * 2);
      expect(api.renewPlanningSession).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps the session and tries again on the next tick after a network error', async () => {
    api.renewPlanningSession.mockRejectedValueOnce(new ApiError('network_error', 'offline', 0));
    const { result } = setup('session-1');
    await tick(0);

    expect(result.current.isLeaseLost).toBe(false);

    await tick(PLANNING_RENEW_INTERVAL_MS);
    expect(api.renewPlanningSession).toHaveBeenCalledTimes(2);
  });

  it('forgets a lost lease once another session starts', async () => {
    api.renewPlanningSession.mockRejectedValueOnce(new ApiError('lost_lock', 'gone', 409));
    const { result, setSession } = setup('session-1');
    await tick(0);
    expect(result.current.isLeaseLost).toBe(true);

    setSession('session-2');
    await tick(0);

    expect(result.current.isLeaseLost).toBe(false);
    expect(api.renewPlanningSession).toHaveBeenLastCalledWith('session-2');
  });
});
