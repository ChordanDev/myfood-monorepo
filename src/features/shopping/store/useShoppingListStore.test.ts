import type { Ingredient, MealPlanEntry, RecipeIngredient } from '@/types/domain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { InventoryItem } from '@/features/inventory';
import { useInventoryStore } from '@/features/inventory/store';
import { MOCK_INGREDIENTS, MOCK_MASTER_RECIPES, MOCK_MEAL_PLAN } from '@/mocks/domainMocks';
import {
  deriveShoppingList,
  getBestOffer,
  getPlannedItemId,
  groupItemsBySupermarket,
} from '../domain';
import type { ManualShoppingListItem, PlannedShoppingListItem, ShoppingListItem } from '../types';
import { migrateShoppingListState, useShoppingListStore } from './useShoppingListStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const STORAGE_KEY = 'shopping-list-storage';

const CHICKEN = 'i2';
const RICE = 'i1';
const TOMATO = 'i3';

const CHICKEN_ID = getPlannedItemId(CHICKEN);
const RICE_ID = getPlannedItemId(RICE);
const TOMATO_ID = getPlannedItemId(TOMATO);

// The only item in stock when a test starts.
const RICE_STOCK: InventoryItem = {
  id: 'inv-i1',
  ingredientId: RICE,
  name: 'Arroz Blanco',
  category: 'almacen',
  quantity: 500,
  unit: 'g',
  confidence: 'exact',
};

function plannedItem(overrides: Partial<PlannedShoppingListItem> = {}): PlannedShoppingListItem {
  const ingredientId = overrides.ingredientId ?? CHICKEN;

  return {
    id: getPlannedItemId(ingredientId),
    source: 'planned_meal',
    status: 'needed',
    name: 'Pollo (Pechuga)',
    ingredientId,
    amountToBuy: 600,
    unit: 'g',
    category: 'carnes',
    ...overrides,
  };
}

function manualItem(
  sequence: number,
  name: string,
  status: ManualShoppingListItem['status'] = 'needed'
): ManualShoppingListItem {
  return { id: `manual:${sequence}`, source: 'manual', status, name };
}

function stockOf(ingredientId: string) {
  return useInventoryStore.getState().items.find((item) => item.ingredientId === ingredientId)
    ?.quantity;
}

const shopping = () => useShoppingListStore.getState();

const manualStatuses = () => shopping().manualItems.map((item) => [item.name, item.status]);

function resetStores() {
  useShoppingListStore.setState({
    cartIds: [],
    removedIds: [],
    manualItems: [],
    lastManualItemSequence: 0,
    groupingMode: 'category',
  });
  useInventoryStore.setState({ items: [RICE_STOCK] });
}

beforeEach(resetStores);

describe('putting items in the cart', () => {
  it('lists a planned id in the cart without touching the inventory', () => {
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().addToCart([CHICKEN_ID]);

    expect(shopping().cartIds).toEqual([CHICKEN_ID]);
    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
  });

  it('moves a manual item to the cart in its own status, not in the id list', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().addToCart(['manual:2']);

    expect(manualStatuses()).toEqual([
      ['Servilletas', 'needed'],
      ['Velas', 'in_cart'],
    ]);
    expect(shopping().cartIds).toEqual([]);
    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
  });

  it('takes several ids at once, planned and manual', () => {
    shopping().addManualItem('Servilletas');

    shopping().addToCart([CHICKEN_ID, 'manual:1', TOMATO_ID]);

    expect(shopping().cartIds).toEqual([CHICKEN_ID, TOMATO_ID]);
    expect(manualStatuses()).toEqual([['Servilletas', 'in_cart']]);
  });

  it('never lists an id twice', () => {
    shopping().addToCart([CHICKEN_ID]);

    shopping().addToCart([CHICKEN_ID, TOMATO_ID, TOMATO_ID]);

    expect(shopping().cartIds).toEqual([CHICKEN_ID, TOMATO_ID]);
  });

  it('ignores a row that was removed from the list', () => {
    shopping().addManualItem('Servilletas');
    shopping().removeItem(shopping().manualItems[0]);
    shopping().removeItem(plannedItem());

    shopping().addToCart([CHICKEN_ID, 'manual:1']);

    expect(shopping().cartIds).toEqual([]);
    expect(manualStatuses()).toEqual([['Servilletas', 'removed']]);
  });

  it('keeps the slice it has nothing to change in', () => {
    shopping().addManualItem('Servilletas');
    shopping().addToCart([CHICKEN_ID]);
    const { cartIds, manualItems } = shopping();

    shopping().addToCart([TOMATO_ID]);
    expect(shopping().manualItems).toBe(manualItems);

    shopping().addToCart(['manual:1', CHICKEN_ID]);
    expect(shopping().cartIds).not.toBe(cartIds);
    const cartIdsAfter = shopping().cartIds;

    shopping().addToCart([CHICKEN_ID, 'manual:1']);
    expect(shopping().cartIds).toBe(cartIdsAfter);
  });
});

