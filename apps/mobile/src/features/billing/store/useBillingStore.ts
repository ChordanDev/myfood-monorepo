import { create } from 'zustand';

interface BillingState {
  /** The server-issued id RevenueCat is logged in with, or `null` before `logIn`. */
  appUserId: string | null;
  /** Whether RevenueCat's CustomerInfo has the Pro entitlement active. Never grants access. */
  hasProEntitlement: boolean;
  setIdentity: (appUserId: string, hasProEntitlement: boolean) => void;
  setHasProEntitlement: (hasProEntitlement: boolean) => void;
  reset: () => void;
}

export const useBillingStore = create<BillingState>((set) => ({
  appUserId: null,
  hasProEntitlement: false,
  setIdentity: (appUserId, hasProEntitlement) => set({ appUserId, hasProEntitlement }),
  setHasProEntitlement: (hasProEntitlement) => set({ hasProEntitlement }),
  reset: () => set({ appUserId: null, hasProEntitlement: false }),
}));
