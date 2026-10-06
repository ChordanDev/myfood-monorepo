import type { Ingredient, MealPlanEntry, RecipeIngredient } from '@/types/domain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MOCK_INGREDIENTS,
  MOCK_INVENTORY,
  MOCK_MASTER_RECIPES,
  MOCK_MEAL_PLAN,
} from '@/mocks/domainMocks';
import { useInventoryStore } from '@/store';
import {
  deriveShoppingList,
  getBestOffer,
  getPlannedItemId,
  groupItemsBySupermarket,
} from '../domain';
import type { PlannedShoppingListItem, ShoppingListItem } from '../types';
import { useShoppingListStore } from './useShoppingListStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const CHICKEN = 'i2';
const RICE = 'i1';
const TOMATO = 'i3';
const PASTA = 'i6';

function plannedItem(overrides: Partial<PlannedShoppingListItem> = {}): PlannedShoppingListItem {
  const ingredientId = overrides.ingredientId ?? CHICKEN;

  return {
    id: getPlannedItemId(ingredientId),
    source: 'planned_meal',
    status: 'needed',
    name: 'Pollo (Pechuga)',
    ingredientId,
    amountToBuy: 600,
    unit: 'gramos',
    category: 'proteinas',
    ...overrides,
  };
}

function stockOf(ingredientId: string) {
  return useInventoryStore.getState().items.find((item) => item.ingredientId === ingredientId)
    ?.amount;
}

const shopping = () => useShoppingListStore.getState();

function resetStores() {
  useShoppingListStore.setState({
    purchases: {},
    removedIds: [],
    manualItems: [],
    groupingMode: 'category',
  });
  useInventoryStore.setState({ items: [{ ingredientId: RICE, amount: 500 }] });
}

// Everything a purchase can change, to compare two ways of reaching the same state.
function snapshot() {
  const { purchases, removedIds, manualItems } = shopping();
  return { purchases, removedIds, manualItems, inventory: useInventoryStore.getState().items };
}

beforeEach(resetStores);

describe('marking a planned item as purchased', () => {
  it('adds the amount to buy to the inventory and records the purchase', () => {
    const item = plannedItem({ amountToBuy: 600 });

    shopping().markPurchased(item);

    expect(stockOf(CHICKEN)).toBe(600);
    expect(shopping().purchases).toEqual({ [item.id]: 600 });
  });

  it('adds on top of the stock the inventory already holds', () => {
    shopping().markPurchased(plannedItem({ ingredientId: RICE, amountToBuy: 100 }));

    expect(stockOf(RICE)).toBe(600);
  });

  it('overwrites the record when the item is needed again and bought again', () => {
    const item = plannedItem({ amountToBuy: 600 });
    shopping().markPurchased(item);

    shopping().markPurchased(plannedItem({ amountToBuy: 200 }));

    expect(shopping().purchases).toEqual({ [item.id]: 200 });
    expect(stockOf(CHICKEN)).toBe(800);
  });

  it.each(['purchased', 'removed'] as const)('ignores an item that is %s', (status) => {
    shopping().markPurchased(plannedItem({ status }));

    expect(stockOf(CHICKEN)).toBeUndefined();
    expect(shopping().purchases).toEqual({});
  });
});