describe('taking items out of the cart', () => {
  beforeEach(() => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    shopping().addToCart([CHICKEN_ID, TOMATO_ID, 'manual:1', 'manual:2']);
  });

  it('takes a planned id out and leaves the others in', () => {
    shopping().takeOutOfCart([CHICKEN_ID]);

    expect(shopping().cartIds).toEqual([TOMATO_ID]);
    expect(manualStatuses()).toEqual([
      ['Servilletas', 'in_cart'],
      ['Velas', 'in_cart'],
    ]);
  });

  it('returns a manual item to needed', () => {
    shopping().takeOutOfCart(['manual:2']);

    expect(manualStatuses()).toEqual([
      ['Servilletas', 'in_cart'],
      ['Velas', 'needed'],
    ]);
    expect(shopping().cartIds).toEqual([CHICKEN_ID, TOMATO_ID]);
  });

  it('takes several ids out at once, planned and manual', () => {
    shopping().takeOutOfCart([TOMATO_ID, 'manual:1', CHICKEN_ID, 'manual:2']);

    expect(shopping().cartIds).toEqual([]);
    expect(manualStatuses()).toEqual([
      ['Servilletas', 'needed'],
      ['Velas', 'needed'],
    ]);
  });

  it('ignores an id that is not in the cart, keeping both slices as they were', () => {
    shopping().takeOutOfCart(['manual:1']);
    const { cartIds, manualItems } = shopping();

    shopping().takeOutOfCart([RICE_ID, 'manual:1', 'manual:9']);

    expect(shopping().cartIds).toBe(cartIds);
    expect(shopping().manualItems).toBe(manualItems);
  });

  it('does not bring a removed manual item back', () => {
    shopping().removeItem(shopping().manualItems[0]);

    shopping().takeOutOfCart(['manual:1']);

    expect(manualStatuses()[0]).toEqual(['Servilletas', 'removed']);
  });

  it('never touches the inventory', () => {
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().takeOutOfCart([CHICKEN_ID, 'manual:1']);

    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
  });
});

