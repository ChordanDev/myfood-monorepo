import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAuthErrorMessage, isApiError, isTransientAuthError } from '@/api/errors';
import { cancelCart, confirmCheckout, markInCart, renewCart } from '../api/shoppingApi';
import type { CartLease, CheckoutLine } from '../types';

// The server holds a Cart for a while after its last activity. Renewing at most once a
// minute keeps it alive without a request per tick or per render.
export const CART_RENEW_INTERVAL_MS = 60_000;

// What the server answers once it no longer holds the lease: it ran out or the Cart is gone.
// The last two are how a confirm says it.
const LEASE_GONE_CODES: readonly string[] = [
  'stale_cart',
  'cart_not_found',
  'cart_expired',
  'checkout_session_not_found',
];

function isLeaseGone(caught: unknown) {
  return isApiError(caught) && LEASE_GONE_CODES.includes(caught.code);
}

// How many renewals in a row may fail to reach the server before the screen says the Cart may
// have run out. One or two missed minutes are absorbed by a lease that lasts an hour.
export const CART_RENEW_FAILURES_BEFORE_NOTICE = 3;

// A renewal that did not reach the server, or that the server could not serve: the lease is
// unknown, not gone. A refusal for any other reason is not counted.
function isUnreachable(caught: unknown) {
  return isTransientAuthError(caught) || (isApiError(caught) && caught.status >= 500);
}

// How a confirm ended: the Cart was bought, the Cart is gone and there is nothing to confirm,
// or the server refused and the Cart is as it was.
export type CartConfirmOutcome = 'purchased' | 'cart_gone' | 'refused';

interface UseCartLeaseOptions {
  // The Cart the last read of the list reported for the signed-in Membership, if any.
  listCart: CartLease | null;
  // Reads the list again: it is the server's, so it is what shows what a Cart holds.
  refreshList: () => void;
}

