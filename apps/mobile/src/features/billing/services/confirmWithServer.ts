import { confirmPurchase, confirmRestore } from '../api/billingApi';
import { PENDING_WEBHOOK_RETRY_DELAYS_MS } from '../constants';

export type ConfirmationKind = 'purchase' | 'restore';

/**
 * `confirmed` once the server answered with the Account's state, `pending` when every retry
 * still answered `pending_webhook`.
 */
export type ConfirmationOutcome = 'confirmed' | 'pending';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Asks the server for the Account's state after the store completed a purchase or a restore.
 * The app never grants access itself: RevenueCat's webhook does, so while the server answers
 * `pending_webhook` this asks again with backoff. Network and server errors propagate.
 */
export async function confirmWithServer(
  kind: ConfirmationKind,
  sleep: (ms: number) => Promise<void> = wait
): Promise<ConfirmationOutcome> {
  const confirm = kind === 'purchase' ? confirmPurchase : confirmRestore;

  for (let attempt = 0; ; attempt += 1) {
    const { data } = await confirm();
    if (data.state !== 'pending_webhook') return 'confirmed';

    const delay = PENDING_WEBHOOK_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return 'pending';
    await sleep(delay);
  }
}
