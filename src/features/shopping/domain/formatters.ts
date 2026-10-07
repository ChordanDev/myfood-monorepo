import { formatQuantity } from '@/utils/formatQuantity';
import { NO_PRICE_LABEL, SHORT_MONTHS } from '../constants';
import type { BestOffer, ShoppingCounters, ShoppingListItem } from '../types';

const SEPARATOR = ' · ';

// es-AR pesos: thousands dot, no decimals.
export function formatPrice(price: number) {
  return `$${String(Math.round(price)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function formatShortDate(dateKey: string) {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${day} ${SHORT_MONTHS[month - 1]}`;
}

export function formatUntilLabel(dateKey: string) {
  return `Hasta ${formatShortDate(dateKey)}`;
}

// What the date pill says to a screen reader: what pressing it does, and the date it shows.
export function formatUntilButtonLabel(dateKey: string) {
  return `Elegir hasta qué día comprar, ahora ${formatShortDate(dateKey)}`;
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

// Only the item count has a singular: "en el carrito" reads the same for one and for many.
export function formatCountersLabel({ total, inCart }: ShoppingCounters) {
  return `${pluralize(total, 'ítem')}${SEPARATOR}${inCart} en el carrito`;
}

// What the floating cart button says to a screen reader.
export function formatCartButtonLabel(cartCount: number) {
  return `Ver carrito, ${cartCount === 0 ? 'vacío' : pluralize(cartCount, 'ítem')}`;
}

// Line under the cards that brings the removed items back.
export function formatRemovedLabel(removed: number) {
  return `${pluralize(removed, 'quitado')}${SEPARATOR}Restaurar`;
}
