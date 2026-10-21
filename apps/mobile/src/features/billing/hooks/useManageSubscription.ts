import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import RevenueCatUI from 'react-native-purchases-ui';
import { getAuthErrorMessage, isApiError } from '@/api/errors';
import { useAuth } from '@/features/auth';
import { BILLING_COPY } from '../constants/billingCopy';
import { ensureIdentified, isBillingEnabled } from '../services/revenueCat';
import { useBillingStore } from '../store/useBillingStore';

export interface ManageSubscriptionState {
  /** Whether Settings shows the "Gestionar suscripción" entry. */
  canManage: boolean;
  openCustomerCenter: () => Promise<void>;
}

/**
 * The Settings entry that opens RevenueCat's Customer Center, where a subscribed User manages
 * or cancels the subscription. It shows when the Account has an active entitlement, by the
 * server's word or by RevenueCat's CustomerInfo. Closing the Customer Center refreshes `/me`,
 * so a cancellation the server already knows about shows at once.
 */
export function useManageSubscription(): ManageSubscriptionState {
  const { me, refreshMe } = useAuth();
  const hasProEntitlement = useBillingStore((state) => state.hasProEntitlement);
  const openingRef = useRef(false);

  const canManage =
    isBillingEnabled() && (me?.account.subscriptionStatus === 'active' || hasProEntitlement);

  const openCustomerCenter = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      await ensureIdentified();
      await RevenueCatUI.presentCustomerCenter();
    } catch (error) {
      Alert.alert(
        BILLING_COPY.manageErrorTitle,
        isApiError(error) ? getAuthErrorMessage(error) : BILLING_COPY.storeError
      );
      return;
    } finally {
      openingRef.current = false;
    }
    // The Customer Center did open; a failed refresh catches up on the next one.
    try {
      await refreshMe();
    } catch {
      // Nothing to tell the User: the subscription was managed.
    }
  }, [refreshMe]);

  return { canManage, openCustomerCenter };
}
