import { apiClient } from '@/api/client';
import { updateAccountTimezone } from '../accountApi';

jest.mock('@/api/client', () => ({ apiClient: { put: jest.fn() } }));

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
