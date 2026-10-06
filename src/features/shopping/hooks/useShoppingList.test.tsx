import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import { useInventoryStore, useMealPlanStore } from '@/store';
import { useShoppingListStore } from '../store';
import { useShoppingList } from './useShoppingList';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const RICE = 'i1';
const CHICKEN = 'i2';
const TOMATO = 'i3';
const SPINACH = 'i7';

// One meal of chicken, rice and tomato, and a later one of spinach. The rice is in stock.
const RECIPES = [
  {
    id: 'r1',
    ingredients: [
      { ingredientId: CHICKEN, amount: 200 },
      { ingredientId: RICE, amount: 100 },
      { ingredientId: TOMATO, amount: 2 },
    ],
  },
  { id: 'r2', ingredients: [{ ingredientId: SPINACH, amount: 100 }] },
];

const PLAN: MealPlanEntry[] = [
  { id: 'mp1', date: '2026-10-06', type: 'almuerzo', recipeId: 'r1', isCooked: false },
  { id: 'mp2', date: '2026-10-12', type: 'cena', recipeId: 'r2', isCooked: false },
];

let tree: ReturnType<typeof create> | undefined;
let shoppingList: ReturnType<typeof useShoppingList>;

function HookHarness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result for assertions.
  shoppingList = useShoppingList();
  return null;
}

function renderShoppingList() {
  act(() => {
    tree = create(<HookHarness />);
  });
}

// Group titles with the name and status of their rows, as the screen lists them.
function listedGroups() {
  return shoppingList.groups.map((group) => [
    group.title,
    group.items.map((item) => `${item.name}: ${item.status}`),
  ]);
}

function stockOf(ingredientId: string) {
  return useInventoryStore.getState().items.find((item) => item.ingredientId === ingredientId)
    ?.amount;
}

function toggleItem(itemId: string) {
  act(() => {
    shoppingList.toggleItem(itemId);
  });
}

function toggleGroup(groupKey: string) {
  act(() => {
    shoppingList.toggleGroup(groupKey);
  });
}

