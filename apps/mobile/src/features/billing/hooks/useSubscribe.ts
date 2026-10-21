import { useCallback, useRef, useState } from 'react';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { getAuthErrorMessage, isApiError } from '@/api/errors';
import { useAuth } from '@/features/auth';
import { BILLING_COPY } from '../constants/billingCopy';
import { confirmWithServer, type ConfirmationKind } from '../services/confirmWithServer';
import { ensureIdentified, isBillingEnabled } from '../services/revenueCat';

export type SubscribeStatus = 'idle' | 'opening' | 'confirming' | 'pending' | 'error';

export interface SubscribeState {
  /** Whether this build can sell the subscription at all (it has a RevenueCat key). */
  isAvailable: boolean;
  status: SubscribeStatus;
  /** Spanish copy for `pending` and `error`; `null` otherwise. */
  message: string | null;
  subscribe: () => Promise<void>;
  /** After a `pending` purchase: asks the server again and refreshes `/me`. */
  checkAgain: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return isApiError(error) ? getAuthErrorMessage(error) : BILLING_COPY.identityError;
}

/**
 * The TrialExpired subscribe flow: logs RevenueCat in with the Account's server-issued id,
 * presents the Paywall for the current Offering, then lets the server confirm the purchase or
 * restore before refreshing `/me`, which moves the User on once the Account has access.
 * Cancelling the Paywall is not an error.
 */
export function useSubscribe(): SubscribeState {
  const { refreshMe } = useAuth();
  const [status, setStatus] = useState<SubscribeStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);

  const fail = useCallback((nextMessage: string) => {
    setStatus('error');
    setMessage(nextMessage);
  }, []);

  const confirm = useCallback(
    async (kind: ConfirmationKind) => {
      setStatus('confirming');
      setMessage(null);
      try {
        const outcome = await confirmWithServer(kind);
        await refreshMe();
        if (outcome === 'pending') {
          setStatus('pending');
          setMessage(BILLING_COPY.pending);
        } else {
          setStatus('idle');
        }
      } catch (error) {
        fail(isApiError(error) ? getAuthErrorMessage(error) : BILLING_COPY.confirmError);
      }
    },
    [fail, refreshMe]
  );

  const subscribe = useCallback(async () => {
    if (busyRef.current) return;
    if (!isBillingEnabled()) {
      fail(BILLING_COPY.unavailable);
      return;
    }

    busyRef.current = true;
    setStatus('opening');
    setMessage(null);
    try {
      // Never open the store before RevenueCat is logged in with the server's id.
      try {
        await ensureIdentified();
      } catch (error) {
        fail(errorMessage(error));
        return;
      }

      let result: PAYWALL_RESULT;
      try {
        result = await RevenueCatUI.presentPaywall();
      } catch {
        fail(BILLING_COPY.storeError);
        return;
      }

      if (result === PAYWALL_RESULT.PURCHASED) {
        await confirm('purchase');
      } else if (result === PAYWALL_RESULT.RESTORED) {
        await confirm('restore');
      } else if (result === PAYWALL_RESULT.ERROR) {
        fail(BILLING_COPY.storeError);
      } else {
        setStatus('idle');
      }
    } finally {
      busyRef.current = false;
    }
  }, [confirm, fail]);

  const checkAgain = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await confirm('purchase');
    } finally {
      busyRef.current = false;
    }
  }, [confirm]);

  return { isAvailable: isBillingEnabled(), status, message, subscribe, checkAgain };
}
