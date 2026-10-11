import type { CheckoutLine, ShoppingCartLine, ShoppingListLine, ShoppingListRead } from '../types';

/**
 * The lines of the Cart, as a confirm names them. The planned shares in a Cart are added up
 * per ingredient and unit whatever the grouping of the read: per meal the id of a line is the
 * id of a Shopping item, which a confirm does not take.
 *
 * A read does not say who holds a share, so a share in the Cart of another member is listed
 * too. It is only ever sent when its quantity is changed, and the server then refuses it.
 */
export function getCartLines(list: ShoppingListRead | null): ShoppingCartLine[] {
  const lines = new Map<string, ShoppingCartLine>();

  for (const { ingredientId, name, unit, allocations } of list?.planned ?? []) {
    for (const share of allocations) {
      if (ingredientId === null || share.status !== 'in_cart') continue;

      const id = `${ingredientId}:${unit}`;
      const quantityMilli = (lines.get(id)?.quantityMilli ?? 0) + share.quantityMilli;
      lines.set(id, { id, name, unit, quantityMilli });
    }
  }

  const manualLines = (list?.manual ?? [])
    .filter((line) => line.status === 'in_cart')
    .map(({ id, name, unit, quantityMilli }) => ({ id, name, unit, quantityMilli }));

  return [...lines.values(), ...manualLines];
}

/**
 * How many Shopping items the Cart holds that the read does not list, so the sheet has no line
 * for them: the ones for a meal after the date the list reaches. A confirm buys them all the
 * same, at the quantity the Cart holds.
 *
 * The read lists the shares in the Cart of another member too, so what it lists can be more
 * than the Cart holds: the count never goes below zero.
 */
export function getHiddenCartItemsCount(list: ShoppingListRead | null): number {
  if (!list?.cart) return 0;

  const listedShares = list.planned
    .filter(({ ingredientId }) => ingredientId !== null)
    .flatMap(({ allocations }) => allocations)
    .filter(({ status }) => status === 'in_cart').length;
  const listedManualItems = list.manual.filter(({ status }) => status === 'in_cart').length;

  return Math.max(0, list.cart.itemsCount - listedShares - listedManualItems);
}

/**
 * What a confirm sends: the lines bought at another quantity than the one the Cart holds,
 * keyed by line id. The server buys every line it is not told about as the Cart holds it.
 */
export function getChangedCheckoutLines(
  lines: ShoppingCartLine[],
  boughtQuantities: Record<string, number>
): CheckoutLine[] {
  return lines.flatMap(({ id, quantityMilli }) => {
    const bought = boughtQuantities[id];

    return bought === undefined || bought === quantityMilli
      ? []
      : [{ itemId: id, quantityMilli: bought }];
  });
}

// The Shopping items of a line that can go into a Cart: only the ones still `needed`. One that
// was bought, or is in a Cart already, makes the server refuse the whole marking.
export function getItemIdsToBuy({ allocations }: ShoppingListLine): string[] {
  return allocations.filter(({ status }) => status === 'needed').map(({ itemId }) => itemId);
}