// The Cart lease of the Membership while it shops: ticking items starts it, the screen being
// open and the app in the foreground keep it alive, and abandoning the Cart releases it.
// Leaving the screen does not cancel: the lease just stops being renewed and runs out. Buying
// the Cart ends it.
export function useCartLease({ listCart, refreshList }: UseCartLeaseOptions) {
  const [cart, setCart] = useState<CartLease | null>(listCart);
  const [isHeldByAnother, setIsHeldByAnother] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // What the last confirm was refused with while the Cart stays: it is said where the confirm
  // was asked, apart from the errors of the list.
  const [confirmError, setConfirmError] = useState<unknown>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  // A ref next to the state: two presses can land before the first one has re-rendered anything.
  const isConfirmingRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  // The `listCart` of the render before this one: what tells a read that just landed apart.
  const [lastSeenListCart, setLastSeenListCart] = useState(listCart);
  // The session this device ended, by abandoning the Cart or by buying it. A read of the list
  // asked before that can land after it and still report the Cart. It is state and not a ref
  // because it is read while rendering. A lease the server reported gone is not kept here:
  // for that one the read of the list decides.
  const [endedSessionId, setEndedSessionId] = useState<string | null>(null);
  // When the lease was last known to be extended: the last tick or the last renewal that
  // succeeded. Zero until one happened in this session, so a Cart found on opening the screen
  // is due. A failed renewal does not set it, so coming back to the screen or to the app asks
  // again at once.
  const lastActivityAt = useRef(0);
  // A renewal on its way: nothing else is sent until it answers.
  const isRenewingRef = useRef(false);
  // Per session, the renewals in a row that did not reach the server. Kept per session so that
  // a renewal of another Cart that answers late does not touch the count of the one on screen.
  const [failedRenewals, setFailedRenewals] = useState<Record<string, number>>({});

  // What the server reports is the truth: a read that lands replaces the local Cart, unless
  // it still reports the Cart this device ended. This is React's "derive state from props"
  // pattern: the state is adjusted while rendering, when the prop changed, and React renders
  // again before it draws anything. It is deliberately not an effect, which would first draw
  // a render that still holds the Cart of the read before.
  if (listCart !== lastSeenListCart) {
    setLastSeenListCart(listCart);
    setCart(listCart?.sessionId === endedSessionId ? null : listCart);
  }

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

  const sessionId = cart?.sessionId;

  // A lease that is gone on the server: nothing to renew, and the list says what is left.
  const dropCart = useCallback(() => {
    setCart(null);
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (sessionId === undefined || !isFocused || !isAppActive) return;

    const renewIfDue = () => {
      const now = Date.now();

      if (isRenewingRef.current) return;
      if (now - lastActivityAt.current < CART_RENEW_INTERVAL_MS) return;

      isRenewingRef.current = true;
      renewCart(sessionId)
        .then((lease) => {
          // When it was sent, so the next one is due a minute after this one, not later.
          lastActivityAt.current = Math.max(lastActivityAt.current, now);
          setFailedRenewals(({ [sessionId]: _succeeded, ...others }) => others);
          // A renewal that lands after the Cart was cancelled must not bring it back.
          setCart((prev) => (prev?.sessionId === lease.sessionId ? lease : prev));
        })
        .catch((caught: unknown) => {
          if (isLeaseGone(caught)) {
            dropCart();
          } else if (isUnreachable(caught)) {
            setFailedRenewals((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 }));
          }
        })
        .finally(() => {
          isRenewingRef.current = false;
        });
    };

    // Back after a while away, or after a renewal that failed, the lease may be due already.
    // In place, the interval keeps renewals a minute apart even while they fail.
    renewIfDue();
    const interval = setInterval(renewIfDue, CART_RENEW_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionId, isFocused, isAppActive, dropCart]);

  const markItems = useCallback(
    async (itemIds: string[]) => {
      setError(null);

      try {
        const marked = await markInCart(itemIds);

        lastActivityAt.current = Date.now();
        // The server was reached and extended the lease.
        setFailedRenewals(({ [marked.sessionId]: _reached, ...others }) => others);
        setIsHeldByAnother(false);
        // A Cart started again: whatever session the server gave it is one to take from a read.
        setEndedSessionId(null);
        setCart({ sessionId: marked.sessionId, leaseExpiresAt: marked.leaseExpiresAt });
        refreshList();
      } catch (caught) {
        if (isApiError(caught) && caught.code === 'cart_locked') {
          setIsHeldByAnother(true);
          setError(caught);
        } else if (isApiError(caught) && caught.code === 'stale_cart') {
          // The Cart ran out: the row goes back to how it was, so the error says why.
          setError(caught);
          dropCart();
        } else {
          // The row may be stale (gone or reserved meanwhile): read the list so it heals.
          setError(caught);
          refreshList();
        }
      }
    },
    [refreshList, dropCart]
  );

  const cancel = useCallback(async () => {
    if (sessionId === undefined) return;

    setError(null);

    try {
      await cancelCart(sessionId);
      setEndedSessionId(sessionId);
      dropCart();
    } catch (caught) {
      if (isLeaseGone(caught)) dropCart();
      else setError(caught);
    }
  }, [sessionId, dropCart]);

  // Buys the Cart in person. Only the lines bought at another quantity than the Cart holds are
  // passed. One confirm is on its way at a time; asking again after a failure is safe, since
  // the server answers a session it already confirmed with the result of the first time.
  const confirm = useCallback(
    async (lines: CheckoutLine[]): Promise<CartConfirmOutcome> => {
      if (sessionId === undefined || isConfirmingRef.current) return 'refused';

      isConfirmingRef.current = true;
      setIsConfirming(true);
      setError(null);
      setConfirmError(null);

      try {
        await confirmCheckout({ sessionId, checkoutType: 'physical', lines });
        setEndedSessionId(sessionId);
        dropCart();
        return 'purchased';
      } catch (caught) {
        if (isLeaseGone(caught)) {
          setError(caught);
          dropCart();
          return 'cart_gone';
        }

        setConfirmError(caught);
        return 'refused';
      } finally {
        isConfirmingRef.current = false;
        setIsConfirming(false);
      }
    },
    [sessionId, dropCart]
  );

  const dismissConfirmError = useCallback(() => setConfirmError(null), []);

  return {
    cart,
    markItems,
    cancel,
    confirm,
    isConfirming,
    // Why the last confirm was refused, while the Cart is still there to confirm again.
    confirmErrorMessage: confirmError === null ? undefined : getAuthErrorMessage(confirmError),
    dismissConfirmError,
    // Another member of the Account holds some of the items ticked.
    isHeldByAnother,
    // Renewals of the Cart on screen keep failing to reach the server: it may have run out.
    isRenewalFailing:
      sessionId !== undefined &&
      (failedRenewals[sessionId] ?? 0) >= CART_RENEW_FAILURES_BEFORE_NOTICE,
    errorMessage: error === null ? undefined : getAuthErrorMessage(error),
  };
}
