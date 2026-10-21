import { confirmPurchase, confirmRestore } from '../api/billingApi';
import { PENDING_WEBHOOK_RETRY_DELAYS_MS } from '../constants';

export type ConfirmationKind = 'purchase' | 'restore';

/**
 * `confirmed` once the server answered `active`, `pending` when every retry still answered
 * anything else.
 */
export type ConfirmationOutcome = 'confirmed' | 'pending';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Asks the server for the Account's state after the store completed a purchase or a restore.
 * The app never grants access itself: RevenueCat's webhook does, so while the server answers
 * `pending_webhook` this asks again with backoff. A `200` with `trial` does not confirm the
 * purchase either: the trial already gave the Account access and the webhook may not have landed,
 * so it is asked again the same way. Network and server errors propagate.
 */
export async function confirmWithServer(
  kind: ConfirmationKind,
  sleep: (ms: number) => Promise<void> = wait
): Promise<ConfirmationOutcome> {
  const confirm = kind === 'purchase' ? confirmPurchase : confirmRestore;

  for (let attempt = 0; ; attempt += 1) {
    const { data } = await confirm();
    if (data.state === 'active') return 'confirmed';

    const delay = PENDING_WEBHOOK_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return 'pending';
    await sleep(delay);
  }
}
