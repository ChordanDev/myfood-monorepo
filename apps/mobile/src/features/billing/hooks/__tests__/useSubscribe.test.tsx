/* eslint-disable @typescript-eslint/no-require-imports */
import { act, create } from 'react-test-renderer';
import Purchases from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { ApiError } from '@/api/errors';
import { AuthContext } from '@/features/auth/context/AuthContext';
import type { AuthContextValue } from '@/features/auth/types/auth';
import { confirmPurchase, confirmRestore, fetchBillingStatus } from '../../api/billingApi';
import { BILLING_COPY } from '../../constants/billingCopy';
import { useBillingStore } from '../../store/useBillingStore';
import { useSubscribe, type SubscribeState } from '../useSubscribe';

jest.mock('@/features/auth', () => {
  const ReactMock = require('react');
  const mockAuthContext = require('@/features/auth/context/AuthContext').AuthContext;
  return { useAuth: () => ReactMock.useContext(mockAuthContext) };
});

jest.mock('../../api/billingApi', () => ({
  fetchBillingStatus: jest.fn(),
  confirmPurchase: jest.fn(),
  confirmRestore: jest.fn(),
}));

// No real waiting between `pending_webhook` answers.
jest.mock('../../constants', () => ({
  PRO_ENTITLEMENT_ID: 'brosky_company_pro',
  PENDING_WEBHOOK_RETRY_DELAYS_MS: [0, 0],
}));

const mockPurchases = jest.mocked(Purchases);
const mockPaywall = jest.mocked(RevenueCatUI);
const SERVER_ID = 'rc-5b0c-issued-by-server';
const emptyCustomerInfo = { entitlements: { active: {}, all: {} } } as never;
const proCustomerInfo = {
  entitlements: { active: { brosky_company_pro: { identifier: 'brosky_company_pro' } }, all: {} },
} as never;
const pending = { data: { state: 'pending_webhook' } };
const active = { data: { state: 'active', source: 'entitlement' } };

async function render() {
  const result = { current: null as unknown as SubscribeState };
  function Probe() {
    result.current = useSubscribe();
    return null;
  }

  const refreshMe = jest.fn(() => Promise.resolve());
  const value = { refreshMe } as unknown as AuthContextValue;
  await act(async () => {
    create(
      <AuthContext.Provider value={value}>
        <Probe />
      </AuthContext.Provider>
    );
  });
  return { result, refreshMe };
}

type Rendered = Awaited<ReturnType<typeof render>>;

async function subscribe({ result }: Rendered) {
  await act(async () => {
    await result.current.subscribe();
  });
}

const ORIGINAL_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

