import {
  CATEGORY_ORDER,
  CATEGORY_TITLE,
  FALLBACK_CATEGORY,
  NO_SUPERMARKET_GROUP_KEY,
  NO_SUPERMARKET_TITLE,
} from '../constants';
import type {
  BestOffer,
  ManualShoppingListItem,
  PlannedShoppingListItem,
  ShoppingGroup,
  ShoppingListItem,
  SupermarketOffer,
} from '../types';

// Cheapest offer for the item; the first one listed wins a tie.
export function getBestOffer(
  item: ShoppingListItem,
  offers: SupermarketOffer[]
): BestOffer | undefined {
  if (item.source !== 'planned_meal') return undefined;

  let cheapest: SupermarketOffer | undefined;
  for (const offer of offers) {
    if (offer.ingredientId !== item.ingredientId) continue;
    if (!cheapest || offer.unitPrice < cheapest.unitPrice) cheapest = offer;
  }

  return (
    cheapest && {
      supermarket: cheapest.supermarket,
      unitPrice: cheapest.unitPrice,
      price: cheapest.unitPrice * item.amountToBuy,
    }
  );
}

// Planned items still on the list; removed and manual ones never reach a group.
// Sorted by name so a change in the plan never reorders the rows of a group.
function getVisiblePlannedItems(items: ShoppingListItem[]) {
  return items
    .filter(
      (item): item is PlannedShoppingListItem =>
        item.source === 'planned_meal' && item.status !== 'removed'
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function getGroupCategory({ category }: PlannedShoppingListItem) {
  return CATEGORY_ORDER.includes(category) ? category : FALLBACK_CATEGORY;
}

export function groupItemsByCategory(items: ShoppingListItem[]): ShoppingGroup[] {
  const visibleItems = getVisiblePlannedItems(items);

  return CATEGORY_ORDER.map((category) => ({
    key: category,
    title: CATEGORY_TITLE[category],
    items: visibleItems.filter((item) => getGroupCategory(item) === category),
  })).filter((group) => group.items.length > 0);
}

export function groupItemsBySupermarket(
  items: ShoppingListItem[],
  offers: SupermarketOffer[]
): ShoppingGroup[] {
  const itemsBySupermarket = new Map<string, PlannedShoppingListItem[]>();
  const itemsWithoutOffer: PlannedShoppingListItem[] = [];

  for (const item of getVisiblePlannedItems(items)) {
    const supermarket = getBestOffer(item, offers)?.supermarket;
    if (supermarket === undefined) {
      itemsWithoutOffer.push(item);
      continue;
    }

    const supermarketItems = itemsBySupermarket.get(supermarket) ?? [];
    supermarketItems.push(item);
    itemsBySupermarket.set(supermarket, supermarketItems);
  }

  const groups: ShoppingGroup[] = [...itemsBySupermarket.keys()]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((supermarket) => ({
      key: `supermarket:${supermarket}`,
      title: supermarket,
      items: itemsBySupermarket.get(supermarket) ?? [],
    }));

  if (itemsWithoutOffer.length > 0) {
    groups.push({
      key: NO_SUPERMARKET_GROUP_KEY,
      title: NO_SUPERMARKET_TITLE,
      items: itemsWithoutOffer,
    });
  }

  return groups;
}

// Rows of the "Agregados a mano" section.
export function getManualItems(items: ShoppingListItem[]): ManualShoppingListItem[] {
  return items.filter(
    (item): item is ManualShoppingListItem => item.source === 'manual' && item.status !== 'removed'
  );
}