describe('unmarking a purchased planned item', () => {
  // The derivation lists a purchased row with the recorded amount.
  const purchased = (item: PlannedShoppingListItem) =>
    plannedItem({ ...item, status: 'purchased' });

  it('returns the inventory to the amount it held before the purchase', () => {
    const item = plannedItem({ ingredientId: RICE, amountToBuy: 100 });
    shopping().markPurchased(item);

    shopping().unmarkPurchased(purchased(item));

    expect(stockOf(RICE)).toBe(500);
    expect(shopping().purchases).toEqual({});
  });

  it('drops the inventory entry the purchase created', () => {
    const item = plannedItem({ amountToBuy: 600 });
    shopping().markPurchased(item);

    shopping().unmarkPurchased(purchased(item));

    expect(stockOf(CHICKEN)).toBeUndefined();
  });

  it('removes only what is left when part of the stock was consumed', () => {
    const item = plannedItem({ amountToBuy: 600 });
    shopping().markPurchased(item);
    useInventoryStore.getState().removeItem(CHICKEN, 450);

    shopping().unmarkPurchased(purchased(item));

    expect(stockOf(CHICKEN)).toBeUndefined();
    expect(useInventoryStore.getState().items).toEqual([{ ingredientId: RICE, amount: 500 }]);
    expect(shopping().purchases).toEqual({});
  });

  it('removes the recorded amount, not the one the row carries', () => {
    const item = plannedItem({ ingredientId: RICE, amountToBuy: 100 });
    shopping().markPurchased(item);

    shopping().unmarkPurchased(purchased({ ...item, amountToBuy: 400 }));

    expect(stockOf(RICE)).toBe(500);
  });

  it('keeps the other purchase records', () => {
    const chicken = plannedItem({ amountToBuy: 600 });
    const rice = plannedItem({ ingredientId: RICE, amountToBuy: 100 });
    shopping().markPurchased(chicken);
    shopping().markPurchased(rice);

    shopping().unmarkPurchased(purchased(chicken));

    expect(shopping().purchases).toEqual({ [rice.id]: 100 });
  });

  it.each(['needed', 'removed'] as const)('ignores an item that is %s', (status) => {
    const item = plannedItem({ ingredientId: RICE, amountToBuy: 100 });
    shopping().markPurchased(item);

    shopping().unmarkPurchased(plannedItem({ ...item, status }));

    expect(stockOf(RICE)).toBe(600);
    expect(shopping().purchases).toEqual({ [item.id]: 100 });
  });

  it('ignores a purchased row that has no record', () => {
    shopping().unmarkPurchased(plannedItem({ ingredientId: RICE, status: 'purchased' }));

    expect(stockOf(RICE)).toBe(500);
  });
});

describe('adding a manual item', () => {
  it('appends a needed item with the trimmed name', () => {
    shopping().addManualItem('  Servilletas ');

    expect(shopping().manualItems).toEqual([
      { id: expect.any(String), source: 'manual', status: 'needed', name: 'Servilletas' },
    ]);
  });

  it.each(['', '   '])('ignores the blank name "%s"', (name) => {
    shopping().addManualItem(name);

    expect(shopping().manualItems).toEqual([]);
  });

  it('gives every item its own id, even after one was removed', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    shopping().removeItem(shopping().manualItems[0]);
    shopping().addManualItem('Carbón');

    const ids = shopping().manualItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('never produces an id a planned item could have', () => {
    shopping().addManualItem('i2');

    expect(shopping().manualItems[0].id).not.toBe(getPlannedItemId('i2'));
    expect(shopping().manualItems[0].id.startsWith('planned:')).toBe(false);
  });

  it('keeps numbering after the highest id when the items were restored out of order', () => {
    useShoppingListStore.setState({
      manualItems: [
        { id: 'manual:7', source: 'manual', status: 'needed', name: 'Velas' },
        { id: 'manual:2', source: 'manual', status: 'removed', name: 'Servilletas' },
      ],
    });

    shopping().addManualItem('Carbón');

    expect(shopping().manualItems.map((item) => item.id)).toEqual([
      'manual:7',
      'manual:2',
      'manual:8',
    ]);
  });
});

describe('removing an item', () => {
  it('lists the id of a planned item as removed, once', () => {
    const item = plannedItem();

    shopping().removeItem(item);
    shopping().removeItem(item);

    expect(shopping().removedIds).toEqual([item.id]);
  });

  it('flags a manual item as removed and leaves the others alone', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    const [napkins, candles] = shopping().manualItems;

    shopping().removeItem(napkins);

    expect(shopping().manualItems).toEqual([{ ...napkins, status: 'removed' }, candles]);
    expect(shopping().removedIds).toEqual([]);
  });

  it('touches neither the inventory nor the purchase records', () => {
    const item = plannedItem({ amountToBuy: 600 });
    shopping().markPurchased(item);

    shopping().removeItem(plannedItem({ ...item, status: 'purchased' }));

    expect(stockOf(CHICKEN)).toBe(600);
    expect(shopping().purchases).toEqual({ [item.id]: 600 });
  });
});

