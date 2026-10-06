import type { ShoppingListItem, UnitType } from '@/types/domain';
import { LARGE_UNIT_FACTOR, NO_PRICE_LABEL, SHORT_MONTHS, UNIT_LABEL } from '../constants';
import type { BestOffer, ShoppingCounters } from '../types';
import { roundAmount } from './amounts';

const SEPARATOR = ' · ';

// Spanish decimal comma, written by hand so the device locale never changes the output.
function formatDecimal(value: number) {
  return String(roundAmount(value)).replace('.', ',');
}

export function formatQuantity(amount: number, unit: UnitType) {
  const { base, large } = UNIT_LABEL[unit];
  const rounded = roundAmount(amount);

  if (large && rounded >= LARGE_UNIT_FACTOR) {
    return `${formatDecimal(rounded / LARGE_UNIT_FACTOR)} ${large}`;
  }

  return `${formatDecimal(rounded)} ${base}`;
}

// es-AR pesos: thousands dot, no decimals.
export function formatPrice(price: number) {
  return `$${String(Math.round(price)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

export function formatUntilLabel(dateKey: string) {
  const [, month, day] = dateKey.split('-').map(Number);
  return `Hasta ${day} ${SHORT_MONTHS[month - 1]}`;
}

export function formatItemNameLine(item: ShoppingListItem) {
  if (item.source === 'manual') return item.name;
  return `${formatQuantity(item.amountToBuy, item.unit)}${SEPARATOR}${item.name}`;
}

export function formatItemMetaLine(offer: BestOffer | undefined) {
  if (!offer) return NO_PRICE_LABEL;
  return `${offer.supermarket}${SEPARATOR}${formatPrice(offer.price)}`;
}

function pluralize(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

// The purchased count agrees with "ítem", so it needs no gender of its own.
export function formatCountersLabel({ total, purchased }: ShoppingCounters) {
  return `${pluralize(total, 'ítem')}${SEPARATOR}${pluralize(purchased, 'comprado')}`;
}