describe('adding a manual item', () => {
  it('appends a needed item with the trimmed name', () => {
    shopping().addManualItem('  Servilletas ');

    expect(shopping().manualItems).toEqual([
      { id: 'manual:1', source: 'manual', status: 'needed', name: 'Servilletas' },
    ]);
  });

  it.each(['', '   '])('ignores the blank name "%s"', (name) => {
    shopping().addManualItem(name);

    expect(shopping().manualItems).toEqual([]);
    expect(shopping().lastManualItemSequence).toBe(0);
  });

  it('gives every item its own id, even after one was removed', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    shopping().removeItem(shopping().manualItems[0]);
    shopping().addManualItem('Carbón');

    expect(shopping().manualItems.map((item) => item.id)).toEqual([
      'manual:1',
      'manual:2',
      'manual:3',
    ]);
  });

  it('never produces an id a planned item could have', () => {
    shopping().addManualItem('i2');

    expect(shopping().manualItems[0].id).not.toBe(getPlannedItemId('i2'));
    expect(shopping().manualItems[0].id.startsWith('planned:')).toBe(false);
  });

  it('never reuses the id of an item a confirmed purchase deleted', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    shopping().addToCart(['manual:1', 'manual:2']);
    shopping().confirmPurchase([]);
    expect(shopping().manualItems).toEqual([]);

    shopping().addManualItem('Carbón');

    expect(shopping().manualItems.map((item) => item.id)).toEqual(['manual:3']);
  });

  it('counts on from the stored counter when no item is left to read it from', () => {
    useShoppingListStore.setState({ manualItems: [], lastManualItemSequence: 5 });

    shopping().addManualItem('Carbón');

    expect(shopping().manualItems.map((item) => item.id)).toEqual(['manual:6']);
    expect(shopping().lastManualItemSequence).toBe(6);
  });

  it('keeps numbering after the highest stored id when the counter is behind it', () => {
    useShoppingListStore.setState({
      manualItems: [manualItem(7, 'Velas'), manualItem(2, 'Servilletas', 'removed')],
      lastManualItemSequence: 0,
    });

    shopping().addManualItem('Carbón');

    expect(shopping().manualItems.map((item) => item.id)).toEqual([
      'manual:7',
      'manual:2',
      'manual:8',
    ]);
    expect(shopping().lastManualItemSequence).toBe(8);
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

  it('takes a planned row out of the cart, and only that one', () => {
    shopping().addToCart([CHICKEN_ID, TOMATO_ID]);

    shopping().removeItem(plannedItem({ status: 'in_cart' }));

    expect(shopping().cartIds).toEqual([TOMATO_ID]);
    expect(shopping().removedIds).toEqual([CHICKEN_ID]);
  });

  it('takes a manual row out of the cart', () => {
    shopping().addManualItem('Servilletas');
    shopping().addToCart(['manual:1']);

    shopping().removeItem(shopping().manualItems[0]);

    expect(manualStatuses()).toEqual([['Servilletas', 'removed']]);
  });

  it('never touches the inventory', () => {
    shopping().addToCart([RICE_ID]);
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().removeItem(plannedItem({ ingredientId: RICE, status: 'in_cart' }));

    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
  });
});

describe('restoring the removed items', () => {
  it('clears the removed ids and returns the removed manual items to needed', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    shopping().addToCart(['manual:2']);
    shopping().removeItem(shopping().manualItems[0]);
    shopping().removeItem(plannedItem());

    shopping().restoreRemovedItems();

    expect(shopping().removedIds).toEqual([]);
    expect(manualStatuses()).toEqual([
      ['Servilletas', 'needed'],
      ['Velas', 'in_cart'],
    ]);
  });

  it('brings a row that was removed from the cart back as needed, not into the cart', () => {
    shopping().addManualItem('Servilletas');
    shopping().addToCart([CHICKEN_ID, 'manual:1']);
    shopping().removeItem(plannedItem({ status: 'in_cart' }));
    shopping().removeItem(shopping().manualItems[0]);

    shopping().restoreRemovedItems();

    expect(shopping().cartIds).toEqual([]);
    expect(shopping().manualItems).toEqual([manualItem(1, 'Servilletas')]);
  });
});

