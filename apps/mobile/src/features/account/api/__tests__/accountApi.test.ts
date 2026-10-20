import { apiClient } from '@/api/client';
import { fetchAccountBudget, updateAccountBudget, updateAccountTimezone } from '../accountApi';

jest.mock('@/api/client', () => ({ apiClient: { get: jest.fn(), put: jest.fn() } }));

describe('updateAccountTimezone', () => {
  it('PUTs the timezone to the account endpoint with the session token', async () => {
    const response = { account: { id: 'a1', timezone: 'Europe/Madrid' } };
    (apiClient.put as jest.Mock).mockResolvedValue(response);

    await expect(updateAccountTimezone({ timezone: 'Europe/Madrid' })).resolves.toBe(response);
    expect(apiClient.put).toHaveBeenCalledWith(
      '/api/account/timezone',
      { timezone: 'Europe/Madrid' },
      { auth: true }
    );
  });
});

const budgetResponse = {
  budget: {
    weeklyBudgetCents: 60000,
    isDefault: false,
    minWeeklyBudgetCents: 30000,
    currency: 'ARS',
  },
};

describe('fetchAccountBudget', () => {
  it("GETs the Account's weekly Budget with the session token", async () => {
    (apiClient.get as jest.Mock).mockResolvedValue(budgetResponse);

    await expect(fetchAccountBudget()).resolves.toBe(budgetResponse);
    expect(apiClient.get).toHaveBeenCalledWith('/api/account/budget', { auth: true });
  });
});

describe('updateAccountBudget', () => {
  it('PUTs the amount in cents with the session token', async () => {
    (apiClient.put as jest.Mock).mockResolvedValue(budgetResponse);

    await expect(updateAccountBudget({ weeklyBudgetCents: 60000 })).resolves.toBe(budgetResponse);
    expect(apiClient.put).toHaveBeenCalledWith(
      '/api/account/budget',
      { weeklyBudgetCents: 60000 },
      { auth: true }
    );
  });
});
