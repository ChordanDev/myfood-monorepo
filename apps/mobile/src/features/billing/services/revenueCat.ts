import { Platform } from 'react-native';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { fetchBillingStatus } from '../api/billingApi';
import { LOGIN_WAIT_TIMEOUT_MS, PRO_ENTITLEMENT_ID } from '../constants';
import { useBillingStore } from '../store/useBillingStore';

let configured = false;
// Each identity change bumps it, so an answer that arrives after a newer change is dropped.
let identityGeneration = 0;
// The native login in flight and its id, so a sign-out or another Account's login can wait for it.
let pendingLogIn: { appUserId: string; promise: Promise<unknown> } | null = null;

/**
 * The public SDK key for this platform. A per-platform key wins over the shared one. Each
 * `process.env.EXPO_PUBLIC_*` is read literally so Expo inlines it at build time. The key is
 * never committed: it comes from the developer's environment.
 */
function getApiKey(): string | null {
  const platformKey =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      : Platform.OS === 'android'
        ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
        : undefined;

  return platformKey || process.env.EXPO_PUBLIC_REVENUECAT_API_KEY || null;
}

/** Whether this build has a RevenueCat key. Without one the app shows no billing UI. */
export function isBillingEnabled(): boolean {
  return getApiKey() !== null;
}

/** Configures the SDK once. Safe to call again; a build without a key does nothing. */
export function configureRevenueCat(): boolean {
  if (configured) return true;

  const apiKey = getApiKey();
  if (!apiKey) return false;

  Purchases.configure({ apiKey });
  configured = true;
  return true;
}

export function hasProEntitlement(customerInfo: CustomerInfo): boolean {
  return customerInfo.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
}

export class BillingIdentityError extends Error {
  constructor(message = 'The server issued no RevenueCat app_user_id for this Account.') {
    super(message);
    this.name = 'BillingIdentityError';
  }
}

/** Whether `promise` settles, either way, within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Logs RevenueCat in with the Account's server-issued `app_user_id`, read from
 * `/billing/revenuecat/status`. The id is never derived on the device. Returns the id, or `null`
 * when a newer identity change (a switch or a sign-out) superseded this call.
 */
export async function identifyAccount(): Promise<string | null> {
  if (!configureRevenueCat()) return null;

  const generation = ++identityGeneration;
  // Until this Account's id is in, the previous one must not open any store UI: a purchase
  // made then would land on the previous Account's RevenueCat user.
  useBillingStore.getState().reset();
  const { data } = await fetchBillingStatus();
  if (generation !== identityGeneration) return null;
  if (!data.app_user_id) throw new BillingIdentityError();

  // The native SDK stays on whichever login finishes last, so another Account's login still in
  // flight could finish after this one and keep that Account's user. Wait for it first, and give
  // up rather than log in while it could still land. The same Account's login is no risk.
  while (pendingLogIn && pendingLogIn.appUserId !== data.app_user_id) {
    const settled = await settlesWithin(pendingLogIn.promise, LOGIN_WAIT_TIMEOUT_MS);
    if (generation !== identityGeneration) return null;
    if (!settled) throw new BillingIdentityError('An earlier RevenueCat login has not finished.');
  }

  const logIn = { appUserId: data.app_user_id, promise: Purchases.logIn(data.app_user_id) };
  pendingLogIn = logIn;
  const { customerInfo } = await logIn.promise.finally(() => {
    if (pendingLogIn === logIn) pendingLogIn = null;
  });
  if (generation !== identityGeneration) return null;

  useBillingStore.getState().setIdentity(data.app_user_id, hasProEntitlement(customerInfo));
  return data.app_user_id;
}

/** The id RevenueCat is logged in with, identifying the Account first when it is not yet. */
export async function ensureIdentified(): Promise<string> {
  const current = useBillingStore.getState().appUserId;
  if (current) return current;

  const appUserId = await identifyAccount();
  if (!appUserId) throw new BillingIdentityError();
  return appUserId;
}

/**
 * Forgets the Account on sign-out. `Purchases.logOut()` rejects for an anonymous user, so it
 * runs only when the SDK still holds an identified one, such as after a restart while signed
 * out.
 */
export async function signOutOfRevenueCat(): Promise<void> {
  const generation = ++identityGeneration;
  useBillingStore.getState().reset();
  if (!configureRevenueCat()) return;

  // A login still in flight would otherwise land after this check and stay logged in.
  if (pendingLogIn) await pendingLogIn.promise.catch(() => undefined);
  // A newer sign-in owns the SDK now: logging out would leave that User anonymous.
  if (generation !== identityGeneration) return;

  const isAnonymous = await Purchases.isAnonymous();
  if (generation !== identityGeneration || isAnonymous) return;

  await Purchases.logOut();
}
