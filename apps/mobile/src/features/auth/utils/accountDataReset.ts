/**
 * Stores that cache the signed-in account's data register a reset here, and the auth provider
 * runs them when the session ends or another account signs in. The registry keeps the auth
 * provider free of imports from those stores.
 */
const resetters = new Set<() => void>();

export function registerAccountDataReset(reset: () => void): void {
  resetters.add(reset);
}

export function resetAccountData(): void {
  resetters.forEach((reset) => reset());
}
