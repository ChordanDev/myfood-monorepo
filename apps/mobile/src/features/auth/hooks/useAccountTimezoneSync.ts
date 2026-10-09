import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { CurrentMe } from '../types/auth';
import { updateAccountTimezone } from '@/services/authService';

function getDeviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Keeps the Account timezone in step with the device. The device zone is
 * sent on launch (once `me` is known) and on every return to the
 * foreground, only when it differs from the zone `me` reports. The User is
 * never asked, a failed request is swallowed (the next foreground retries)
 * and a request already in flight is never duplicated. `onSynced` receives
 * the stored zone so the caller can patch `me`.
 */
export function useAccountTimezoneSync(
  me: CurrentMe | null,
  onSynced: (timezone: string) => void
): void {
  const reportedTimezone = me ? me.account.timezone : undefined;
  const hasMe = me !== null;
  const reportedRef = useRef<string | null | undefined>(reportedTimezone);
  const onSyncedRef = useRef(onSynced);
  const inFlightRef = useRef(false);

  useEffect(() => {
    reportedRef.current = reportedTimezone;
    onSyncedRef.current = onSynced;
  });

  const syncRef = useRef(() => {
    const reported = reportedRef.current;
    if (reported === undefined || inFlightRef.current) return;

    const deviceTimezone = getDeviceTimezone();
    if (!deviceTimezone || deviceTimezone === reported) return;

    inFlightRef.current = true;
    void (async () => {
      try {
        const response = await updateAccountTimezone({ timezone: deviceTimezone });
        onSyncedRef.current(response.account.timezone ?? deviceTimezone);
      } catch {
        // Best effort: the next foreground tries again.
      } finally {
        inFlightRef.current = false;
      }
    })();
  });

  useEffect(() => {
    if (hasMe) syncRef.current();
  }, [hasMe, reportedTimezone]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') syncRef.current();
    });
    return () => subscription.remove();
  }, []);
}