describe('useSubscribe', () => {
  beforeAll(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = 'test_placeholder_key';
  });

  afterAll(() => {
    // Assigning `undefined` would store the string 'undefined', a key for every later test.
    if (ORIGINAL_KEY === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
    else process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = ORIGINAL_KEY;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useBillingStore.getState().reset();
    (fetchBillingStatus as jest.Mock).mockResolvedValue({ data: { app_user_id: SERVER_ID } });
  });

  it('opens the Paywall only after RevenueCat is logged in with the server id', async () => {
    const rendered = await render();

    await subscribe(rendered);

    expect(mockPurchases.logIn).toHaveBeenCalledWith(SERVER_ID);
    expect(mockPaywall.presentPaywall).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn.mock.invocationCallOrder[0]).toBeLessThan(
      mockPaywall.presentPaywall.mock.invocationCallOrder[0]
    );
  });

  it('confirms a purchase through pending_webhook, then refreshes /me', async () => {
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.PURCHASED);
    (confirmPurchase as jest.Mock).mockResolvedValueOnce(pending).mockResolvedValueOnce(active);
    const rendered = await render();
    const { result, refreshMe } = rendered;

    await subscribe(rendered);

    expect(confirmPurchase).toHaveBeenCalledTimes(2);
    expect(confirmRestore).not.toHaveBeenCalled();
    expect(refreshMe).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.message).toBeNull();
  });

  it('stays pending when the webhook never lands, and checks again on demand', async () => {
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.PURCHASED);
    (confirmPurchase as jest.Mock).mockResolvedValue(pending);
    const rendered = await render();
    const { result, refreshMe } = rendered;

    await subscribe(rendered);

    expect(confirmPurchase).toHaveBeenCalledTimes(3);
    expect(refreshMe).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('pending');
    expect(result.current.message).toBe(BILLING_COPY.pending);

    (confirmPurchase as jest.Mock).mockResolvedValue(active);
    await act(async () => {
      await result.current.checkAgain();
    });

    expect(refreshMe).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('idle');
    expect(mockPaywall.presentPaywall).toHaveBeenCalledTimes(1);
  });

  it('confirms a purchase whose webhook started the one-time trial', async () => {
    // An Account with no trial on record starts it on the first webhook, and the server
    // answers `trial` ahead of `active` while that window runs.
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.PURCHASED);
    (confirmPurchase as jest.Mock)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ data: { state: 'trial', source: 'trial' } });
    const rendered = await render();
    const { result, refreshMe } = rendered;

    await subscribe(rendered);

    expect(confirmPurchase).toHaveBeenCalledTimes(2);
    expect(refreshMe).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.message).toBeNull();
  });

  it('confirms a restore on the restore route', async () => {
    mockPurchases.getCustomerInfo.mockResolvedValueOnce(proCustomerInfo);
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.RESTORED);
    (confirmRestore as jest.Mock).mockResolvedValueOnce(active);
    const rendered = await render();
    const { refreshMe } = rendered;

    await subscribe(rendered);

    expect(confirmRestore).toHaveBeenCalledTimes(1);
    expect(confirmPurchase).not.toHaveBeenCalled();
    expect(refreshMe).toHaveBeenCalledTimes(1);
  });

  it('keeps "Suscribirme" when a restore found no subscription', async () => {
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.RESTORED);
    mockPurchases.getCustomerInfo.mockResolvedValueOnce(emptyCustomerInfo);
    const rendered = await render();
    const { result, refreshMe } = rendered;

    await subscribe(rendered);

    expect(confirmRestore).not.toHaveBeenCalled();
    expect(refreshMe).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.message).toBe(BILLING_COPY.nothingRestored);
  });

  it('keeps "Suscribirme" when CustomerInfo cannot be read after a restore', async () => {
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.RESTORED);
    mockPurchases.getCustomerInfo.mockRejectedValueOnce(new Error('store unreachable'));
    (confirmRestore as jest.Mock).mockResolvedValue(pending);
    const rendered = await render();
    const { result, refreshMe } = rendered;
    // Best effort: a failed refresh keeps the same error.
    refreshMe.mockRejectedValueOnce(new ApiError('network_error', 'Network request failed'));

    await subscribe(rendered);

    expect(confirmRestore).not.toHaveBeenCalled();
    // `/me` still unlocks the app if the restore did reach the server.
    expect(refreshMe).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    expect(result.current.message).toBe(BILLING_COPY.restoreUnverified);
  });

  it('treats a cancelled Paywall as no error', async () => {
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.CANCELLED);
    const rendered = await render();
    const { result, refreshMe } = rendered;

    await subscribe(rendered);

    expect(confirmPurchase).not.toHaveBeenCalled();
    expect(refreshMe).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.message).toBeNull();
  });

  it('shows a store error when the Paywall fails', async () => {
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.ERROR);
    const rendered = await render();
    const { result } = rendered;

    await subscribe(rendered);

    expect(confirmPurchase).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
    expect(result.current.message).toBe(BILLING_COPY.storeError);
  });

  it('keeps a paid purchase to check again when the confirmation cannot reach the server', async () => {
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.PURCHASED);
    (confirmPurchase as jest.Mock).mockRejectedValueOnce(
      new ApiError('network_error', 'Network request failed')
    );
    const rendered = await render();
    const { result, refreshMe } = rendered;

    await subscribe(rendered);

    expect(refreshMe).not.toHaveBeenCalled();
    expect(result.current.status).toBe('pending');
    expect(result.current.message).toBe('No pudimos conectar con el servidor. Revisá tu conexión.');

    (confirmPurchase as jest.Mock).mockResolvedValueOnce(active);
    await act(async () => {
      await result.current.checkAgain();
    });

    expect(confirmPurchase).toHaveBeenCalledTimes(2);
    expect(mockPaywall.presentPaywall).toHaveBeenCalledTimes(1);
    expect(refreshMe).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });

  it('checks a pending restore again on the restore route', async () => {
    mockPurchases.getCustomerInfo.mockResolvedValueOnce(proCustomerInfo);
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.RESTORED);
    (confirmRestore as jest.Mock).mockResolvedValue(pending);
    const rendered = await render();
    const { result } = rendered;

    await subscribe(rendered);
    expect(result.current.status).toBe('pending');

    (confirmRestore as jest.Mock).mockResolvedValue(active);
    await act(async () => {
      await result.current.checkAgain();
    });

    expect(confirmPurchase).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('keeps the purchase to check again when /me cannot be refreshed after it', async () => {
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.PURCHASED);
    (confirmPurchase as jest.Mock).mockResolvedValueOnce(active);
    const rendered = await render();
    const { result, refreshMe } = rendered;
    refreshMe.mockRejectedValueOnce(new ApiError('network_error', 'Network request failed'));

    await subscribe(rendered);

    expect(result.current.status).toBe('pending');
    expect(result.current.message).toBe('No pudimos conectar con el servidor. Revisá tu conexión.');
  });

  it("forgets the previous Account's pending confirmation when the Account changes", async () => {
    mockPurchases.getCustomerInfo.mockResolvedValueOnce(proCustomerInfo);
    mockPaywall.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.RESTORED);
    (confirmRestore as jest.Mock).mockResolvedValue(pending);
    const result = { current: null as unknown as SubscribeState };
    function Probe() {
      result.current = useSubscribe();
      return null;
    }
    const refreshMe = jest.fn(() => Promise.resolve());
    const signedInAs = (accountId: string) =>
      ({ me: { account: { id: accountId } }, refreshMe }) as unknown as AuthContextValue;
    const tree = (value: AuthContextValue) => (
      <AuthContext.Provider value={value}>
        <Probe />
      </AuthContext.Provider>
    );
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(tree(signedInAs('account-a')));
    });

    await act(async () => {
      await result.current.subscribe();
    });
    expect(result.current.status).toBe('pending');

    await act(async () => {
      renderer?.update(tree(signedInAs('account-b')));
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.message).toBeNull();

    (confirmPurchase as jest.Mock).mockResolvedValueOnce(active);
    await act(async () => {
      await result.current.checkAgain();
    });

    expect(confirmRestore).toHaveBeenCalledTimes(3);
    expect(confirmPurchase).toHaveBeenCalledTimes(1);
  });

  it("lets the next Account subscribe while the previous one's confirmation still runs", async () => {
    let answerFirstCheck: (value: unknown) => void = () => {};
    (confirmPurchase as jest.Mock)
      .mockReturnValueOnce(new Promise((resolve) => (answerFirstCheck = resolve)))
      .mockResolvedValue(pending);
    mockPaywall.presentPaywall
      .mockResolvedValueOnce(PAYWALL_RESULT.PURCHASED)
      .mockResolvedValueOnce(PAYWALL_RESULT.CANCELLED);
    const result = { current: null as unknown as SubscribeState };
    function Probe() {
      result.current = useSubscribe();
      return null;
    }
    const refreshMe = jest.fn(() => Promise.resolve());
    const signedInAs = (accountId: string) =>
      ({ me: { account: { id: accountId } }, refreshMe }) as unknown as AuthContextValue;
    const tree = (value: AuthContextValue) => (
      <AuthContext.Provider value={value}>
        <Probe />
      </AuthContext.Provider>
    );
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(tree(signedInAs('account-a')));
    });

    let firstAccountRun: Promise<void> = Promise.resolve();
    await act(async () => {
      firstAccountRun = result.current.subscribe();
    });
    expect(result.current.status).toBe('confirming');

    await act(async () => {
      renderer?.update(tree(signedInAs('account-b')));
    });
    await act(async () => {
      await result.current.subscribe();
    });

    expect(mockPaywall.presentPaywall).toHaveBeenCalledTimes(2);

    await act(async () => {
      answerFirstCheck(pending);
      await firstAccountRun;
    });

    // The previous Account's confirmation ends pending, but never on this Account's screen.
    expect(result.current.status).toBe('idle');
    expect(result.current.message).toBeNull();
  });

  it('never opens the Paywall when the server issued no app_user_id', async () => {
    (fetchBillingStatus as jest.Mock).mockResolvedValue({ data: { app_user_id: null } });
    const rendered = await render();
    const { result } = rendered;

    await subscribe(rendered);

    expect(mockPurchases.logIn).not.toHaveBeenCalled();
    expect(mockPaywall.presentPaywall).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
    expect(result.current.message).toBe(BILLING_COPY.identityError);
  });
});
