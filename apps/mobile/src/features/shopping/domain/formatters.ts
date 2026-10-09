import { formatQuantity } from '@/utils/formatQuantity';
import { NO_PRICE_LABEL, SHOPPING_SLOT_LABELS, SHORT_MONTHS } from '../constants';
import type {
  BestOffer,
  ShoppingCounters,
  ShoppingGroupBy,
  ShoppingLineAllocation,
  ShoppingListItem,
  ShoppingListLine,
} from '../types';

const SEPARATOR = ' · ';

// The API counts quantities in thousandths of the unit.
const MILLI_PER_UNIT = 1000;

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
  const quantity = formatQuantity(item.quantityMilli / MILLI_PER_UNIT, item.unit);
  return `${quantity}${SEPARATOR}${item.name}`;
}

// The meal a share of a line is for: its day and its slot. A slot without a name here still
// reads as its day.
function formatMeal({ date, slot }: ShoppingLineAllocation) {
  const slotLabel: string | undefined = SHOPPING_SLOT_LABELS[slot];

  return slotLabel ? `${formatShortDate(date)}${SEPARATOR}${slotLabel}` : formatShortDate(date);
}

/**
 * Second line of a planned row: the meals it is for. A line that adds up several meals says
 * how many, and the line of one meal says which one while the list is read per meal. Per
 * ingredient, a line for a single meal has no second line.
 *
 * The count is read from the line and not from the grouping, so a list read per ingredient
 * never passes for one meal while the read per meal is still in flight.
 */
export function formatItemMealsLine(
  { allocations }: ShoppingListLine,
  groupBy: ShoppingGroupBy
): string | undefined {
  if (allocations.length > 1) return `Para ${allocations.length} comidas`;
  if (groupBy === 'meal' && allocations.length === 1) return formatMeal(allocations[0]);

  return undefined;
}

// Second line of a row of the cart sheet: where it is cheapest, and for how much.
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

/**
 * Reads what the User typed as a quantity, in thousandths of the unit. Comma and dot both
 * mark the decimals, as people write them here. Anything that is not a number above zero
 * is `undefined`: the server only takes a whole count of thousandths above zero.
 */
export function parseQuantityMilli(text: string): number | undefined {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return undefined;

  const milli = Math.round(Number(normalized) * MILLI_PER_UNIT);
  return Number.isSafeInteger(milli) && milli > 0 ? milli : undefined;
}
