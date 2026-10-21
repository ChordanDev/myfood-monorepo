/** The entitlement the monthly subscription grants, as set up in the RevenueCat dashboard. */
export const PRO_ENTITLEMENT_ID = 'brosky_company_pro';

/**
 * Waits between `/purchase` or `/restore` checks while the server answers `pending_webhook`.
 * About half a minute in total; after it the purchase stays pending and the User can check again.
 */
export const PENDING_WEBHOOK_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
