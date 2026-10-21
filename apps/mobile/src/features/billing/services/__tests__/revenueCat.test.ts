/* eslint-disable @typescript-eslint/no-require-imports */
import { LOGIN_WAIT_TIMEOUT_MS } from '../../constants';

// The service keeps whether the SDK is configured in module state, so each test loads it fresh
// with its own mocks.
type Loaded = {
  service: typeof import('../revenueCat');
  Purchases: jest.Mocked<typeof import('react-native-purchases').default>;
  fetchBillingStatus: jest.Mock;
  store: typeof import('../../store/useBillingStore').useBillingStore;
};

function load(): Loaded {
  jest.resetModules();
  jest.doMock('../../api/billingApi', () => ({ fetchBillingStatus: jest.fn() }));
  return {
    service: require('../revenueCat'),
    Purchases: require('react-native-purchases').default,
    fetchBillingStatus: require('../../api/billingApi').fetchBillingStatus,
    store: require('../../store/useBillingStore').useBillingStore,
  };
}

function status(appUserId: string | null) {
  return { data: { state: 'expired', source: 'none', app_user_id: appUserId } };
}

function customerInfo(activeEntitlements: string[]) {
  const active = Object.fromEntries(activeEntitlements.map((id) => [id, { identifier: id }]));
  return { entitlements: { active, all: active } };
}

const SERVER_ID = '5b0c8f3e-2f7d-4c1a-9e2b-7d1f4a6c3e90';
const ORIGINAL_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

