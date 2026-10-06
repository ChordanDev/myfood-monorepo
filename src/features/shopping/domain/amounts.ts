import { AMOUNT_DECIMALS } from '../constants';

const FACTOR = 10 ** AMOUNT_DECIMALS;

// Rounds an amount to the precision the list is derived and displayed with.
export function roundAmount(amount: number) {
  return Math.round(amount * FACTOR) / FACTOR;
}
