import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import { useInventoryStore } from '@/features/inventory/store';
import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import { useMealPlanStore } from '@/store';
import { readShoppingListItems, useShoppingListStore } from '../store';
import type { ShoppingListItem } from '../types';
import { useShoppingListItems } from './useShoppingListItems';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const CHICKEN = 'i2';
const SPINACH = 'i7';

// One meal of chicken, and a later one of spinach: the list covers the whole plan.
const RECIPES = [
  { id: 'r1', ingredients: [{ ingredientId: CHICKEN, amount: 200 }] },
  { id: 'r2', ingredients: [{ ingredientId: SPINACH, amount: 100 }] },
] as MasterRecipe[];

const PLAN: MealPlanEntry[] = [
  { id: 'mp1', date: '2026-10-06', type: 'almuerzo', recipeId: 'r1', isCooked: false },
  { id: 'mp2', date: '2026-10-12', type: 'cena', recipeId: 'r2', isCooked: false },
];

// Every `act` below takes a block: a persisted `set` returns a promise, and `act` would take
// a returned promise for an async scope.
let tree: ReturnType<typeof create> | undefined;
let items: ShoppingListItem[];
let renderCount: number;

function HookHarness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result for assertions.
  items = useShoppingListItems();
  // eslint-disable-next-line react-hooks/globals -- Test harness counts the renders for assertions.
  renderCount += 1;
  return null;
}

// Rows as [id, status], with the amount of the planned ones.
function summarize(list: ShoppingListItem[]) {
  return list.map((item) =>
    item.source === 'planned_meal'
      ? [item.id, item.status, item.amountToBuy]
      : [item.id, item.status]
  );
}

beforeEach(() => {
  useMealPlanStore.setState({ entries: PLAN, recipes: RECIPES });
  useInventoryStore.setState({ items: [], ingredients: MOCK_INGREDIENTS });
  useShoppingListStore.setState({
    cartIds: [],
    removedIds: [],
    manualItems: [],
    lastManualItemSequence: 0,
    groupingMode: 'category',
  });
  renderCount = 0;
  act(() => {
    tree = create(<HookHarness />);
  });
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

describe('useShoppingListItems', () => {
  it('returns the list derived from the whole plan, planned rows first', () => {
    act(() => {
      useShoppingListStore.getState().addManualItem('Servilletas');
    });

    expect(summarize(items)).toEqual([
      ['planned:i2', 'needed', 200],
      ['planned:i7', 'needed', 100],
      ['manual:1', 'needed'],
    ]);
  });

  it('is the list an action reads outside a render', () => {
    act(() => {
      useShoppingListStore.getState().addToCart(['planned:i7']);
    });

    expect(items).toEqual(readShoppingListItems());
  });

  it('follows the shopping store, the plan and the inventory', () => {
    act(() => {
      useShoppingListStore.getState().removeItem(items[0]);
    });
    expect(summarize(items)[0]).toEqual(['planned:i2', 'removed', 200]);

    act(() => {
      useShoppingListStore.getState().restoreItem('planned:i2');
    });
    expect(summarize(items)[0]).toEqual(['planned:i2', 'needed', 200]);

    act(() => {
      useInventoryStore.getState().addItem(CHICKEN, 150);
    });
    expect(summarize(items)[0]).toEqual(['planned:i2', 'needed', 50]);

    act(() => {
      useMealPlanStore.setState({ entries: [{ ...PLAN[0], isCooked: true }, PLAN[1]] });
    });
    expect(summarize(items)).toEqual([['planned:i7', 'needed', 100]]);
  });

  it('keeps the same list while nothing it is derived from changes', () => {
    const itemsBefore = items;
    const rendersBefore = renderCount;

    act(() => {
      useShoppingListStore.getState().setGroupingMode('supermarket');
    });
    act(() => {
      useMealPlanStore.setState({ favoriteRecipeIds: ['r1'] });
    });

    expect(items).toBe(itemsBefore);
    expect(renderCount).toBe(rendersBefore);
  });
});