describe('a planned item that was removed from the list', () => {
  // Rows captured before the removal still say `needed` or `purchased`.
  it('is not bought by marking a stale needed row', () => {
    const staleRow = plannedItem({ amountToBuy: 600 });
    shopping().removeItem(staleRow);

    shopping().markPurchased(staleRow);

    expect(stockOf(CHICKEN)).toBeUndefined();
    expect(shopping().purchases).toEqual({});
  });

  it('keeps its purchase when a stale purchased row is unmarked', () => {
    const item = plannedItem({ ingredientId: RICE, amountToBuy: 100 });
    shopping().markPurchased(item);
    const staleRow = plannedItem({ ...item, status: 'purchased' });
    shopping().removeItem(staleRow);

    shopping().unmarkPurchased(staleRow);

    expect(stockOf(RICE)).toBe(600);
    expect(shopping().purchases).toEqual({ [item.id]: 100 });
  });

  it('is skipped by the bulk actions too', () => {
    const bought = plannedItem({ ingredientId: RICE, amountToBuy: 100 });
    shopping().markPurchased(bought);
    const staleRows = [
      plannedItem({ amountToBuy: 600 }),
      plannedItem({ ...bought, status: 'purchased' }),
    ];
    staleRows.forEach((row) => shopping().removeItem(row));
    const before = snapshot();

    shopping().markAllPurchased(staleRows);
    shopping().unmarkAllPurchased(staleRows);

    expect(snapshot()).toEqual(before);
  });

  it('can be bought again once the removed items are restored', () => {
    const row = plannedItem({ amountToBuy: 600 });
    shopping().removeItem(row);
    shopping().restoreRemovedItems();

    shopping().markPurchased(row);

    expect(stockOf(CHICKEN)).toBe(600);
  });
});

describe('restoring the removed items', () => {
  it('clears the removed ids and returns the removed manual items to needed', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    const [napkins, candles] = shopping().manualItems;
    shopping().markPurchased(candles);
    shopping().removeItem(napkins);
    shopping().removeItem(plannedItem());

    shopping().restoreRemovedItems();

    expect(shopping().removedIds).toEqual([]);
    expect(shopping().manualItems).toEqual([
      { ...napkins, status: 'needed' },
      { ...candles, status: 'purchased' },
    ]);
  });
});

describe('marking and unmarking a manual item', () => {
  it('marks it as purchased without touching the inventory', () => {
    shopping().addManualItem('Servilletas');
    const [napkins] = shopping().manualItems;
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().markPurchased(napkins);

    expect(shopping().manualItems).toEqual([{ ...napkins, status: 'purchased' }]);
    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
    expect(shopping().purchases).toEqual({});
  });

  it('returns it to needed when unmarked', () => {
    shopping().addManualItem('Servilletas');
    shopping().markPurchased(shopping().manualItems[0]);
    expect(shopping().manualItems[0].status).toBe('purchased');
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().unmarkPurchased(shopping().manualItems[0]);

    expect(shopping().manualItems[0].status).toBe('needed');
    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
  });

  it('does not bring a removed item back by marking or unmarking it', () => {
    shopping().addManualItem('Servilletas');
    shopping().removeItem(shopping().manualItems[0]);
    const [removed] = shopping().manualItems;

    shopping().markPurchased(removed);
    shopping().unmarkPurchased(removed);

    expect(shopping().manualItems).toEqual([removed]);
  });

  it('trusts its own status over a stale row', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    const [staleNeeded, candles] = shopping().manualItems;
    shopping().markPurchased(candles);
    const stalePurchased = shopping().manualItems[1];
    shopping().removeItem(staleNeeded);
    shopping().removeItem(stalePurchased);

    shopping().markPurchased(staleNeeded);
    shopping().unmarkPurchased(stalePurchased);

    expect(shopping().manualItems.map((item) => item.status)).toEqual(['removed', 'removed']);
  });

  it('does not unmark an item that is still needed', () => {
    shopping().addManualItem('Servilletas');
    const [napkins] = shopping().manualItems;

    shopping().unmarkPurchased(napkins);

    expect(shopping().manualItems).toEqual([napkins]);
  });
});

