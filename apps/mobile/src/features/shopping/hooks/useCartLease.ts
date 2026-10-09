import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAuthErrorMessage, isApiError } from '@/api/errors';
import { cancelCart, markInCart, renewCart } from '../api/shoppingApi';
import type { ShoppingCart } from '../types';

// The server holds a Cart for a while after its last activity. Renewing at most once a
// minute keeps it alive without a request per tick or per render.
export const CART_RENEW_INTERVAL_MS = 60_000;

interface UseCartLeaseOptions {
  // The Cart the last read of the list reported for the signed-in Membership, if any.
  listCart: ShoppingCart | null;
  // Reads the list again: it is the server's, so it is what shows what a Cart holds.
  refreshList: () => void;
}

// The Cart lease of the Membership while it shops: ticking items starts it, the screen being
// open and the app in the foreground keep it alive, and abandoning the Cart releases it.
// Leaving the screen does not cancel: the lease just stops being renewed and runs out.
export function useCartLease({ listCart, refreshList }: UseCartLeaseOptions) {
  const [cart, setCart] = useState<ShoppingCart | null>(listCart);
  const [isHeldByAnother, setIsHeldByAnother] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const [readCart, setReadCart] = useState(listCart);
  // When the lease was last known to be extended: the last tick or the last renewal. Zero
  // until one happened in this session, so a Cart found on opening the screen is due.
  const lastActivityAt = useRef(0);

  // What the server reports is the truth: a read that lands replaces the local Cart.
  if (listCart !== readCart) {
    setReadCart(listCart);
    setCart(listCart);
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
      if (Date.now() - lastActivityAt.current < CART_RENEW_INTERVAL_MS) return;

      lastActivityAt.current = Date.now();
      renewCart(sessionId)
        .then(setCart)
        .catch((caught: unknown) => {
          if (isApiError(caught) && ['stale_cart', 'cart_not_found'].includes(caught.code)) {
            dropCart();
          }
        });
    };

    // Back after a while away, the lease may be due already.
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
        setIsHeldByAnother(false);
        setCart({ sessionId: marked.sessionId, leaseExpiresAt: marked.leaseExpiresAt });
        refreshList();
      } catch (caught) {
        if (isApiError(caught) && caught.code === 'cart_locked') {
          setIsHeldByAnother(true);
          setError(caught);
        } else if (isApiError(caught) && caught.code === 'stale_cart') {
          dropCart();
        } else {
          setError(caught);
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
      dropCart();
    } catch (caught) {
      if (isApiError(caught) && caught.code === 'cart_not_found') dropCart();
      else setError(caught);
    }
  }, [sessionId, dropCart]);

  return {
    cart,
    markItems,
    cancel,
    // Another member of the Account holds some of the items ticked.
    isHeldByAnother,
    errorMessage: error === null ? undefined : getAuthErrorMessage(error),
  };
}
