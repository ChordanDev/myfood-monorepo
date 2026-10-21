import { confirmPurchase, confirmRestore } from '../api/billingApi';
import { PENDING_WEBHOOK_RETRY_DELAYS_MS } from '../constants';

export type ConfirmationKind = 'purchase' | 'restore';

/**
 * `confirmed` once the server answered that the Account has access, `pending` when every retry
 * still answered `pending_webhook`.
 */
export type ConfirmationOutcome = 'confirmed' | 'pending';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Asks the server for the Account's state after the store completed a purchase or a restore.
 * The app never grants access itself: RevenueCat's webhook does, so while the server answers
 * `pending_webhook` this asks again with backoff. A `200` with `trial` confirms too: the Paywall
 * only opens once the Account has no access, so the purchase's webhook started the Account's
 * one-time trial, which the server reports ahead of `active`. Network and server errors propagate.
 */
export async function confirmWithServer(
  kind: ConfirmationKind,
  sleep: (ms: number) => Promise<void> = wait
): Promise<ConfirmationOutcome> {
  const confirm = kind === 'purchase' ? confirmPurchase : confirmRestore;

  for (let attempt = 0; ; attempt += 1) {
    const { data } = await confirm();
    if (data.state === 'active' || data.state === 'trial') return 'confirmed';

    const delay = PENDING_WEBHOOK_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return 'pending';
    await sleep(delay);
  }
}