describe('bulk actions', () => {
  // A mixed group: two needed planned rows, one already purchased, one removed, and manual
  // items in every status.
  function arrangeGroup(): ShoppingListItem[] {
    resetStores();
    const bought = plannedItem({ ingredientId: TOMATO, amountToBuy: 6, unit: 'unidades' });
    shopping().markPurchased(bought);
    ['Servilletas', 'Velas', 'Carbón'].forEach(shopping().addManualItem);
    const [napkins, candles, charcoal] = shopping().manualItems;
    shopping().markPurchased(candles);
    shopping().removeItem(charcoal);

    return [
      plannedItem({ amountToBuy: 600 }),
      plannedItem({ ingredientId: RICE, amountToBuy: 100 }),
      { ...bought, status: 'purchased' },
      plannedItem({ ingredientId: PASTA, amountToBuy: 360, status: 'removed' }),
      napkins,
      ...shopping().manualItems.slice(1),
    ];
  }

  it('marks every needed item and leaves the rest as it was', () => {
    const items = arrangeGroup();

    shopping().markAllPurchased(items);

    expect(shopping().purchases).toEqual({
      [getPlannedItemId(TOMATO)]: 6,
      [getPlannedItemId(CHICKEN)]: 600,
      [getPlannedItemId(RICE)]: 100,
    });
    expect(stockOf(CHICKEN)).toBe(600);
    expect(stockOf(RICE)).toBe(600);
    expect(stockOf(TOMATO)).toBe(6);
    expect(stockOf(PASTA)).toBeUndefined();
    expect(shopping().manualItems.map((item) => item.status)).toEqual([
      'purchased',
      'purchased',
      'removed',
    ]);
  });

  it('marks all exactly as marking the items one by one would', () => {
    shopping().markAllPurchased(arrangeGroup());
    const afterBulk = snapshot();

    arrangeGroup().forEach((item) => shopping().markPurchased(item));

    expect(afterBulk).toEqual(snapshot());
  });

  it('unmarks every purchased item and leaves the rest as it was', () => {
    const items = arrangeGroup();

    shopping().unmarkAllPurchased(items);

    expect(shopping().purchases).toEqual({});
    expect(useInventoryStore.getState().items).toEqual([{ ingredientId: RICE, amount: 500 }]);
    expect(shopping().manualItems.map((item) => item.status)).toEqual([
      'needed',
      'needed',
      'removed',
    ]);
  });

  it('unmarks all exactly as unmarking the items one by one would', () => {
    shopping().unmarkAllPurchased(arrangeGroup());
    const afterBulk = snapshot();

    arrangeGroup().forEach((item) => shopping().unmarkPurchased(item));

    expect(afterBulk).toEqual(snapshot());
  });

  it('undoes a bulk mark with a bulk unmark of the purchased rows', () => {
    const needed = [plannedItem({ amountToBuy: 600 }), plannedItem({ ingredientId: RICE })];
    const before = snapshot();
    shopping().markAllPurchased(needed);

    shopping().unmarkAllPurchased(needed.map((item) => ({ ...item, status: 'purchased' })));

    expect(snapshot()).toEqual(before);
  });
});

describe('immutable updates', () => {
  type Slice = 'purchases' | 'removedIds' | 'manualItems';

  // Runs the action and checks that the slice was replaced by a new value while the previous
  // one was left exactly as it was, so a subscriber comparing references sees the change.
  function expectReplaced(slice: Slice, action: () => void) {
    const previous = shopping()[slice];
    const previousContent = JSON.parse(JSON.stringify(previous));

    action();

    expect(shopping()[slice]).not.toBe(previous);
    expect(previous).toEqual(previousContent);
  }

  const purchasedRice = () => {
    const item = plannedItem({ ingredientId: RICE, amountToBuy: 100 });
    shopping().markPurchased(item);
    return plannedItem({ ...item, status: 'purchased' });
  };

  describe('of the purchase records', () => {
    beforeEach(() => {
      shopping().markPurchased(plannedItem({ ingredientId: TOMATO, amountToBuy: 6 }));
    });

    it('replaces them when a planned item is marked', () => {
      expectReplaced('purchases', () => shopping().markPurchased(plannedItem()));
    });

    it('replaces them when a planned item is unmarked', () => {
      const row = purchasedRice();

      expectReplaced('purchases', () => shopping().unmarkPurchased(row));
    });
  });

  describe('of the removed ids', () => {
    beforeEach(() => {
      shopping().removeItem(plannedItem({ ingredientId: TOMATO }));
    });

    it('replaces them when a planned item is removed', () => {
      expectReplaced('removedIds', () => shopping().removeItem(plannedItem()));
    });

    it('replaces them when the removed items are restored', () => {
      expectReplaced('removedIds', () => shopping().restoreRemovedItems());
    });
  });

  describe('of the manual items', () => {
    beforeEach(() => {
      ['Servilletas', 'Velas', 'Carbón'].forEach((name) => shopping().addManualItem(name));
      shopping().markPurchased(shopping().manualItems[1]);
      shopping().removeItem(shopping().manualItems[2]);
    });

    it('replaces them when an item is added', () => {
      expectReplaced('manualItems', () => shopping().addManualItem('Hielo'));
    });

    it('replaces them when an item is marked', () => {
      const [needed] = shopping().manualItems;

      expectReplaced('manualItems', () => shopping().markPurchased(needed));
    });

    it('replaces them when an item is unmarked', () => {
      const [, purchased] = shopping().manualItems;

      expectReplaced('manualItems', () => shopping().unmarkPurchased(purchased));
    });

    it('replaces them when an item is removed', () => {
      const [needed] = shopping().manualItems;

      expectReplaced('manualItems', () => shopping().removeItem(needed));
    });

    it('replaces them when the removed items are restored', () => {
      expectReplaced('manualItems', () => shopping().restoreRemovedItems());
    });
  });
});

