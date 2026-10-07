import { useCallback, useMemo } from 'react';
import { useInventoryStore } from '@/features/inventory/store';
import { useMealPlanStore } from '@/store';
import {
  deriveShoppingList,
  formatUntilLabel,
  getBestOffer,
  getCartItems,
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
 * rows: a row from a stale render may have changed status, amount, or left the list since.
 */
function readFreshList() {
  const { entries, recipes } = useMealPlanStore.getState();
  const { items: inventory, ingredients } = useInventoryStore.getState();
  const { cartIds, removedIds, manualItems, groupingMode, offers } =
    useShoppingListStore.getState();
  const items = deriveItems({
    entries,
    recipes,
    ingredients,
    inventory,
    cartIds,
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
  const cartIds = useShoppingListStore((state) => state.cartIds);
  const removedIds = useShoppingListStore((state) => state.removedIds);
  const manualItems = useShoppingListStore((state) => state.manualItems);
  const groupingMode = useShoppingListStore((state) => state.groupingMode);
  const offers = useShoppingListStore((state) => state.offers);
  const setGroupingMode = useShoppingListStore((state) => state.setGroupingMode);
  const addManualItem = useShoppingListStore((state) => state.addManualItem);
  const restoreRemoved = useShoppingListStore((state) => state.restoreRemovedItems);

  const untilDate = useMemo(() => getDefaultUntilDate(entries), [entries]);

  const items = useMemo(
    () =>
      deriveItems({
        entries,
        recipes,
        ingredients,
        inventory,
        cartIds,
        removedIds,
        manualItems,
      }),
    [entries, recipes, ingredients, inventory, cartIds, removedIds, manualItems]
  );

  const groups = useMemo(
    () => groupItems(items, groupingMode, offers),
    [items, groupingMode, offers]
  );
  const bestOffers = useMemo(() => getBestOffers(items, offers), [items, offers]);
  const counters = useMemo(() => getShoppingCounters(items), [items]);
  // Rows of "Agregados a mano". The store keeps the removed ones; these are the listed ones.
  const listedManualItems = useMemo(() => getManualItems(items), [items]);

  // Rows the cart sheet lists: derived with the rest, so each one carries the amount it is
  // missing now, and a row that left the list is not among them.
  const cartItems = useMemo(() => getCartItems(items), [items]);

  // Marking a row only moves it in or out of the cart; the inventory is not touched.
  const toggleItem = useCallback((itemId: string) => {
    const item = readFreshList().items.find((candidate) => candidate.id === itemId);
    if (!item) return;

    const { addToCart, takeOutOfCart } = useShoppingListStore.getState();
    if (item.status === 'needed') addToCart([item.id]);
    else if (item.status === 'in_cart') takeOutOfCart([item.id]);
  }, []);

  // "Marcar todos": puts what is still needed in the cart; with the whole group already in
  // it, takes the group back out.
  const toggleGroup = useCallback((groupKey: string) => {
    const group = readFreshList().groups.find((candidate) => candidate.key === groupKey);
    if (!group) return;

    const { addToCart, takeOutOfCart } = useShoppingListStore.getState();
    const neededIds = group.items.filter((item) => item.status === 'needed').map(({ id }) => id);
    if (neededIds.length > 0) addToCart(neededIds);
    else takeOutOfCart(group.items.map(({ id }) => id));
  }, []);

  // Not a toggle: pressed twice from the cart sheet, the row is out, not back in.
  const takeOutOfCart = useCallback((itemId: string) => {
    useShoppingListStore.getState().takeOutOfCart([itemId]);
  }, []);

  // "Marcar como comprado": buys the cart for what each row is missing at this moment.
  const confirmPurchase = useCallback(() => {
    useShoppingListStore.getState().confirmPurchase(readFreshList().items);
  }, []);

  // Only a row that is still listed can be removed: one that left the list since the render
  // it was pressed on (its meal was cooked, say) is not there to take off.
  const removeItem = useCallback((itemId: string) => {
    const item = readFreshList().items.find((candidate) => candidate.id === itemId);
    if (!item) return;

    useShoppingListStore.getState().removeItem(item);
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
    cartItems,
    cartCount: counters.inCart,
    toggleItem,
    toggleGroup,
    takeOutOfCart,
    confirmPurchase,
    addManualItem,
    removeItem,
    restoreRemoved,
  };
}
