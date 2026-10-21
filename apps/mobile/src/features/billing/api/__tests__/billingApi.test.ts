import { apiClient } from '@/api/client';
import { confirmPurchase, confirmRestore, fetchBillingStatus } from '../billingApi';

jest.mock('@/api/client', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));

describe('billingApi', () => {
  beforeEach(() => jest.clearAllMocks());

  it("GETs the Account's billing status with the session token", async () => {
    const response = { data: { state: 'expired', app_user_id: 'rc-1' } };
    (apiClient.get as jest.Mock).mockResolvedValue(response);

    await expect(fetchBillingStatus()).resolves.toBe(response);
    expect(apiClient.get).toHaveBeenCalledWith('/api/billing/revenuecat/status', { auth: true });
  });

  it('POSTs a purchase check with no body', async () => {
    const response = { data: { state: 'pending_webhook' } };
    (apiClient.post as jest.Mock).mockResolvedValue(response);

    await expect(confirmPurchase()).resolves.toBe(response);
    expect(apiClient.post).toHaveBeenCalledWith('/api/billing/revenuecat/purchase', undefined, {
      auth: true,
    });
  });

  it('POSTs a restore check with no body', async () => {
    const response = { data: { state: 'active', source: 'entitlement' } };
    (apiClient.post as jest.Mock).mockResolvedValue(response);

    await expect(confirmRestore()).resolves.toBe(response);
    expect(apiClient.post).toHaveBeenCalledWith('/api/billing/revenuecat/restore', undefined, {
      auth: true,
    });
  });
});
