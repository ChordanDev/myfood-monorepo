import { formatQuantity, UNIT_LABEL } from '@/utils/formatQuantity';
import type { UnitType } from '@/types/domain';
import { SHOPPING_SLOT_LABELS, SHORT_MONTHS } from '../constants';
import type {
  ShoppingCounters,
  ShoppingGroupBy,
  ShoppingLineAllocation,
  ShoppingListItem,
  ShoppingListLine,
} from '../types';

const SEPARATOR = ' · ';

// The API counts quantities in thousandths of the unit.
const MILLI_PER_UNIT = 1000;

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

// The shares the quantity of a line adds up: the ones still to buy, or, with nothing left to
// buy, the ones that were bought or the ones that were removed.
function getSharesOfStatus({ status, allocations }: ShoppingListLine) {
  if (status === 'purchased' || status === 'removed') {
    return allocations.filter((share) => share.status === status);
  }

  return allocations.filter((share) => share.status === 'needed' || share.status === 'in_cart');
}

/**
 * Second line of a planned row: the meals it is for. A line that adds up several meals says
 * how many, and the line of one meal says which one while the list is read per meal. Per
 * ingredient, a line for a single meal has no second line. A meal whose share was bought or
 * removed is not counted while the line has something left to buy.
 *
 * The count is read from the line and not from the grouping, so a list read per ingredient
 * never passes for one meal while the read per meal is still in flight.
 */
export function formatItemMealsLine(
  line: ShoppingListLine,
  groupBy: ShoppingGroupBy
): string | undefined {
  const shares = getSharesOfStatus(line);

  if (shares.length > 1) return `Para ${shares.length} comidas`;
  if (groupBy === 'meal' && shares.length === 1) return formatMeal(shares[0]);

  return undefined;
}

// A quantity as the field of the cart sheet starts with it: in the unit, decimals after a comma.
export function formatQuantityInput(quantityMilli: number) {
  return String(quantityMilli / MILLI_PER_UNIT).replace('.', ',');
}

// Second line of a row of the cart sheet: what the Cart holds of the line. It is written as
// the field next to it reads, in the unit of the line and never in kilos or litres, so what is
// suggested and what is typed are always the same measure.
export function formatSuggestedQuantity(quantityMilli: number, unit: UnitType) {
  return `Sugerido: ${formatQuantityInput(quantityMilli)} ${UNIT_LABEL[unit]}`;
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

// Reads what the User typed as a count of thousandths of the unit, zero included. Comma and
// dot both mark the decimals, as people write them here.
function parseMilli(text: string): number | undefined {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return undefined;

  const milli = Math.round(Number(normalized) * MILLI_PER_UNIT);
  return Number.isSafeInteger(milli) ? milli : undefined;
}

/**
 * Reads what the User typed as a quantity, in thousandths of the unit. Comma and dot both
 * mark the decimals, as people write them here. Anything that is not a number above zero
 * is `undefined`: the server only takes a whole count of thousandths above zero.
 */
export function parseQuantityMilli(text: string): number | undefined {
  const milli = parseMilli(text);

  return milli !== undefined && milli > 0 ? milli : undefined;
}

// Reads what the User typed as the quantity bought of a line of the Cart. Zero is a quantity
// here: the line was not bought.
export function parseBoughtQuantityMilli(text: string): number | undefined {
  return parseMilli(text);
}
