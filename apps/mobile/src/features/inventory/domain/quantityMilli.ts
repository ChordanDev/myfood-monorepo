import type { UnitType } from '@/types/domain';
import { formatQuantity } from '@/utils/formatQuantity';
import { parseQuantityInput } from './parseQuantityInput';

// Inventory quantities are integers in thousandths of the unit: 1500 is 1.5 g, ml or units.
const MILLI_PER_UNIT = 1000;

export function milliToQuantity(quantityMilli: number): number {
  return quantityMilli / MILLI_PER_UNIT;
}

// Rounds, so an amount in display units carrying floating point noise still gives an integer
export function quantityToMilli(quantity: number): number {
  return Math.round(quantity * MILLI_PER_UNIT);
}

export function formatQuantityMilli(quantityMilli: number, unit: UnitType): string {
  return formatQuantity(milliToQuantity(quantityMilli), unit);
}

// What the user typed, in display units, as the integer the API takes
export function parseQuantityInputMilli(text: string): number | null {
  const quantity = parseQuantityInput(text);
  if (quantity === null) return null;

  const quantityMilli = quantityToMilli(quantity);
  return Number.isSafeInteger(quantityMilli) ? quantityMilli : null;
}

// Unrounded, so an untouched field parses back to exactly the stored quantity
export function milliToInputText(quantityMilli: number): string {
  return String(milliToQuantity(quantityMilli)).replace('.', ',');
}
