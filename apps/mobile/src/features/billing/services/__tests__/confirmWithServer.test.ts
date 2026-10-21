import { confirmPurchase, confirmRestore } from '../../api/billingApi';
import { PENDING_WEBHOOK_RETRY_DELAYS_MS } from '../../constants';
import { confirmWithServer } from '../confirmWithServer';

jest.mock('../../api/billingApi', () => ({
  confirmPurchase: jest.fn(),
  confirmRestore: jest.fn(),
}));

const pending = { data: { state: 'pending_webhook' } };
const active = { data: { state: 'active', source: 'entitlement' } };

describe('confirmWithServer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks again with backoff while the webhook is pending, then confirms', async () => {
    (confirmPurchase as jest.Mock)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(active);
    const sleep = jest.fn((_ms: number) => Promise.resolve());

    await expect(confirmWithServer('purchase', sleep)).resolves.toBe('confirmed');

    expect(confirmPurchase).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    expect(confirmRestore).not.toHaveBeenCalled();
  });

  it('stays pending once every retry still answers pending_webhook', async () => {
    (confirmPurchase as jest.Mock).mockResolvedValue(pending);
    const sleep = jest.fn((_ms: number) => Promise.resolve());

    await expect(confirmWithServer('purchase', sleep)).resolves.toBe('pending');

    expect(confirmPurchase).toHaveBeenCalledTimes(PENDING_WEBHOOK_RETRY_DELAYS_MS.length + 1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(PENDING_WEBHOOK_RETRY_DELAYS_MS);
  });

  it('checks a restore on the restore route', async () => {
    (confirmRestore as jest.Mock).mockResolvedValue(active);

    await expect(confirmWithServer('restore', jest.fn())).resolves.toBe('confirmed');
    expect(confirmRestore).toHaveBeenCalledTimes(1);
    expect(confirmPurchase).not.toHaveBeenCalled();
  });

  it('lets a network error through without retrying', async () => {
    const error = new Error('offline');
    (confirmPurchase as jest.Mock).mockRejectedValue(error);
    const sleep = jest.fn();

    await expect(confirmWithServer('purchase', sleep)).rejects.toBe(error);
    expect(sleep).not.toHaveBeenCalled();
  });
});
