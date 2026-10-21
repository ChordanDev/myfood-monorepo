/* eslint-disable @typescript-eslint/no-require-imports */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { AuthContext } from '@/features/auth/context/AuthContext';
import { fixtureCurrentMe } from '@/features/auth/fixtures/currentMe';
import type { AuthContextValue, CurrentMe } from '@/features/auth/types/auth';
import { fetchBillingStatus } from '../../api/billingApi';
import { useBillingStore } from '../../store/useBillingStore';
import { useRevenueCatSession } from '../useRevenueCatSession';

jest.mock('@/features/auth', () => {
  const ReactMock = require('react');
  const mockAuthContext = require('@/features/auth/context/AuthContext').AuthContext;
  return { useAuth: () => ReactMock.useContext(mockAuthContext) };
});

jest.mock('../../api/billingApi', () => ({ fetchBillingStatus: jest.fn() }));

const mockPurchases = jest.mocked(Purchases);

// The server issues ids unrelated to the Account id; the test keeps them apart on purpose.
const SERVER_IDS: Record<string, string> = {
  'account-1': 'rc-9f1c-issued-for-first',
  'account-2': 'rc-77ab-issued-for-second',
};

function meFor(accountId: string): CurrentMe {
  const me = fixtureCurrentMe();
  return { ...me, account: { ...me.account, id: accountId } };
}

function contextFor(me: CurrentMe | null, isLoading = false): AuthContextValue {
  return { me, user: me?.user ?? null, isLoading } as unknown as AuthContextValue;
}

function Session() {
  useRevenueCatSession();
  return null;
}

async function render(value: AuthContextValue) {
  let tree: ReactTestRenderer | null = null;
  await act(async () => {
    tree = create(
      <AuthContext.Provider value={value}>
        <Session />
      </AuthContext.Provider>
    );
  });
  return tree!;
}

async function update(tree: ReactTestRenderer, value: AuthContextValue) {
  await act(async () => {
    tree.update(
      <AuthContext.Provider value={value}>
        <Session />
      </AuthContext.Provider>
    );
  });
}

function customerInfo(activeEntitlements: string[]): CustomerInfo {
  const active = Object.fromEntries(activeEntitlements.map((id) => [id, { identifier: id }]));
  return { entitlements: { active, all: active } } as unknown as CustomerInfo;
}

const ORIGINAL_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

describe('useRevenueCatSession', () => {
  beforeAll(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = 'test_placeholder_key';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = ORIGINAL_KEY;
  });

  let currentAccountId = 'account-1';

  beforeEach(() => {
    jest.clearAllMocks();
    useBillingStore.getState().reset();
    (fetchBillingStatus as jest.Mock).mockImplementation(async () => ({
      data: { app_user_id: SERVER_IDS[currentAccountId] },
    }));
  });

  it("logs RevenueCat in with the server's app_user_id after sign-in", async () => {
    currentAccountId = 'account-1';
    await render(contextFor(meFor('account-1')));

    expect(mockPurchases.configure).toHaveBeenCalledWith({ apiKey: 'test_placeholder_key' });
    expect(fetchBillingStatus).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledWith('rc-9f1c-issued-for-first');
    expect(mockPurchases.logIn).not.toHaveBeenCalledWith('account-1');
    expect(useBillingStore.getState().appUserId).toBe('rc-9f1c-issued-for-first');
  });

  it("logs in with the other Account's id on an Account switch", async () => {
    currentAccountId = 'account-1';
    const tree = await render(contextFor(meFor('account-1')));

    currentAccountId = 'account-2';
    await update(tree, contextFor(meFor('account-2')));

    expect(mockPurchases.logIn.mock.calls).toEqual([
      ['rc-9f1c-issued-for-first'],
      ['rc-77ab-issued-for-second'],
    ]);
    expect(useBillingStore.getState().appUserId).toBe('rc-77ab-issued-for-second');
  });

  it('logs RevenueCat out on sign-out', async () => {
    currentAccountId = 'account-1';
    const tree = await render(contextFor(meFor('account-1')));
    mockPurchases.isAnonymous.mockResolvedValueOnce(false);

    await update(tree, contextFor(null));

    expect(mockPurchases.logOut).toHaveBeenCalledTimes(1);
    expect(useBillingStore.getState().appUserId).toBeNull();
  });

  it('neither logs in nor out while the session is still being restored', async () => {
    await render(contextFor(null, true));

    expect(fetchBillingStatus).not.toHaveBeenCalled();
    expect(mockPurchases.logIn).not.toHaveBeenCalled();
    expect(mockPurchases.logOut).not.toHaveBeenCalled();
    expect(mockPurchases.isAnonymous).not.toHaveBeenCalled();
  });

  it('ignores CustomerInfo updates once signed out', async () => {
    currentAccountId = 'account-1';
    const tree = await render(contextFor(meFor('account-1')));
    const listener = mockPurchases.addCustomerInfoUpdateListener.mock.calls[0][0];

    await update(tree, contextFor(null));
    act(() => listener(customerInfo(['brosky_company_pro'])));

    expect(useBillingStore.getState().hasProEntitlement).toBe(false);
  });

  it('follows CustomerInfo updates for brosky_company_pro and stops on unmount', async () => {
    currentAccountId = 'account-1';
    const tree = await render(contextFor(meFor('account-1')));
    const listener = mockPurchases.addCustomerInfoUpdateListener.mock.calls[0][0];

    act(() => listener(customerInfo(['brosky_company_pro'])));
    expect(useBillingStore.getState().hasProEntitlement).toBe(true);

    act(() => listener(customerInfo(['some_other_entitlement'])));
    expect(useBillingStore.getState().hasProEntitlement).toBe(false);

    await act(async () => tree.unmount());
    expect(mockPurchases.removeCustomerInfoUpdateListener).toHaveBeenCalledWith(listener);
  });
});
