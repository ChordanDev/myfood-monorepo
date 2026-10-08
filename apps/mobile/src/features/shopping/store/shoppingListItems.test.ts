import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import type { InventoryItem } from '@/features/inventory';
import { useInventoryStore } from '@/features/inventory/store';
import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import { useMealPlanStore } from '@/store';
import { getPlannedItemId } from '../domain';
import type { ManualShoppingListItem, ShoppingListItem } from '../types';
import { addIngredientToShoppingList, readShoppingListItems } from './shoppingListItems';
import { useShoppingListStore } from './useShoppingListStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The day the list takes for today. Nothing depends on it until the user chooses a day.
let mockTodayKey = '2026-10-01';

jest.mock('./today', () => ({ getTodayKey: () => mockTodayKey }));

// The plan lists the chicken and the rice (in stock). The spinach is in no planned meal.
const RICE = { id: 'i1', name: 'Arroz Blanco' };
const CHICKEN = { id: 'i2', name: 'Pollo (Pechuga)' };
const SPINACH = { id: 'i7', name: 'Espinaca' };

const CHICKEN_ID = getPlannedItemId(CHICKEN.id);

const RECIPES = [
  {
    id: 'r1',
    ingredients: [
      { ingredientId: CHICKEN.id, amount: 200 },
      { ingredientId: RICE.id, amount: 100 },
    ],
  },
] as MasterRecipe[];

const PLAN: MealPlanEntry[] = [
  { id: 'mp1', date: '2026-10-06', type: 'lunch', recipeId: 'r1', isCooked: false },
];

const RICE_STOCK: InventoryItem = {
  id: 'inv-i1',
  ingredientId: RICE.id,
  name: 'Arroz Blanco',
  category: 'almacen',
  quantity: 500,
  unit: 'g',
  confidence: 'exact',
};

function manualItem(
  sequence: number,
  name: string,
  status: ManualShoppingListItem['status'] = 'needed'
): ManualShoppingListItem {
  return { id: `manual:${sequence}`, source: 'manual', status, name };
}

const shopping = () => useShoppingListStore.getState();

function listedItem(itemId: string): ShoppingListItem {
  const item = readShoppingListItems().find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`No ${itemId} on the list`);

  return item;
}

// Rows of the list as the Carrito would read them: [name, status].
const listed = () => readShoppingListItems().map((item) => [item.name, item.status]);

beforeEach(() => {
  useMealPlanStore.setState({ entries: PLAN, recipes: RECIPES });
  useInventoryStore.setState({ items: [RICE_STOCK], ingredients: MOCK_INGREDIENTS });
  useShoppingListStore.setState({
    cartIds: [],
    removedIds: [],
    manualItems: [],
    lastManualItemSequence: 0,
    groupingMode: 'category',
    chosenUntilDate: undefined,
  });
  mockTodayKey = '2026-10-01';
});

describe('readShoppingListItems', () => {
  it('derives the list from the plan, the inventory and the shopping store as they are', () => {
    expect(listed()).toEqual([['Pollo (Pechuga)', 'needed']]);

    shopping().addManualItem('Servilletas');
    shopping().addToCart([CHICKEN_ID]);

    expect(listed()).toEqual([
      ['Pollo (Pechuga)', 'in_cart'],
      ['Servilletas', 'needed'],
    ]);

    useMealPlanStore.setState({ entries: [{ ...PLAN[0], isCooked: true }] });

    expect(listed()).toEqual([['Servilletas', 'needed']]);
  });
});

