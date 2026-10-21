import { useEffect } from 'react';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { useAuth } from '@/features/auth';
import {
  configureRevenueCat,
  hasProEntitlement,
  identifyAccount,
  signOutOfRevenueCat,
} from '../services/revenueCat';
import { useBillingStore } from '../store/useBillingStore';

/**
 * Keeps RevenueCat on the signed-in Account: configures the SDK at startup, logs in with the
 * Account's server-issued id after sign-in and on every Account switch, and logs out on
 * sign-out (an invalidated session included). It also follows CustomerInfo for the Pro
 * entitlement, which only drives the UI: access always comes from the server.
 */
export function useRevenueCatSession() {
  const { me, isLoading } = useAuth();
  const accountId = me?.account.id ?? null;

  useEffect(() => {
    if (!configureRevenueCat()) return;

    const listener = (customerInfo: CustomerInfo) => {
      const store = useBillingStore.getState();
      // Signed out or mid-switch: the update belongs to a user this app no longer shows.
      if (store.appUserId === null) return;
      store.setHasProEntitlement(hasProEntitlement(customerInfo));
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  useEffect(() => {
    // A restored session has no Account yet while it loads: wait instead of logging out.
    if (isLoading || !configureRevenueCat()) return;

    if (accountId === null) {
      signOutOfRevenueCat().catch(() => {
        // The next sign-in logs in with its own Account's id, replacing this one.
      });
      return;
    }

    identifyAccount().catch(() => {
      // Subscribing and managing the subscription identify again before opening any store UI.
    });
  }, [accountId, isLoading]);
}
