import { useCallback, useMemo } from 'react';
import { useInventoryStore, useMealPlanStore } from '@/store';
import {
  deriveShoppingList,
  formatUntilLabel,
  getBestOffer,
  getDefaultUntilDate,
  getManualItems,
  getShoppingCounters,
  groupItemsByCategory,
  groupItemsBySupermarket,
} from '../domain';
import { useShoppingListStore } from '../store';
import type {
  BestOffer,
  ShoppingGroupingMode,
  ShoppingListInput,
  ShoppingListItem,
  SupermarketOffer,
} from '../types';

type ShoppingSources = Omit<ShoppingListInput, 'untilDate'>;

// The list reaches up to the last planned date: no picker is designed for the pill yet.
function deriveItems(sources: ShoppingSources) {
  return deriveShoppingList({ ...sources, untilDate: getDefaultUntilDate(sources.entries) });
}

function groupItems(
  items: ShoppingListItem[],
  groupingMode: ShoppingGroupingMode,
  offers: SupermarketOffer[]
) {
  return groupingMode === 'supermarket'
    ? groupItemsBySupermarket(items, offers)
    : groupItemsByCategory(items);
}

/**
 * The list as the stores hold it right now. Actions run on it instead of on the rendered
 * rows: the store trusts the row it is handed, so a `needed` row from a stale render,
 * marked twice, would be added to the inventory twice.
 */
function readFreshList() {
  const { entries, recipes } = useMealPlanStore.getState();
  const { items: inventory, ingredients } = useInventoryStore.getState();
  const { purchases, removedIds, manualItems, groupingMode, offers } =
    useShoppingListStore.getState();
  const items = deriveItems({
    entries,
    recipes,
    ingredients,
    inventory,
    purchases,
    removedIds,
    manualItems,
  });

  return { items, groups: groupItems(items, groupingMode, offers) };
}

// Best offer of every item that has one, keyed by item id.
function getBestOffers(items: ShoppingListItem[], offers: SupermarketOffer[]) {
  const bestOffers: Record<string, BestOffer> = {};

  for (const item of items) {
    const bestOffer = getBestOffer(item, offers);
    if (bestOffer) bestOffers[item.id] = bestOffer;
  }

  return bestOffers;
}

export function useShoppingList() {
  const entries = useMealPlanStore((state) => state.entries);
  const recipes = useMealPlanStore((state) => state.recipes);
  const inventory = useInventoryStore((state) => state.items);
  const ingredients = useInventoryStore((state) => state.ingredients);
  const purchases = useShoppingListStore((state) => state.purchases);
  const removedIds = useShoppingListStore((state) => state.removedIds);
  const manualItems = useShoppingListStore((state) => state.manualItems);
  const groupingMode = useShoppingListStore((state) => state.groupingMode);
  const offers = useShoppingListStore((state) => state.offers);
  const setGroupingMode = useShoppingListStore((state) => state.setGroupingMode);

  const untilDate = useMemo(() => getDefaultUntilDate(entries), [entries]);

  const items = useMemo(
    () =>
      deriveItems({
        entries,
        recipes,
        ingredients,
        inventory,
        purchases,
        removedIds,
        manualItems,
      }),
    [entries, recipes, ingredients, inventory, purchases, removedIds, manualItems]
  );

  const groups = useMemo(
    () => groupItems(items, groupingMode, offers),
    [items, groupingMode, offers]
  );
  const bestOffers = useMemo(() => getBestOffers(items, offers), [items, offers]);
  const counters = useMemo(() => getShoppingCounters(items), [items]);
  // Rows of "Agregados a mano". The store keeps the removed ones; these are the listed ones.
  const listedManualItems = useMemo(() => getManualItems(items), [items]);

  const toggleItem = useCallback((itemId: string) => {
    const item = readFreshList().items.find((candidate) => candidate.id === itemId);
    if (!item) return;

    const { markPurchased, unmarkPurchased } = useShoppingListStore.getState();
    if (item.status === 'needed') markPurchased(item);
    else if (item.status === 'purchased') unmarkPurchased(item);
  }, []);

  // "Marcar todos": buys what is still needed; with nothing left to buy, it undoes the group.
  const toggleGroup = useCallback((groupKey: string) => {
    const group = readFreshList().groups.find((candidate) => candidate.key === groupKey);
    if (!group) return;

    const { markAllPurchased, unmarkAllPurchased } = useShoppingListStore.getState();
    const neededItems = group.items.filter((item) => item.status === 'needed');
    if (neededItems.length > 0) markAllPurchased(neededItems);
    else unmarkAllPurchased(group.items);
  }, []);

  return {
    untilDate,
    untilLabel: untilDate === undefined ? undefined : formatUntilLabel(untilDate),
    groupingMode,
    setGroupingMode,
    groups,
    bestOffers,
    counters,
    manualItems: listedManualItems,
    toggleItem,
    toggleGroup,
  };
}
