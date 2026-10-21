import { useCallback, useRef, useState } from 'react';
import Purchases from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { getAuthErrorMessage, isApiError } from '@/api/errors';
import { useAuth } from '@/features/auth';
import { BILLING_COPY } from '../constants/billingCopy';
import { confirmWithServer, type ConfirmationKind } from '../services/confirmWithServer';
import { ensureIdentified, hasProEntitlement, isBillingEnabled } from '../services/revenueCat';

export type SubscribeStatus = 'idle' | 'opening' | 'confirming' | 'pending' | 'error';

export interface SubscribeState {
  /** Whether this build can sell the subscription at all (it has a RevenueCat key). */
  isAvailable: boolean;
  status: SubscribeStatus;
  /** Spanish copy for `pending` and `error`; `null` otherwise. */
  message: string | null;
  subscribe: () => Promise<void>;
  /** After a `pending` purchase or restore: asks the server again and refreshes `/me`. */
  checkAgain: () => Promise<void>;
}

/**
 * Whether the restore the Paywall reported found the subscription. A restore with nothing to
 * restore must not wait for a webhook that never comes. `unknown` when CustomerInfo cannot be
 * read: nothing says the store took a payment, so the Paywall stays reachable.
 */
async function restoreOutcome(): Promise<'found' | 'none' | 'unknown'> {
  try {
    return hasProEntitlement(await Purchases.getCustomerInfo()) ? 'found' : 'none';
  } catch {
    return 'unknown';
  }
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
  const { me, refreshMe } = useAuth();
  const accountId = me?.account.id ?? null;
  const [status, setStatus] = useState<SubscribeStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  // What the store completed last and for which Account, so checking again asks the same route.
  const lastConfirmationRef = useRef<{ accountId: string | null; kind: ConfirmationKind } | null>(
    null
  );

  // A switched Account starts clean: the previous Account's confirmation is not its own.
  const [shownAccountId, setShownAccountId] = useState(accountId);
  if (shownAccountId !== accountId) {
    setShownAccountId(accountId);
    setStatus('idle');
    setMessage(null);
  }

  const fail = useCallback((nextMessage: string) => {
    setStatus('error');
    setMessage(nextMessage);
  }, []);

  // The store already took the payment by now, so a failure here never offers the Paywall
  // again: the User checks again instead.
  const confirm = useCallback(
    async (kind: ConfirmationKind) => {
      lastConfirmationRef.current = { accountId, kind };
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
        setStatus('pending');
        setMessage(isApiError(error) ? getAuthErrorMessage(error) : BILLING_COPY.confirmError);
      }
    },
    [accountId, refreshMe]
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
        const restored = await restoreOutcome();
        if (restored === 'found') {
          await confirm('restore');
        } else if (restored === 'none') {
          setStatus('idle');
          setMessage(BILLING_COPY.nothingRestored);
        } else {
          // If the restore did reach the server, `/me` lets the User in anyway.
          await refreshMe().catch(() => undefined);
          fail(BILLING_COPY.restoreUnverified);
        }
      } else if (result === PAYWALL_RESULT.ERROR) {
        fail(BILLING_COPY.storeError);
      } else {
        setStatus('idle');
      }
    } finally {
      busyRef.current = false;
    }
  }, [confirm, fail, refreshMe]);

  const checkAgain = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const last = lastConfirmationRef.current;
      await confirm(last?.accountId === accountId ? last.kind : 'purchase');
    } finally {
      busyRef.current = false;
    }
  }, [accountId, confirm]);

  return { isAvailable: isBillingEnabled(), status, message, subscribe, checkAgain };
}
