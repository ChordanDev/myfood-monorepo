import type { CheckoutLine, ShoppingCartLine, ShoppingListLine, ShoppingListRead } from '../types';

/**
 * The lines of the Cart, as a confirm names and buys them: the ones the server reports for the
 * caller's own Cart. They are never worked out from the lines of the list, which the date
 * limit cuts short and which also show the shares in the Cart of another member.
 */
export function getCartLines(list: ShoppingListRead | null): ShoppingCartLine[] {
  return list?.cart?.lines ?? [];
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
