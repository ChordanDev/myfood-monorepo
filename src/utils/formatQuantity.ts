import type { UnitType } from '@/types/domain';

export const UNIT_LABEL: Record<UnitType, string> = { g: 'g', ml: 'ml', unit: 'u' };

const LARGE_UNIT_LABEL: Partial<Record<UnitType, string>> = { g: 'kg', ml: 'L' };

const LARGE_UNIT_THRESHOLD = 1000;

const QUANTITY_DECIMALS = 2;

const ROUNDING_FACTOR = 10 ** QUANTITY_DECIMALS;

// Rounds to the precision quantities are displayed with. Amounts derived for display round
// with it too, so a quantity that is listed never reads as zero.
export function roundQuantity(value: number): number {
  return Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

// Formatted by hand: Intl locale data differs between Hermes and jest
function formatNumber(value: number): string {
  return String(roundQuantity(value)).replace('.', ',');
}

export function formatQuantity(quantity: number, unit: UnitType): string {
  const rounded = roundQuantity(quantity);
  const largeUnitLabel = LARGE_UNIT_LABEL[unit];

  if (largeUnitLabel && rounded >= LARGE_UNIT_THRESHOLD) {
    return `${formatNumber(rounded / LARGE_UNIT_THRESHOLD)} ${largeUnitLabel}`;
  }

  return `${formatNumber(rounded)} ${UNIT_LABEL[unit]}`;
}