describe('restoring one removed item', () => {
  it('takes a planned id off the removed ids and leaves the others removed', () => {
    shopping().removeItem(plannedItem());
    shopping().removeItem(plannedItem({ ingredientId: TOMATO }));

    shopping().restoreItem(CHICKEN_ID);

    expect(shopping().removedIds).toEqual([TOMATO_ID]);
  });

  it('returns a removed manual item to needed and leaves the others alone', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    shopping().removeItem(shopping().manualItems[0]);
    shopping().removeItem(shopping().manualItems[1]);

    shopping().restoreItem('manual:2');

    expect(manualStatuses()).toEqual([
      ['Servilletas', 'removed'],
      ['Velas', 'needed'],
    ]);
  });

  it('brings a row that was removed from the cart back as needed, not into the cart', () => {
    shopping().addToCart([CHICKEN_ID]);
    shopping().removeItem(plannedItem({ status: 'in_cart' }));

    shopping().restoreItem(CHICKEN_ID);

    expect(shopping().removedIds).toEqual([]);
    expect(shopping().cartIds).toEqual([]);
  });

  it('changes nothing for an id that is not removed, keeping every slice as it was', () => {
    shopping().addManualItem('Servilletas');
    shopping().addManualItem('Velas');
    shopping().addToCart([TOMATO_ID, 'manual:2']);
    shopping().removeItem(plannedItem());
    const { cartIds, removedIds, manualItems } = shopping();

    // A planned row still listed, manual rows needed and in the cart, and ids nobody has.
    [TOMATO_ID, RICE_ID, 'manual:1', 'manual:2', 'manual:9', ''].forEach((id) =>
      shopping().restoreItem(id)
    );

    expect(shopping().cartIds).toBe(cartIds);
    expect(shopping().removedIds).toBe(removedIds);
    expect(shopping().manualItems).toBe(manualItems);
  });

  it('never touches the inventory', () => {
    shopping().removeItem(plannedItem());
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().restoreItem(CHICKEN_ID);

    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
  });
});