describe('grouping mode', () => {
  it('groups by category until the user picks another mode', () => {
    expect(useShoppingListStore.getInitialState().groupingMode).toBe('category');

    shopping().setGroupingMode('supermarket');

    expect(shopping().groupingMode).toBe('supermarket');
  });
});

describe('the list derived from the store and the inventory', () => {
  const ingredients: Ingredient[] = [
    { id: RICE, name: 'Arroz Blanco', category: 'despensa', basePrice: 2, unit: 'gramos' },
    { id: CHICKEN, name: 'Pollo (Pechuga)', category: 'proteinas', basePrice: 10, unit: 'gramos' },
  ];
  // Three meals: 600 g of chicken (none in stock) and 300 g of rice (500 g in stock).
  const recipeIngredients: RecipeIngredient[] = [
    { ingredientId: CHICKEN, amount: 200 },
    { ingredientId: RICE, amount: 100 },
  ];
  const meal = (id: string, isCooked = false): MealPlanEntry => ({
    id,
    date: '2026-10-06',
    type: 'almuerzo',
    recipeId: 'r1',
    isCooked,
  });
  const threeMeals = [meal('mp1'), meal('mp2'), meal('mp3')];

  function derive(entries: MealPlanEntry[] = threeMeals) {
    const { purchases, removedIds, manualItems } = shopping();

    return deriveShoppingList({
      entries,
      recipes: [{ id: 'r1', ingredients: recipeIngredients }],
      ingredients,
      inventory: useInventoryStore.getState().items,
      purchases,
      removedIds,
      manualItems,
    });
  }

  const summary = (items: ShoppingListItem[]) =>
    items.map((item) =>
      item.source === 'manual'
        ? [item.name, item.status]
        : [item.ingredientId, item.status, item.amountToBuy]
    );

  it('turns a needed row into purchased when marked and back into needed when unmarked', () => {
    expect(summary(derive())).toEqual([[CHICKEN, 'needed', 600]]);

    shopping().markPurchased(derive()[0]);
    expect(summary(derive())).toEqual([[CHICKEN, 'purchased', 600]]);

    shopping().unmarkPurchased(derive()[0]);
    expect(summary(derive())).toEqual([[CHICKEN, 'needed', 600]]);
    expect(stockOf(CHICKEN)).toBeUndefined();
  });

  it('undoes only the latest purchase of a row the plan outgrew', () => {
    const fourMeals = [...threeMeals, meal('mp4')];
    shopping().markPurchased(derive()[0]);
    expect(summary(derive(fourMeals))).toEqual([[CHICKEN, 'needed', 200]]);

    shopping().markPurchased(derive(fourMeals)[0]);
    expect(summary(derive(fourMeals))).toEqual([[CHICKEN, 'purchased', 200]]);

    shopping().unmarkPurchased(derive(fourMeals)[0]);
    expect(summary(derive(fourMeals))).toEqual([[CHICKEN, 'needed', 200]]);
    expect(stockOf(CHICKEN)).toBe(600);
  });

  it('unmarks a purchase that was partly cooked without leaving negative stock', () => {
    shopping().markPurchased(derive()[0]);
    // Cooking the first meal consumes 200 g of the 600 g that were bought.
    useInventoryStore.getState().removeItem(CHICKEN, 200);
    const afterCooking = [meal('mp1', true), meal('mp2'), meal('mp3')];
    expect(summary(derive(afterCooking))).toEqual([[CHICKEN, 'purchased', 600]]);

    shopping().unmarkPurchased(derive(afterCooking)[0]);

    expect(stockOf(CHICKEN)).toBeUndefined();
    expect(summary(derive(afterCooking))).toEqual([[CHICKEN, 'needed', 400]]);
  });

  it('marks and unmarks the whole derived list in bulk', () => {
    shopping().addManualItem('Servilletas');
    const before = snapshot();

    shopping().markAllPurchased(derive());
    expect(summary(derive())).toEqual([
      [CHICKEN, 'purchased', 600],
      ['Servilletas', 'purchased'],
    ]);

    shopping().unmarkAllPurchased(derive());
    expect(summary(derive())).toEqual([
      [CHICKEN, 'needed', 600],
      ['Servilletas', 'needed'],
    ]);
    expect(snapshot()).toEqual(before);
  });

  it('lists a removed row as removed until the removed items are restored', () => {
    shopping().removeItem(derive()[0]);
    expect(summary(derive())).toEqual([[CHICKEN, 'removed', 600]]);

    shopping().restoreRemovedItems();
    expect(summary(derive())).toEqual([[CHICKEN, 'needed', 600]]);
  });
});

