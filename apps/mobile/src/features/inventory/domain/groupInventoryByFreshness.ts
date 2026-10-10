import type { InventoryFreshness, InventoryItem } from '../types';

export interface InventorySection {
  freshness: InventoryFreshness;
  items: InventoryItem[];
}

// What to use first comes first
const FRESHNESS_ORDER: InventoryFreshness[] = ['expired', 'warning', 'ok'];

// `expiresAt` is an ISO date, so the text order is the date order
function compareByExpiryThenName(a: InventoryItem, b: InventoryItem): number {
  if (a.expiresAt !== b.expiresAt) return a.expiresAt < b.expiresAt ? -1 : 1;

  return a.name.localeCompare(b.name, 'es');
}

export function groupInventoryByFreshness(items: InventoryItem[]): InventorySection[] {
  return FRESHNESS_ORDER.map((freshness) => ({
    freshness,
    items: items.filter((item) => item.freshness === freshness).sort(compareByExpiryThenName),
  })).filter((section) => section.items.length > 0);
}
