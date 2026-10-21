import { apiClient } from '@/api/client';

/** The Account's access state as the server sees it. The server is the source of truth. */
export interface BillingStatus {
  state: 'trial' | 'active' | 'expired';
  source: 'trial' | 'entitlement' | 'none';
  trial_started_at: string | null;
  trial_ends_at: string | null;
  latest_provider_event_at: string | null;
  /** The Account's RevenueCat id, issued by the server; `null` when none could be issued. */
  app_user_id: string | null;
}

export interface BillingStatusResponse {
  data: BillingStatus;
}

/**
 * The answer to a purchase or restore check: the current state while the Account has access,
 * or `pending_webhook` (HTTP 202) while RevenueCat's webhook has not granted it yet.
 */
export interface BillingConfirmationResponse {
  data: { state: 'pending_webhook' } | { state: 'trial' | 'active' | 'expired'; source: string };
}

export function fetchBillingStatus(): Promise<BillingStatusResponse> {
  return apiClient.get<BillingStatusResponse>('/api/billing/revenuecat/status', { auth: true });
}

/** Asks the server for the Account's state after the store completed a purchase. No body. */
export function confirmPurchase(): Promise<BillingConfirmationResponse> {
  return apiClient.post<BillingConfirmationResponse>(
    '/api/billing/revenuecat/purchase',
    undefined,
    {
      auth: true,
    }
  );
}

/** Asks the server for the Account's state after the store restored purchases. No body. */
export function confirmRestore(): Promise<BillingConfirmationResponse> {
  return apiClient.post<BillingConfirmationResponse>('/api/billing/revenuecat/restore', undefined, {
    auth: true,
  });
}
