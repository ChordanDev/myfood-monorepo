import type {
  ManualShoppingListItem,
  PlannedShoppingListItem,
  ShoppingItemStatus,
  ShoppingListItem,
} from '../types';
import { getIngredientListState, getManualItemsNamed } from './ingredientListState';
import { getPlannedItemId } from './shoppingList';

const CHICKEN = { id: 'i2', name: 'Pollo (Pechuga)' };

function plannedItem(
  status: ShoppingItemStatus,
  ingredient: { id: string; name: string } = CHICKEN
): PlannedShoppingListItem {
  return {
    id: getPlannedItemId(ingredient.id),
    source: 'planned_meal',
    status,
    name: ingredient.name,
    ingredientId: ingredient.id,
    amountToBuy: 200,
    unit: 'g',
    category: 'carnes',
  };
}

function manualItem(
  sequence: number,
  name: string,
  status: ShoppingItemStatus = 'needed'
): ManualShoppingListItem {
  return { id: `manual:${sequence}`, source: 'manual', status, name };
}

function stateOf(items: ShoppingListItem[]) {
  return getIngredientListState(items, CHICKEN);
}

describe('getIngredientListState', () => {
  describe('of an ingredient the plan lists', () => {
    it('is listed while its planned item is needed', () => {
      expect(stateOf([plannedItem('needed')])).toBe('listed');
    });

    it('is listed while its planned item is in the cart', () => {
      expect(stateOf([plannedItem('in_cart')])).toBe('listed');
    });

    it('is removed when its planned item was taken off the list', () => {
      expect(stateOf([plannedItem('removed')])).toBe('removed');
    });

    it('reads only the planned item of that ingredient', () => {
      const tomato = plannedItem('needed', { id: 'i3', name: 'Tomate' });

      expect(stateOf([tomato])).toBe('absent');
      expect(stateOf([tomato, plannedItem('removed')])).toBe('removed');
    });
  });

  describe('of an ingredient the plan does not list', () => {
    it('is absent from an empty list', () => {
      expect(stateOf([])).toBe('absent');
    });

    it('is absent when no manual item carries its name', () => {
      expect(stateOf([manualItem(1, 'Servilletas'), manualItem(2, 'Pollo')])).toBe('absent');
    });

    it('is listed when a needed manual item carries its name', () => {
      expect(stateOf([manualItem(1, 'Pollo (Pechuga)')])).toBe('listed');
    });

    it('is listed when a manual item in the cart carries its name', () => {
      expect(stateOf([manualItem(1, 'Pollo (Pechuga)', 'in_cart')])).toBe('listed');
    });

    it('compares the names trimmed and without case', () => {
      expect(stateOf([manualItem(1, 'pollo (pechuga)')])).toBe('listed');
      expect(stateOf([manualItem(1, 'POLLO (PECHUGA)')])).toBe('listed');
      expect(
        getIngredientListState([manualItem(1, 'Pollo (pechuga)')], {
          id: 'i2',
          name: '  Pollo (Pechuga) ',
        })
      ).toBe('listed');
    });

    it('does not count a removed manual item as listed', () => {
      expect(stateOf([manualItem(1, 'Pollo (Pechuga)', 'removed')])).toBe('absent');
    });
  });

  describe('of an ingredient both a planned and a manual item stand for', () => {
    it('is listed when its planned item was removed but a manual item lists it', () => {
      expect(stateOf([plannedItem('removed'), manualItem(1, 'pollo (pechuga)')])).toBe('listed');
    });

    it('is removed when both its planned item and its manual item were removed', () => {
      expect(stateOf([plannedItem('removed'), manualItem(1, 'Pollo (Pechuga)', 'removed')])).toBe(
        'removed'
      );
    });

    it('is listed when its planned item is, whatever the manual item says', () => {
      expect(stateOf([plannedItem('needed'), manualItem(1, 'Pollo (Pechuga)', 'removed')])).toBe(
        'listed'
      );
    });
  });
});

describe('getManualItemsNamed', () => {
  it('returns the manual items with that name in any status, in list order', () => {
    const removed = manualItem(1, ' pollo (pechuga)', 'removed');
    const needed = manualItem(3, 'POLLO (PECHUGA)');
    const items = [plannedItem('needed'), removed, manualItem(2, 'Velas'), needed];

    expect(getManualItemsNamed(items, 'Pollo (Pechuga)')).toEqual([removed, needed]);
  });

  it('never returns a planned item, even one with the same name', () => {
    expect(getManualItemsNamed([plannedItem('needed')], 'Pollo (Pechuga)')).toEqual([]);
  });
});