describe('addIngredientToShoppingList', () => {
  describe('for an ingredient the plan lists', () => {
    it('changes nothing while its planned row is on the list', () => {
      const stateBefore = shopping();

      addIngredientToShoppingList(CHICKEN);

      expect(shopping()).toBe(stateBefore);
    });

    it('changes nothing while its planned row is in the cart', () => {
      shopping().addToCart([CHICKEN_ID]);
      const stateBefore = shopping();

      addIngredientToShoppingList(CHICKEN);

      expect(shopping()).toBe(stateBefore);
    });

    it('restores its planned row when the user had removed it, without adding a manual one', () => {
      shopping().removeItem(listedItem(CHICKEN_ID));

      addIngredientToShoppingList(CHICKEN);

      expect(shopping().removedIds).toEqual([]);
      expect(shopping().manualItems).toEqual([]);
      expect(listed()).toEqual([['Pollo (Pechuga)', 'needed']]);
    });

    it('restores only that row and leaves the other removed rows removed', () => {
      shopping().addManualItem('Servilletas');
      shopping().removeItem(listedItem('manual:1'));
      shopping().removeItem(listedItem(CHICKEN_ID));

      addIngredientToShoppingList(CHICKEN);

      expect(listed()).toEqual([
        ['Pollo (Pechuga)', 'needed'],
        ['Servilletas', 'removed'],
      ]);
    });
  });

  describe('for an ingredient the plan does not list', () => {
    it('adds a manual item with the name of the ingredient', () => {
      addIngredientToShoppingList(SPINACH);

      expect(shopping().manualItems).toEqual([manualItem(1, 'Espinaca')]);
    });

    it('adds a manual item for an ingredient the stock already covers in the plan', () => {
      addIngredientToShoppingList(RICE);

      expect(shopping().manualItems).toEqual([manualItem(1, 'Arroz Blanco')]);
    });

    it('never adds a second manual item when it is called again', () => {
      addIngredientToShoppingList(SPINACH);
      const stateBefore = shopping();

      addIngredientToShoppingList(SPINACH);
      addIngredientToShoppingList({ id: SPINACH.id, name: '  espinaca ' });

      expect(shopping()).toBe(stateBefore);
    });

    it('changes nothing while a manual item with that name is in the cart', () => {
      shopping().addManualItem('espinaca');
      shopping().addToCart(['manual:1']);
      const stateBefore = shopping();

      addIngredientToShoppingList(SPINACH);

      expect(shopping()).toBe(stateBefore);
    });

    it('restores a removed manual item with that name instead of adding a duplicate', () => {
      shopping().addManualItem('Servilletas');
      shopping().addManualItem('ESPINACA');
      shopping().removeItem(listedItem('manual:1'));
      shopping().removeItem(listedItem('manual:2'));

      addIngredientToShoppingList(SPINACH);

      expect(shopping().manualItems).toEqual([
        manualItem(1, 'Servilletas', 'removed'),
        manualItem(2, 'ESPINACA'),
      ]);
    });
  });

  describe('reading the list as it is when it is called', () => {
    it('adds a manual item once the meal that listed the ingredient was cooked', () => {
      useMealPlanStore.setState({ entries: [{ ...PLAN[0], isCooked: true }] });

      addIngredientToShoppingList(CHICKEN);

      expect(listed()).toEqual([['Pollo (Pechuga)', 'needed']]);
      expect(shopping().manualItems).toEqual([manualItem(1, 'Pollo (Pechuga)')]);
    });

    it('adds a manual item when the removed planned row is not on the list any more', () => {
      shopping().removeItem(listedItem(CHICKEN_ID));
      useMealPlanStore.setState({ entries: [] });

      addIngredientToShoppingList(CHICKEN);

      // The removal is kept: it applies again if the plan lists the ingredient later.
      expect(shopping().removedIds).toEqual([CHICKEN_ID]);
      expect(shopping().manualItems).toEqual([manualItem(1, 'Pollo (Pechuga)')]);
    });
  });
});

describe('the list after the user chose the last day to buy for', () => {
  const SPINACH_ID = getPlannedItemId(SPINACH.id);

  // The chicken is planned for the 6th and the spinach for the 12th.
  beforeEach(() => {
    useMealPlanStore.setState({
      entries: [
        ...PLAN,
        { id: 'mp2', date: '2026-10-12', type: 'dinner', recipeId: 'r2', isCooked: false },
      ],
      recipes: [
        ...RECIPES,
        { id: 'r2', ingredients: [{ ingredientId: SPINACH.id, amount: 100 }] },
      ] as MasterRecipe[],
    });
  });

  it('reaches the last planned date while no day is chosen', () => {
    expect(listed()).toEqual([
      ['Pollo (Pechuga)', 'needed'],
      ['Espinaca', 'needed'],
    ]);
  });

  it('reaches the chosen day and no further', () => {
    shopping().setChosenUntilDate('2026-10-06');

    expect(listed()).toEqual([['Pollo (Pechuga)', 'needed']]);
  });

  it('reaches the last planned date again once the chosen day has passed', () => {
    shopping().setChosenUntilDate('2026-10-06');
    mockTodayKey = '2026-10-07';

    expect(listed()).toEqual([
      ['Pollo (Pechuga)', 'needed'],
      ['Espinaca', 'needed'],
    ]);
  });

  it('keeps in the store the id of a row in the cart that the chosen day leaves out', () => {
    shopping().addToCart([SPINACH_ID]);

    shopping().setChosenUntilDate('2026-10-06');

    expect(listed()).toEqual([['Pollo (Pechuga)', 'needed']]);
    expect(shopping().cartIds).toEqual([SPINACH_ID]);

    // Reaching its meal again brings the row back as the user left it.
    shopping().setChosenUntilDate(undefined);

    expect(listed()).toEqual([
      ['Pollo (Pechuga)', 'needed'],
      ['Espinaca', 'in_cart'],
    ]);
  });

  it('adds by hand an ingredient whose meal is after the chosen day', () => {
    shopping().setChosenUntilDate('2026-10-06');

    addIngredientToShoppingList(SPINACH);

    expect(listed()).toEqual([
      ['Pollo (Pechuga)', 'needed'],
      ['Espinaca', 'needed'],
    ]);
    expect(shopping().manualItems).toEqual([manualItem(1, 'Espinaca')]);
  });
});