describe('RevenueCat identity', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = 'test_placeholder_key';
  });

  afterAll(() => {
    // Assigning `undefined` would store the string 'undefined', a key for every later test.
    if (ORIGINAL_KEY === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
    else process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = ORIGINAL_KEY;
  });

  it('configures the SDK once with the key from the environment', () => {
    const { service, Purchases } = load();

    expect(service.configureRevenueCat()).toBe(true);
    expect(service.configureRevenueCat()).toBe(true);

    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.configure).toHaveBeenCalledWith({ apiKey: 'test_placeholder_key' });
  });

  it('does nothing in a build without a key', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
    const { service, Purchases, fetchBillingStatus } = load();

    expect(service.isBillingEnabled()).toBe(false);
    await expect(service.identifyAccount()).resolves.toBeNull();

    expect(Purchases.configure).not.toHaveBeenCalled();
    expect(fetchBillingStatus).not.toHaveBeenCalled();
    expect(Purchases.logIn).not.toHaveBeenCalled();
  });

  it('logs in with the app_user_id the server issued and keeps the entitlement', async () => {
    const { service, Purchases, fetchBillingStatus, store } = load();
    fetchBillingStatus.mockResolvedValue(status(SERVER_ID));
    Purchases.logIn.mockResolvedValue({
      customerInfo: customerInfo(['brosky_company_pro']),
      created: true,
    } as never);

    await expect(service.identifyAccount()).resolves.toBe(SERVER_ID);

    expect(Purchases.logIn).toHaveBeenCalledWith(SERVER_ID);
    expect(store.getState()).toMatchObject({ appUserId: SERVER_ID, hasProEntitlement: true });
  });

  it('refuses to log in when the server issued no id', async () => {
    const { service, Purchases, fetchBillingStatus, store } = load();
    fetchBillingStatus.mockResolvedValue(status(null));

    await expect(service.identifyAccount()).rejects.toBeInstanceOf(service.BillingIdentityError);

    expect(Purchases.logIn).not.toHaveBeenCalled();
    expect(store.getState().appUserId).toBeNull();
  });

  it('drops a login whose status answer arrives after a sign-out', async () => {
    const { service, Purchases, fetchBillingStatus, store } = load();
    let answer: (value: unknown) => void = () => {};
    fetchBillingStatus.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const identifying = service.identifyAccount();
    await service.signOutOfRevenueCat();
    answer(status(SERVER_ID));

    await expect(identifying).resolves.toBeNull();
    expect(Purchases.logIn).not.toHaveBeenCalled();
    expect(store.getState().appUserId).toBeNull();
  });

  it("never hands out the previous Account's id while a switch is identifying", async () => {
    const { service, Purchases, fetchBillingStatus, store } = load();
    fetchBillingStatus.mockResolvedValueOnce(status('rc-first-account'));
    await service.identifyAccount();

    let answer: (value: unknown) => void = () => {};
    fetchBillingStatus.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const switching = service.identifyAccount();

    expect(store.getState().appUserId).toBeNull();

    fetchBillingStatus.mockResolvedValueOnce(status('rc-second-account'));
    await expect(service.ensureIdentified()).resolves.toBe('rc-second-account');
    answer(status('rc-second-account'));
    await switching;

    expect(Purchases.logIn).toHaveBeenLastCalledWith('rc-second-account');
  });

  it("does not fall back to the previous Account's id when the switch fails", async () => {
    const { service, fetchBillingStatus, store } = load();
    fetchBillingStatus.mockResolvedValueOnce(status('rc-first-account'));
    await service.identifyAccount();

    fetchBillingStatus.mockRejectedValueOnce(new Error('offline'));
    await expect(service.identifyAccount()).rejects.toThrow('offline');

    expect(store.getState().appUserId).toBeNull();
    fetchBillingStatus.mockRejectedValueOnce(new Error('still offline'));
    await expect(service.ensureIdentified()).rejects.toThrow('still offline');
  });

  it('ensureIdentified reuses the logged-in id without asking the server again', async () => {
    const { service, Purchases, fetchBillingStatus } = load();
    fetchBillingStatus.mockResolvedValue(status(SERVER_ID));

    await expect(service.ensureIdentified()).resolves.toBe(SERVER_ID);
    await expect(service.ensureIdentified()).resolves.toBe(SERVER_ID);

    expect(fetchBillingStatus).toHaveBeenCalledTimes(1);
    expect(Purchases.logIn).toHaveBeenCalledTimes(1);
  });

  it('logs out an identified user on sign-out and forgets the Account', async () => {
    const { service, Purchases, fetchBillingStatus, store } = load();
    fetchBillingStatus.mockResolvedValue(status(SERVER_ID));
    await service.identifyAccount();
    Purchases.isAnonymous.mockResolvedValue(false);

    await service.signOutOfRevenueCat();

    expect(Purchases.logOut).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ appUserId: null, hasProEntitlement: false });
  });

  it('waits for a login in flight before deciding whether to log out', async () => {
    const { service, Purchases, fetchBillingStatus, store } = load();
    fetchBillingStatus.mockResolvedValue(status(SERVER_ID));
    let finishLogIn: () => void = () => {};
    Purchases.logIn.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLogIn = () => resolve({ customerInfo: customerInfo([]), created: false } as never);
      }) as never
    );
    // Anonymous until the native login lands, identified after it.
    let loggedIn = false;
    Purchases.isAnonymous.mockImplementation(async () => !loggedIn);

    const identifying = service.identifyAccount();
    await Promise.resolve();
    await Promise.resolve();
    const signingOut = service.signOutOfRevenueCat();
    loggedIn = true;
    finishLogIn();
    await identifying;
    await signingOut;

    expect(Purchases.logOut).toHaveBeenCalledTimes(1);
    expect(store.getState().appUserId).toBeNull();
  });

  it('does not log out a User who signed in while the previous sign-out was waiting', async () => {
    const { service, Purchases, fetchBillingStatus, store } = load();
    fetchBillingStatus
      .mockResolvedValueOnce(status('rc-first-account'))
      .mockResolvedValueOnce(status('rc-second-account'));
    let finishFirstLogIn: () => void = () => {};
    Purchases.logIn
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirstLogIn = () =>
            resolve({ customerInfo: customerInfo([]), created: false } as never);
        }) as never
      )
      .mockResolvedValueOnce({ customerInfo: customerInfo([]), created: false } as never);
    Purchases.isAnonymous.mockResolvedValue(false);

    const identifyingFirst = service.identifyAccount();
    await Promise.resolve();
    await Promise.resolve();
    const signingOut = service.signOutOfRevenueCat();
    // The second login waits for the first one, still in flight, before it starts.
    const identifyingSecond = service.identifyAccount();
    finishFirstLogIn();
    await expect(identifyingSecond).resolves.toBe('rc-second-account');
    await signingOut;
    await identifyingFirst;

    expect(Purchases.logOut).not.toHaveBeenCalled();
    expect(store.getState().appUserId).toBe('rc-second-account');
  });

  it('keeps the SDK on the newest Account when an older login finishes last', async () => {
    const { service, Purchases, fetchBillingStatus, store } = load();
    fetchBillingStatus
      .mockResolvedValueOnce(status('rc-first-account'))
      .mockResolvedValueOnce(status('rc-second-account'));
    // The native SDK stays on whichever login finishes last.
    let sdkUser: string | null = null;
    const finishers = new Map<string, () => void>();
    Purchases.logIn.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          finishers.set(id, () => {
            sdkUser = id;
            resolve({ customerInfo: customerInfo([]), created: false } as never);
          });
        }) as never
    );
    const finish = (id: string) => {
      const finisher = finishers.get(id);
      finishers.delete(id);
      finisher?.();
    };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const identifyingFirst = service.identifyAccount();
    await flush();
    const identifyingSecond = service.identifyAccount();
    await flush();
    // When both logins are in flight, the native SDK finishes the second one first.
    finish('rc-second-account');
    await flush();
    finish('rc-first-account');
    await flush();
    finish('rc-second-account');
    await expect(identifyingFirst).resolves.toBeNull();
    await expect(identifyingSecond).resolves.toBe('rc-second-account');

    expect(store.getState().appUserId).toBe('rc-second-account');
    expect(sdkUser).toBe('rc-second-account');
  });

  it('gives up instead of waiting forever behind a login that never finishes', async () => {
    jest.useFakeTimers();
    try {
      const { service, Purchases, fetchBillingStatus, store } = load();
      fetchBillingStatus
        .mockResolvedValueOnce(status('rc-first-account'))
        .mockResolvedValueOnce(status('rc-second-account'));
      Purchases.logIn.mockReturnValueOnce(new Promise(() => {}) as never);

      void service.identifyAccount();
      await jest.advanceTimersByTimeAsync(0);
      const identifyingSecond = service.identifyAccount();
      const refused = expect(identifyingSecond).rejects.toBeInstanceOf(
        service.BillingIdentityError
      );
      await jest.advanceTimersByTimeAsync(LOGIN_WAIT_TIMEOUT_MS);
      await refused;

      // Logging in anyway could let the stuck login land later on the previous Account.
      expect(Purchases.logIn).toHaveBeenCalledTimes(1);
      expect(store.getState().appUserId).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not make a tap wait for the same Account's login still in flight", async () => {
    jest.useFakeTimers();
    try {
      const { service, Purchases, fetchBillingStatus, store } = load();
      fetchBillingStatus.mockResolvedValue(status('rc-first-account'));
      let finishBackgroundLogIn: () => void = () => {};
      Purchases.logIn.mockReturnValueOnce(
        new Promise((resolve) => {
          finishBackgroundLogIn = () =>
            resolve({ customerInfo: customerInfo([]), created: false } as never);
        }) as never
      );

      // The session logs the Account in on its own; the User taps Subscribe meanwhile.
      void service.identifyAccount();
      await jest.advanceTimersByTimeAsync(0);
      const tapping = service.ensureIdentified();
      const identified = expect(tapping).resolves.toBe('rc-first-account');
      await jest.advanceTimersByTimeAsync(LOGIN_WAIT_TIMEOUT_MS);
      finishBackgroundLogIn();
      await identified;

      expect(store.getState().appUserId).toBe('rc-first-account');
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips logOut for an anonymous user, which the SDK would reject', async () => {
    const { service, Purchases } = load();
    Purchases.isAnonymous.mockResolvedValue(true);

    await service.signOutOfRevenueCat();

    expect(Purchases.logOut).not.toHaveBeenCalled();
  });
});