describe('seeded supermarket offers', () => {
  const offers = () => shopping().offers;
  const offersOf = (ingredientId: string) =>
    offers().filter((offer) => offer.ingredientId === ingredientId);
  const catalogueItems = MOCK_INGREDIENTS.map((ingredient) =>
    plannedItem({ ingredientId: ingredient.id, name: ingredient.name, amountToBuy: 1 })
  );

  it('come from the supermarkets the mockup names, for catalogue ingredients only', () => {
    const catalogueIds = MOCK_INGREDIENTS.map((ingredient) => ingredient.id);

    expect(new Set(offers().map((offer) => offer.supermarket))).toEqual(
      new Set(['Coto', 'Día', 'Carrefour'])
    );
    expect(offers().every((offer) => catalogueIds.includes(offer.ingredientId))).toBe(true);
  });

  it('leave exactly one catalogue ingredient without an offer', () => {
    const withoutOffer = MOCK_INGREDIENTS.filter(({ id }) => offersOf(id).length === 0);

    expect(withoutOffer.map((ingredient) => ingredient.name)).toEqual(['Espinaca']);
  });

  it('give every other ingredient several offers with a single cheapest one', () => {
    for (const { id } of MOCK_INGREDIENTS.filter(({ id }) => offersOf(id).length > 0)) {
      const prices = offersOf(id).map((offer) => offer.unitPrice);
      const supermarkets = offersOf(id).map((offer) => offer.supermarket);

      expect(prices.length).toBeGreaterThan(1);
      expect(new Set(prices).size).toBe(prices.length);
      expect(new Set(supermarkets).size).toBe(supermarkets.length);
    }
  });

  it('spread the best prices so grouping by supermarket yields every group', () => {
    const groups = groupItemsBySupermarket(catalogueItems, offers());

    expect(groups.map((group) => group.title)).toEqual(['Carrefour', 'Coto', 'Día', 'Sin súper']);
    expect(groups[groups.length - 1].items).toHaveLength(1);
  });

  it('price the rows of the mock plan between hundreds and a few thousand pesos', () => {
    const rows = deriveShoppingList({
      entries: MOCK_MEAL_PLAN,
      recipes: MOCK_MASTER_RECIPES,
      ingredients: MOCK_INGREDIENTS,
      inventory: MOCK_INVENTORY,
      purchases: {},
      removedIds: [],
      manualItems: [],
    });
    const prices = rows.flatMap((row) => getBestOffer(row, offers())?.price ?? []);

    expect(prices.length).toBeGreaterThan(1);
    expect(prices.length).toBe(rows.length - 1);
    for (const price of prices) {
      expect(price).toBeGreaterThanOrEqual(100);
      expect(price).toBeLessThan(10000);
    }
  });
});

describe('persistence', () => {
  it('stores the user state under its own key, without the offers', () => {
    shopping().addManualItem('Servilletas');
    shopping().markPurchased(plannedItem({ amountToBuy: 600 }));
    shopping().removeItem(plannedItem({ ingredientId: RICE }));
    shopping().setGroupingMode('supermarket');

    const [key, value] = jest.mocked(AsyncStorage.setItem).mock.lastCall ?? [];

    expect(key).toBe('shopping-list-storage');
    expect(JSON.parse(value ?? '')).toEqual({
      version: 1,
      state: {
        purchases: { [getPlannedItemId(CHICKEN)]: 600 },
        removedIds: [getPlannedItemId(RICE)],
        manualItems: [{ id: 'manual:1', source: 'manual', status: 'needed', name: 'Servilletas' }],
        groupingMode: 'supermarket',
      },
    });
  });
});
