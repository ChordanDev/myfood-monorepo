import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import type { Ingredient } from '@/types/domain';
import type { InventoryItem } from '../types';
import { migrateInventoryState, useInventoryStore } from './useInventoryStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const INGREDIENTS: Ingredient[] = [
  { id: 'rice', name: 'Rice', category: 'almacen', basePrice: 2, unit: 'g' },
  { id: 'milk', name: 'Milk', category: 'lacteos', basePrice: 3, unit: 'ml' },
];

const RICE: InventoryItem = {
  id: 'inv-rice',
  ingredientId: 'rice',
  name: 'Rice',
  category: 'almacen',
  quantity: 500,
  unit: 'g',
  confidence: 'estimated',
};

function findItem(id: string) {
  return useInventoryStore.getState().items.find((item) => item.id === id);
}

beforeEach(() => {
  useInventoryStore.setState({ items: [RICE], ingredients: INGREDIENTS });
});

describe('addItem', () => {
  it('adds the amount to an item that is already in the inventory', () => {
    useInventoryStore.getState().addItem('rice', 250);

    expect(useInventoryStore.getState().items).toEqual([{ ...RICE, quantity: 750 }]);
  });

  it('creates the item from the ingredient catalog when it is new', () => {
    useInventoryStore.getState().addItem('milk', 1000);

    expect(findItem('inv-milk')).toEqual({
      id: 'inv-milk',
      ingredientId: 'milk',
      name: 'Milk',
      category: 'lacteos',
      quantity: 1000,
      unit: 'ml',
      confidence: 'estimated',
    });
  });

  it('ignores an ingredient that is not in the catalog', () => {
    useInventoryStore.getState().addItem('unknown', 100);

    expect(useInventoryStore.getState().items).toEqual([RICE]);
  });
});

describe('consumeIngredient', () => {
  it('subtracts the consumed amount', () => {
    useInventoryStore.getState().consumeIngredient('rice', 200);

    expect(findItem('inv-rice')?.quantity).toBe(300);
  });

  it('clamps at zero and keeps the record when more than the stock is consumed', () => {
    useInventoryStore.getState().consumeIngredient('rice', 900);

    expect(useInventoryStore.getState().items).toEqual([{ ...RICE, quantity: 0 }]);
  });

  it('ignores an ingredient that is not in the inventory', () => {
    useInventoryStore.getState().consumeIngredient('milk', 100);

    expect(useInventoryStore.getState().items).toEqual([RICE]);
  });

  it('lets a later addItem revive an item that ran out', () => {
    useInventoryStore.getState().consumeIngredient('rice', 500);
    useInventoryStore.getState().addItem('rice', 150);

    expect(useInventoryStore.getState().items).toEqual([{ ...RICE, quantity: 150 }]);
  });
});

describe('updateItem', () => {
  it('edits the name, the quantity and the notes', () => {
    useInventoryStore
      .getState()
      .updateItem('inv-rice', { name: 'Brown rice', quantity: 320, notes: 'Open bag' });

    expect(findItem('inv-rice')).toMatchObject({
      name: 'Brown rice',
      quantity: 320,
      notes: 'Open bag',
    });
  });

  it('changes only the fields it receives', () => {
    useInventoryStore.getState().updateItem('inv-rice', { notes: 'Open bag' });

    expect(findItem('inv-rice')).toEqual({ ...RICE, notes: 'Open bag' });
  });

  it('marks the item as exact when the quantity is edited', () => {
    useInventoryStore.getState().updateItem('inv-rice', { quantity: 320 });

    expect(findItem('inv-rice')?.confidence).toBe('exact');
  });

  it('accepts zero as a quantity', () => {
    useInventoryStore.getState().updateItem('inv-rice', { quantity: 0 });

    expect(findItem('inv-rice')).toMatchObject({ quantity: 0, confidence: 'exact' });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('ignores %p as a quantity', (quantity) => {
    useInventoryStore.getState().updateItem('inv-rice', { quantity });

    expect(findItem('inv-rice')).toEqual(RICE);
  });

  it('trims the name', () => {
    useInventoryStore.getState().updateItem('inv-rice', { name: '  Brown rice ' });

    expect(findItem('inv-rice')?.name).toBe('Brown rice');
  });

  it('ignores an empty name', () => {
    useInventoryStore.getState().updateItem('inv-rice', { name: '   ' });

    expect(findItem('inv-rice')).toEqual(RICE);
  });

  it('clears the notes when they are edited to blank', () => {
    useInventoryStore.setState({ items: [{ ...RICE, notes: 'Open bag' }] });

    useInventoryStore.getState().updateItem('inv-rice', { notes: '  ' });

    expect(findItem('inv-rice')).toEqual(RICE);
  });

  it('leaves the inventory untouched when the item does not exist', () => {
    useInventoryStore.getState().updateItem('inv-unknown', { quantity: 10 });

    expect(useInventoryStore.getState().items).toEqual([RICE]);
  });
});

describe('removeItem', () => {
  it('sets the quantity to zero and keeps the record', () => {
    useInventoryStore.getState().removeItem('inv-rice');

    expect(useInventoryStore.getState().items).toEqual([{ ...RICE, quantity: 0 }]);
  });

  it('leaves the other items untouched', () => {
    const milk: InventoryItem = {
      id: 'inv-milk',
      name: 'Milk',
      category: 'lacteos',
      quantity: 1000,
      unit: 'ml',
      confidence: 'estimated',
    };
    useInventoryStore.setState({ items: [RICE, milk] });

    useInventoryStore.getState().removeItem('inv-rice');

    expect(findItem('inv-milk')).toEqual(milk);
  });
});

describe('migrateInventoryState', () => {
  it('converts an unversioned payload into self-contained items', () => {
    const persisted = {
      items: [
        { ingredientId: 'i1', amount: 500 },
        { ingredientId: 'i4', amount: 3, isLeftover: true },
      ],
      ingredients: [
        { id: 'i1', name: 'Arroz', category: 'despensa', basePrice: 2, unit: 'gramos' },
      ],
    };

    expect(migrateInventoryState(persisted, 0)).toEqual({
      items: [
        {
          id: 'inv-i1',
          ingredientId: 'i1',
          name: 'Arroz Blanco',
          category: 'almacen',
          quantity: 500,
          unit: 'g',
          confidence: 'estimated',
        },
        {
          id: 'inv-i4',
          ingredientId: 'i4',
          name: 'Cebolla',
          category: 'verduras',
          quantity: 3,
          unit: 'unit',
          confidence: 'estimated',
          isLeftover: true,
        },
      ],
      ingredients: MOCK_INGREDIENTS,
    });
  });

  it('drops the items whose ingredient is not in the catalog', () => {
    const persisted = {
      items: [
        { ingredientId: 'gone', amount: 40 },
        { ingredientId: 'i5', amount: 250 },
      ],
      ingredients: [],
    };

    expect(migrateInventoryState(persisted, 0).items.map((item) => item.id)).toEqual(['inv-i5']);
  });

  it('starts with an empty inventory when the payload has no items', () => {
    expect(migrateInventoryState(null, 0)).toEqual({ items: [], ingredients: MOCK_INGREDIENTS });
  });

  it('keeps a payload that is already on the current version', () => {
    const persisted = { items: [RICE], ingredients: INGREDIENTS };

    expect(migrateInventoryState(persisted, 1)).toEqual(persisted);
  });
});
