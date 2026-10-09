import type { InventoryFreshness } from '../types';

// Title of the section each freshness gets on the screen
export const INVENTORY_FRESHNESS_LABELS: Record<InventoryFreshness, string> = {
  expired: 'Vencidos',
  warning: 'Por vencer',
  ok: 'En buen estado',
};