beforeEach(() => {
  useMealPlanStore.setState({
    entries: PLAN,
    recipes: RECIPES as MasterRecipe[],
  });
  useInventoryStore.setState({
    items: [{ ingredientId: RICE, amount: 500 }],
    ingredients: MOCK_INGREDIENTS,
  });
  useShoppingListStore.setState({
    purchases: {},
    removedIds: [],
    manualItems: [],
    groupingMode: 'category',
  });
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

describe('useShoppingList', () => {
  it('lists what the plan is missing, grouped by category, up to the last planned date', () => {
    renderShoppingList();

    expect(shoppingList.untilDate).toBe('2026-10-12');
    expect(shoppingList.untilLabel).toBe('Hasta 12 Oct');
    expect(shoppingList.groupingMode).toBe('category');
    expect(listedGroups()).toEqual([
      ['Verduras', ['Espinaca: needed', 'Tomate: needed']],
      ['Proteínas', ['Pollo (Pechuga): needed']],
    ]);
    expect(shoppingList.counters).toEqual({ total: 3, purchased: 0, removed: 0 });
  });

  it('has no date and nothing to list when the plan is empty', () => {
    useMealPlanStore.setState({ entries: [] });

    renderShoppingList();

    expect(shoppingList.untilDate).toBeUndefined();
    expect(shoppingList.untilLabel).toBeUndefined();
    expect(shoppingList.groups).toEqual([]);
    expect(shoppingList.counters).toEqual({ total: 0, purchased: 0, removed: 0 });
  });

  it('resolves the best offer of every row that has one', () => {
    renderShoppingList();

    expect(shoppingList.bestOffers).toEqual({
      'planned:i2': { supermarket: 'Día', unitPrice: 7.6, price: 1520 },
      'planned:i3': { supermarket: 'Coto', unitPrice: 550, price: 1100 },
    });
  });

  it('regroups by supermarket when the mode is switched, with "Sin súper" last', () => {
    renderShoppingList();

    act(() => {
      shoppingList.setGroupingMode('supermarket');
    });

    expect(shoppingList.groupingMode).toBe('supermarket');
    expect(listedGroups()).toEqual([
      ['Coto', ['Tomate: needed']],
      ['Día', ['Pollo (Pechuga): needed']],
      ['Sin súper', ['Espinaca: needed']],
    ]);

    act(() => {
      shoppingList.setGroupingMode('category');
    });

    expect(listedGroups().map(([title]) => title)).toEqual(['Verduras', 'Proteínas']);
  });

  describe('toggling a row', () => {
    it('marks a needed row as purchased and stocks the inventory with its amount', () => {
      renderShoppingList();

      toggleItem('planned:i2');

      expect(listedGroups()).toEqual([
        ['Verduras', ['Espinaca: needed', 'Tomate: needed']],
        ['Proteínas', ['Pollo (Pechuga): purchased']],
      ]);
      expect(stockOf(CHICKEN)).toBe(200);
      expect(useShoppingListStore.getState().purchases).toEqual({ 'planned:i2': 200 });
      expect(shoppingList.counters).toEqual({ total: 3, purchased: 1, removed: 0 });
    });

    it('returns a purchased row to needed and takes its amount back out of the inventory', () => {
      renderShoppingList();
      toggleItem('planned:i2');

      toggleItem('planned:i2');

      expect(listedGroups()).toEqual([
        ['Verduras', ['Espinaca: needed', 'Tomate: needed']],
        ['Proteínas', ['Pollo (Pechuga): needed']],
      ]);
      expect(stockOf(CHICKEN)).toBeUndefined();
      expect(useShoppingListStore.getState().purchases).toEqual({});
      expect(shoppingList.counters).toEqual({ total: 3, purchased: 0, removed: 0 });
    });

    it('marks then unmarks when toggled twice from one stale render, never stocking twice', () => {
      renderShoppingList();
      const { toggleItem: staleToggleItem } = shoppingList;

      act(() => {
        staleToggleItem('planned:i2');
        staleToggleItem('planned:i2');
      });

      expect(stockOf(CHICKEN)).toBeUndefined();
      expect(useShoppingListStore.getState().purchases).toEqual({});
      expect(listedGroups()[1]).toEqual(['Proteínas', ['Pollo (Pechuga): needed']]);
    });

    it('ignores an id that is not on the list', () => {
      renderShoppingList();
      const inventoryBefore = useInventoryStore.getState().items;

      toggleItem('planned:i1');
      toggleItem('planned:unknown');

      expect(useInventoryStore.getState().items).toBe(inventoryBefore);
      expect(useShoppingListStore.getState().purchases).toEqual({});
    });
  });

  describe('"Marcar todos" on a group', () => {
    it('marks only the rows that are still needed, and leaves the other groups alone', () => {
      renderShoppingList();
      toggleItem('planned:i3');

      toggleGroup('verduras');

      expect(listedGroups()).toEqual([
        ['Verduras', ['Espinaca: purchased', 'Tomate: purchased']],
        ['Proteínas', ['Pollo (Pechuga): needed']],
      ]);
      // The tomato was already bought: it is not stocked a second time.
      expect(stockOf(TOMATO)).toBe(2);
      expect(stockOf(SPINACH)).toBe(100);
      expect(stockOf(CHICKEN)).toBeUndefined();
      expect(shoppingList.counters).toEqual({ total: 3, purchased: 2, removed: 0 });
    });

    it('unmarks every row once the whole group is purchased', () => {
      renderShoppingList();
      toggleGroup('verduras');
      toggleItem('planned:i2');

      toggleGroup('verduras');

      expect(listedGroups()).toEqual([
        ['Verduras', ['Espinaca: needed', 'Tomate: needed']],
        ['Proteínas', ['Pollo (Pechuga): purchased']],
      ]);
      expect(stockOf(TOMATO)).toBeUndefined();
      expect(stockOf(SPINACH)).toBeUndefined();
      expect(stockOf(CHICKEN)).toBe(200);
      expect(shoppingList.counters).toEqual({ total: 3, purchased: 1, removed: 0 });
    });

    it('works on a supermarket group too', () => {
      useShoppingListStore.setState({ groupingMode: 'supermarket' });
      renderShoppingList();

      toggleGroup('supermarket:Día');

      expect(listedGroups()).toEqual([
        ['Coto', ['Tomate: needed']],
        ['Día', ['Pollo (Pechuga): purchased']],
        ['Sin súper', ['Espinaca: needed']],
      ]);
    });

    it('marks then unmarks when pressed twice from one stale render, never stocking twice', () => {
      renderShoppingList();
      const { toggleGroup: staleToggleGroup } = shoppingList;

      act(() => {
        staleToggleGroup('verduras');
        staleToggleGroup('verduras');
      });

      expect(useInventoryStore.getState().items).toEqual([{ ingredientId: RICE, amount: 500 }]);
      expect(useShoppingListStore.getState().purchases).toEqual({});
    });

    it('ignores a group that is not listed in the current mode', () => {
      renderShoppingList();

      toggleGroup('supermarket:Día');

      expect(useShoppingListStore.getState().purchases).toEqual({});
    });
  });

  it('exposes the manual items still listed and counts what was removed', () => {
    useShoppingListStore.setState({
      removedIds: ['planned:i3'],
      manualItems: [
        { id: 'manual:1', source: 'manual', status: 'needed', name: 'Servilletas' },
        { id: 'manual:2', source: 'manual', status: 'removed', name: 'Velas' },
      ],
    });

    renderShoppingList();

    expect(shoppingList.manualItems.map((item) => item.name)).toEqual(['Servilletas']);
    expect(listedGroups()).toEqual([
      ['Verduras', ['Espinaca: needed']],
      ['Proteínas', ['Pollo (Pechuga): needed']],
    ]);
    expect(shoppingList.counters).toEqual({ total: 3, purchased: 0, removed: 2 });
  });

  it('toggles a manual item without touching the inventory', () => {
    useShoppingListStore.setState({
      manualItems: [{ id: 'manual:1', source: 'manual', status: 'needed', name: 'Servilletas' }],
    });
    renderShoppingList();
    const inventoryBefore = useInventoryStore.getState().items;

    toggleItem('manual:1');

    expect(shoppingList.manualItems.map((item) => item.status)).toEqual(['purchased']);
    expect(useInventoryStore.getState().items).toBe(inventoryBefore);

    toggleItem('manual:1');

    expect(shoppingList.manualItems.map((item) => item.status)).toEqual(['needed']);
  });

  describe('when another screen changes a store', () => {
    it('drops the rows of a meal that gets cooked', () => {
      renderShoppingList();

      act(() => {
        useMealPlanStore.getState().markAsCooked('mp2');
      });

      expect(listedGroups()).toEqual([
        ['Verduras', ['Tomate: needed']],
        ['Proteínas', ['Pollo (Pechuga): needed']],
      ]);
      expect(shoppingList.counters).toEqual({ total: 2, purchased: 0, removed: 0 });
    });

    it('drops a row once the inventory covers what the plan needs', () => {
      renderShoppingList();

      act(() => {
        useInventoryStore.getState().addItem(CHICKEN, 200);
      });

      expect(listedGroups()).toEqual([['Verduras', ['Espinaca: needed', 'Tomate: needed']]]);
      expect(shoppingList.bestOffers).not.toHaveProperty('planned:i2');
    });

    it('lists a row again, for what is missing, when the inventory runs short', () => {
      renderShoppingList();

      act(() => {
        useInventoryStore.getState().removeItem(RICE, 450);
      });

      expect(listedGroups()).toContainEqual(['Despensa', ['Arroz Blanco: needed']]);
      expect(shoppingList.groups.at(-1)?.items[0].amountToBuy).toBe(50);
    });
  });

  describe('adding a manual item', () => {
    it('lists the trimmed name as a needed item and counts it', () => {
      renderShoppingList();

      act(() => {
        shoppingList.addManualItem('  Papel de cocina ');
      });

      expect(shoppingList.manualItems).toEqual([
        { id: expect.any(String), source: 'manual', status: 'needed', name: 'Papel de cocina' },
      ]);
      expect(shoppingList.counters).toEqual({ total: 4, purchased: 0, removed: 0 });
    });

    it.each(['', '   '])('ignores the blank name "%s"', (name) => {
      renderShoppingList();

      act(() => {
        shoppingList.addManualItem(name);
      });

      expect(shoppingList.manualItems).toEqual([]);
      expect(shoppingList.counters.total).toBe(3);
    });
  });

  describe('removing a row', () => {
    function removeItem(itemId: string) {
      act(() => {
        shoppingList.removeItem(itemId);
      });
    }

    it('takes a planned row off its group and the total, and counts it as removed', () => {
      renderShoppingList();

      removeItem('planned:i3');

      expect(listedGroups()).toEqual([
        ['Verduras', ['Espinaca: needed']],
        ['Proteínas', ['Pollo (Pechuga): needed']],
      ]);
      expect(shoppingList.counters).toEqual({ total: 2, purchased: 0, removed: 1 });
    });

    it('takes a manual row off the list', () => {
      renderShoppingList();
      act(() => {
        shoppingList.addManualItem('Servilletas');
        shoppingList.addManualItem('Velas');
      });

      removeItem(shoppingList.manualItems[0].id);

      expect(shoppingList.manualItems.map((item) => item.name)).toEqual(['Velas']);
      expect(shoppingList.counters).toEqual({ total: 4, purchased: 0, removed: 1 });
    });

    it('leaves the inventory and the purchase of a row that was already bought', () => {
      renderShoppingList();
      toggleItem('planned:i2');

      removeItem('planned:i2');

      expect(stockOf(CHICKEN)).toBe(200);
      expect(useShoppingListStore.getState().purchases).toEqual({ 'planned:i2': 200 });
      expect(shoppingList.counters).toEqual({ total: 2, purchased: 0, removed: 1 });
    });

    it('keeps a removed row out of the row and group toggles', () => {
      renderShoppingList();
      removeItem('planned:i3');

      toggleItem('planned:i3');
      toggleGroup('verduras');

      expect(stockOf(TOMATO)).toBeUndefined();
      expect(useShoppingListStore.getState().purchases).toEqual({ 'planned:i7': 100 });
    });

    it('counts a row removed twice from one stale render only once', () => {
      renderShoppingList();
      const { removeItem: staleRemoveItem } = shoppingList;

      act(() => {
        staleRemoveItem('planned:i3');
        staleRemoveItem('planned:i3');
      });

      expect(useShoppingListStore.getState().removedIds).toEqual(['planned:i3']);
      expect(shoppingList.counters.removed).toBe(1);
    });

    it('ignores a row that left the list after the render it was pressed on', () => {
      renderShoppingList();
      const { removeItem: staleRemoveItem } = shoppingList;

      act(() => {
        // Cooking the spinach meal takes its row off the list before the press lands.
        useMealPlanStore.getState().markAsCooked('mp2');
        staleRemoveItem('planned:i7');
        staleRemoveItem('planned:unknown');
      });

      expect(useShoppingListStore.getState().removedIds).toEqual([]);
      expect(shoppingList.counters.removed).toBe(0);
    });

    it('brings every removed row back when they are restored', () => {
      renderShoppingList();
      act(() => {
        shoppingList.addManualItem('Servilletas');
      });
      removeItem('planned:i3');
      removeItem(shoppingList.manualItems[0].id);
      expect(shoppingList.counters).toEqual({ total: 2, purchased: 0, removed: 2 });

      act(() => {
        shoppingList.restoreRemoved();
      });

      expect(listedGroups()[0]).toEqual(['Verduras', ['Espinaca: needed', 'Tomate: needed']]);
      expect(shoppingList.manualItems.map((item) => item.name)).toEqual(['Servilletas']);
      expect(shoppingList.counters).toEqual({ total: 4, purchased: 0, removed: 0 });
    });
  });
});
