import { apiClient } from '@/api/client';
import type {
  AccountBudgetPayload,
  AccountBudgetResponse,
  AccountTimezonePayload,
  AccountTimezoneResponse,
} from '@/features/auth/types/auth';

export function updateAccountTimezone(
  payload: AccountTimezonePayload
): Promise<AccountTimezoneResponse> {
  return apiClient.put<AccountTimezoneResponse>('/api/account/timezone', payload, {
    auth: true,
  });
}

/** The Account's weekly Budget. Every member may read it. */
export function fetchAccountBudget(): Promise<AccountBudgetResponse> {
  return apiClient.get<AccountBudgetResponse>('/api/account/budget', { auth: true });
}

/** Sets the Account's weekly Budget. Only the owner may: anyone else gets `not_owner`. */
export function updateAccountBudget(payload: AccountBudgetPayload): Promise<AccountBudgetResponse> {
  return apiClient.put<AccountBudgetResponse>('/api/account/budget', payload, { auth: true });
}
