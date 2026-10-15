import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { isApiError } from '@/api/errors';
import { renewPlanningSession } from '../api/planningApi';

// The server holds a Planning session two minutes past its last renewal, and at most 30 minutes
// from its start. Renewing once a minute keeps it alive with a renewal to spare.
export const PLANNING_RENEW_INTERVAL_MS = 60_000;

// What the server answers once it no longer holds the session: its lease ran out, it ended, or
// it is gone.
const LEASE_GONE_CODES: readonly string[] = ['lost_lock', 'terminal_lock', 'not_found'];

export interface PlanningLeaseState {
  /** The server no longer holds the session: the conversation cannot continue. */
  isLeaseLost: boolean;
}

/**
 * Keeps the Planning session `sessionId` alive while the planner screen is open and the app is in
 * the foreground, as `useCartLease` keeps a Cart (issue #28). Leaving the screen does not end the
 * session: it just stops being renewed and runs out. `null` means there is no session to keep.
 */
export function usePlanningLease(sessionId: string | null): PlanningLeaseState {
  const [isFocused, setIsFocused] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  // The session the server said it no longer holds: renewing it again would only fail again.
  const [lostSessionId, setLostSessionId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, [])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setIsAppActive(state === 'active');
    });

    return () => subscription.remove();
  }, []);

  const isLeaseLost = sessionId !== null && sessionId === lostSessionId;

  useEffect(() => {
    if (sessionId === null || isLeaseLost || !isFocused || !isAppActive) return;

    // A renewal that answers once the session changed must not mark the new one lost.
    let isCurrent = true;
    const renew = () => {
      renewPlanningSession(sessionId).catch((caught: unknown) => {
        if (isCurrent && isApiError(caught) && LEASE_GONE_CODES.includes(caught.code)) {
          setLostSessionId(sessionId);
        }
      });
    };

    // Back after a while away, the lease may be close to running out already.
    renew();
    const interval = setInterval(renew, PLANNING_RENEW_INTERVAL_MS);

    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [sessionId, isLeaseLost, isFocused, isAppActive]);

  return { isLeaseLost };
}