describe('confirming the purchase', () => {
  const ingredients: Ingredient[] = [
    { id: RICE, name: 'Arroz Blanco', category: 'almacen', basePrice: 2, unit: 'g' },
    { id: CHICKEN, name: 'Pollo (Pechuga)', category: 'carnes', basePrice: 10, unit: 'g' },
    { id: TOMATO, name: 'Tomate', category: 'verduras', basePrice: 500, unit: 'unit' },
  ];
  // Three meals: 600 g of chicken and 6 tomatoes (none in stock), 300 g of rice (500 g in stock).
  const recipeIngredients: RecipeIngredient[] = [
    { ingredientId: CHICKEN, amount: 200 },
    { ingredientId: RICE, amount: 100 },
    { ingredientId: TOMATO, amount: 2 },
  ];
  const meal = (id: string, isCooked = false): MealPlanEntry => ({
    id,
    date: '2026-10-06',
    type: 'almuerzo',
    recipeId: 'r1',
    isCooked,
  });
  const threeMeals = [meal('mp1'), meal('mp2'), meal('mp3')];

  // The list as it is derived at the moment of the call.
  function derive(entries: MealPlanEntry[] = threeMeals) {
    const { cartIds, removedIds, manualItems } = shopping();

    return deriveShoppingList({
      entries,
      recipes: [{ id: 'r1', ingredients: recipeIngredients }],
      ingredients,
      inventory: useInventoryStore.getState().items,
      cartIds,
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

  it('adds the shortfall of every planned row in the cart to the inventory', () => {
    shopping().addToCart([CHICKEN_ID, TOMATO_ID]);

    shopping().confirmPurchase(derive());

    expect(stockOf(CHICKEN)).toBe(600);
    expect(stockOf(TOMATO)).toBe(6);
    expect(stockOf(RICE)).toBe(500);
  });

  it('leaves the rows that are not in the cart to buy', () => {
    shopping().addToCart([CHICKEN_ID]);

    shopping().confirmPurchase(derive());

    expect(stockOf(TOMATO)).toBeUndefined();
    expect(summary(derive())).toEqual([[TOMATO, 'needed', 6]]);
  });

  it('adds the amount the row has now, on top of what is in stock', () => {
    shopping().addToCart([CHICKEN_ID]);
    // 150 g arrive from somewhere else after the row went into the cart.
    useInventoryStore.getState().addItem(CHICKEN, 150);

    shopping().confirmPurchase(derive());

    expect(stockOf(CHICKEN)).toBe(600);
  });

  it('restocks an ingredient that ran out on the record the inventory kept for it', () => {
    // The chicken ran out: its record stays in the inventory at quantity 0.
    useInventoryStore.getState().addItem(CHICKEN, 150);
    useInventoryStore.getState().consumeIngredient(CHICKEN, 150);
    expect(summary(derive())[0]).toEqual([CHICKEN, 'needed', 600]);
    shopping().addToCart([CHICKEN_ID]);

    shopping().confirmPurchase(derive());

    const chickenRecords = useInventoryStore
      .getState()
      .items.filter((item) => item.ingredientId === CHICKEN);
    expect(chickenRecords.map((item) => item.quantity)).toEqual([600]);
    expect(summary(derive())).toEqual([[TOMATO, 'needed', 6]]);
  });

  it('empties the cart, so the bought rows leave the list', () => {
    shopping().addToCart([CHICKEN_ID, TOMATO_ID]);
    expect(summary(derive())).toEqual([
      [CHICKEN, 'in_cart', 600],
      [TOMATO, 'in_cart', 6],
    ]);

    shopping().confirmPurchase(derive());

    expect(shopping().cartIds).toEqual([]);
    expect(derive()).toEqual([]);
  });

  it('deletes the manual items in the cart for good and keeps the others', () => {
    ['Servilletas', 'Velas', 'Carbón'].forEach((name) => shopping().addManualItem(name));
    shopping().addToCart(['manual:1']);
    shopping().removeItem(shopping().manualItems[2]);
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().confirmPurchase(derive());

    expect(shopping().manualItems).toEqual([
      manualItem(2, 'Velas'),
      manualItem(3, 'Carbón', 'removed'),
    ]);
    // A manual item has no ingredient: nothing reaches the inventory.
    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
    shopping().restoreRemovedItems();
    expect(manualStatuses()).toEqual([
      ['Velas', 'needed'],
      ['Carbón', 'needed'],
    ]);
  });

  it('drops the ids whose row no longer exists without touching the inventory', () => {
    // The rice is covered by the stock, and no meal needs the ghost.
    shopping().addToCart([RICE_ID, 'planned:ghost', CHICKEN_ID]);
    const afterCooking = [meal('mp1', true), meal('mp2', true), meal('mp3', true)];
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().confirmPurchase(derive(afterCooking));

    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
    expect(shopping().cartIds).toEqual([]);
  });

  it('buys only the rows whose id the store holds in the cart, whatever status they carry', () => {
    const staleRows = [plannedItem({ status: 'in_cart' })];

    shopping().confirmPurchase(staleRows);

    expect(stockOf(CHICKEN)).toBeUndefined();
  });

  it('does not buy a removed row whose id is still in the cart', () => {
    useShoppingListStore.setState({ cartIds: [CHICKEN_ID], removedIds: [CHICKEN_ID] });

    shopping().confirmPurchase(derive());

    expect(stockOf(CHICKEN)).toBeUndefined();
    expect(shopping().removedIds).toEqual([CHICKEN_ID]);
  });

  it('adds once when it is confirmed twice with the same rows', () => {
    shopping().addManualItem('Servilletas');
    shopping().addToCart([CHICKEN_ID, 'manual:1']);
    const rows = derive();

    shopping().confirmPurchase(rows);
    shopping().confirmPurchase(rows);

    expect(stockOf(CHICKEN)).toBe(600);
    expect(shopping().manualItems).toEqual([]);
  });

  it('changes nothing while the cart is empty', () => {
    shopping().addManualItem('Servilletas');
    const inventoryBefore = useInventoryStore.getState().items;

    shopping().confirmPurchase(derive());

    expect(useInventoryStore.getState().items).toBe(inventoryBefore);
    expect(manualStatuses()).toEqual([['Servilletas', 'needed']]);
    expect(summary(derive()).slice(0, 2)).toEqual([
      [CHICKEN, 'needed', 600],
      [TOMATO, 'needed', 6],
    ]);
  });
});

describe('immutable updates', () => {
  type Slice = 'cartIds' | 'removedIds' | 'manualItems';

  // Runs the action and checks that the slice was replaced by a new value while the previous
  // one was left exactly as it was, so a subscriber comparing references sees the change.
  function expectReplaced(slice: Slice, action: () => void) {
    const previous = shopping()[slice];
    const previousContent = JSON.parse(JSON.stringify(previous));

    action();

    expect(shopping()[slice]).not.toBe(previous);
    expect(previous).toEqual(previousContent);
  }

  describe('of the cart ids', () => {
    beforeEach(() => {
      shopping().addToCart([TOMATO_ID]);
    });

    it('replaces them when a planned item goes in', () => {
      expectReplaced('cartIds', () => shopping().addToCart([CHICKEN_ID]));
    });

    it('replaces them when a planned item comes out', () => {
      expectReplaced('cartIds', () => shopping().takeOutOfCart([TOMATO_ID]));
    });

    it('replaces them when a planned item in the cart is removed', () => {
      expectReplaced('cartIds', () =>
        shopping().removeItem(plannedItem({ ingredientId: TOMATO, status: 'in_cart' }))
      );
    });

    it('replaces them when the purchase is confirmed', () => {
      expectReplaced('cartIds', () => shopping().confirmPurchase([]));
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

    it('replaces them when one removed item is restored', () => {
      expectReplaced('removedIds', () => shopping().restoreItem(TOMATO_ID));
    });
  });

  describe('of the manual items', () => {
    beforeEach(() => {
      ['Servilletas', 'Velas', 'Carbón'].forEach((name) => shopping().addManualItem(name));
      shopping().addToCart(['manual:2']);
      shopping().removeItem(shopping().manualItems[2]);
    });

    it('replaces them when an item is added', () => {
      expectReplaced('manualItems', () => shopping().addManualItem('Hielo'));
    });

    it('replaces them when an item goes into the cart', () => {
      expectReplaced('manualItems', () => shopping().addToCart(['manual:1']));
    });

    it('replaces them when an item comes out of the cart', () => {
      expectReplaced('manualItems', () => shopping().takeOutOfCart(['manual:2']));
    });

    it('replaces them when an item is removed', () => {
      const [needed] = shopping().manualItems;

      expectReplaced('manualItems', () => shopping().removeItem(needed));
    });

    it('replaces them when the removed items are restored', () => {
      expectReplaced('manualItems', () => shopping().restoreRemovedItems());
    });

    it('replaces them when one removed item is restored', () => {
      expectReplaced('manualItems', () => shopping().restoreItem('manual:3'));
    });

    it('replaces them when the purchase is confirmed', () => {
      expectReplaced('manualItems', () => shopping().confirmPurchase([]));
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
      // The inventory the app starts with.
      inventory: useInventoryStore.getInitialState().items,
      cartIds: [],
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
    shopping().addToCart([CHICKEN_ID]);
    shopping().removeItem(plannedItem({ ingredientId: RICE }));
    shopping().setGroupingMode('supermarket');

    const [key, value] = jest.mocked(AsyncStorage.setItem).mock.lastCall ?? [];

    expect(key).toBe(STORAGE_KEY);
    expect(JSON.parse(value ?? '')).toEqual({
      version: 2,
      state: {
        cartIds: [CHICKEN_ID],
        removedIds: [RICE_ID],
        manualItems: [manualItem(1, 'Servilletas')],
        lastManualItemSequence: 1,
        groupingMode: 'supermarket',
      },
    });
  });

  describe('of a list stored by version 1', () => {
    // What version 1 wrote: purchase records by item id, and manual items that stayed
    // `purchased` forever and remembered the status they were removed with.
    const VERSION_1_STATE = {
      purchases: { [CHICKEN_ID]: 600, [TOMATO_ID]: 2 },
      removedIds: [RICE_ID],
      manualItems: [
        { id: 'manual:1', source: 'manual', status: 'needed', name: 'Servilletas' },
        { id: 'manual:2', source: 'manual', status: 'purchased', name: 'Velas' },
        {
          id: 'manual:3',
          source: 'manual',
          status: 'removed',
          statusBeforeRemoval: 'purchased',
          name: 'Carbón',
        },
        { id: 'manual:9', source: 'manual', status: 'purchased', name: 'Hielo' },
      ],
      groupingMode: 'supermarket',
    };

    const MIGRATED_STATE = {
      cartIds: [],
      removedIds: [RICE_ID],
      manualItems: [manualItem(1, 'Servilletas'), manualItem(3, 'Carbón', 'removed')],
      // The purchased items are dropped, and their ids are still never handed out again.
      lastManualItemSequence: 9,
      groupingMode: 'supermarket',
    };

    it('drops the purchases and the purchased manual items, and seeds the id counter', () => {
      expect(migrateShoppingListState(VERSION_1_STATE)).toEqual(MIGRATED_STATE);
    });

    it('is upgraded by the store when it reads the storage, and written back as version 2', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, state: VERSION_1_STATE })
      );

      await useShoppingListStore.persist.rehydrate();

      const { cartIds, removedIds, manualItems, lastManualItemSequence, groupingMode } = shopping();
      expect({ cartIds, removedIds, manualItems, lastManualItemSequence, groupingMode }).toEqual(
        MIGRATED_STATE
      );
      expect(shopping()).not.toHaveProperty('purchases');
      // The stock those purchases added is already in the inventory: it is left as it is.
      expect(useInventoryStore.getState().items).toEqual([RICE_STOCK]);
      expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '')).toEqual({
        version: 2,
        state: MIGRATED_STATE,
      });

      shopping().addManualItem('Fósforos');
      expect(shopping().manualItems.at(-1)?.id).toBe('manual:10');
    });
  });

  describe('of a stored list it does not fully understand', () => {
    it('keeps only its own fields, and only the manual items in a status it knows', () => {
      const migrated = migrateShoppingListState({
        purchases: { [CHICKEN_ID]: { amount: 600, purchasedOn: '2026-10-05' } },
        cartIds: [CHICKEN_ID, 7, null, CHICKEN_ID],
        removedIds: 'planned:i1',
        manualItems: [
          { id: 'manual:4', source: 'manual', status: 'in_cart', name: 'Velas', purchasedOn: 'x' },
          { id: 'manual:5', source: 'manual', status: 'expired', name: 'Hielo' },
          { id: 'manual:6', source: 'manual', status: 'needed' },
          { id: 12, source: 'manual', status: 'needed', name: 'Carbón' },
          { id: 'planned:i3', source: 'manual', status: 'needed', name: 'Tomate' },
          'Servilletas',
          null,
        ],
        lastManualItemSequence: 2,
        groupingMode: 'by-aisle',
        offers: [{ ingredientId: 'i1', supermarket: 'Coto', unitPrice: 1 }],
        somethingElse: true,
      });

      expect(migrated).toEqual({
        cartIds: [CHICKEN_ID],
        removedIds: [],
        manualItems: [manualItem(4, 'Velas', 'in_cart')],
        lastManualItemSequence: 6,
        groupingMode: 'category',
      });
    });

    it('keeps a stored counter that is ahead of the stored items', () => {
      const migrated = migrateShoppingListState({
        manualItems: [manualItem(3, 'Velas')],
        lastManualItemSequence: 8,
      });

      expect(migrated.lastManualItemSequence).toBe(8);
    });

    it.each([
      ['nothing', undefined],
      ['null', null],
      ['a string', 'shopping'],
      ['a list', [1, 2]],
      ['an empty object', {}],
      ['a counter that is not a count', { lastManualItemSequence: 'NaN' }],
      ['a negative counter', { lastManualItemSequence: -4 }],
      ['a fractional counter', { lastManualItemSequence: 2.5 }],
    ])('starts from an empty list when it finds %s', (_case, stored) => {
      expect(migrateShoppingListState(stored)).toEqual({
        cartIds: [],
        removedIds: [],
        manualItems: [],
        lastManualItemSequence: 0,
        groupingMode: 'category',
      });
    });

    it('hydrates a malformed version 1 payload without throwing or keeping what it dropped', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          state: { purchases: 'none', manualItems: { 0: 'Velas' }, removedIds: [RICE_ID, 3] },
        })
      );

      await useShoppingListStore.persist.rehydrate();

      expect(shopping().manualItems).toEqual([]);
      expect(shopping().removedIds).toEqual([RICE_ID]);
      expect(shopping().cartIds).toEqual([]);
      expect(shopping()).not.toHaveProperty('purchases');
    });
  });
});
