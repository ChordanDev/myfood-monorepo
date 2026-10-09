import { apiClient } from '@/api/client';
import type { AccountTimezonePayload, AccountTimezoneResponse } from '@/features/auth/types/auth';

export function updateAccountTimezone(
  payload: AccountTimezonePayload
): Promise<AccountTimezoneResponse> {
  return apiClient.put<AccountTimezoneResponse>('/api/account/timezone', payload, {
    auth: true,
  });
}
