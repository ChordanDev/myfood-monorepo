import type { InventoryItem } from '@/features/inventory';
import type { Ingredient, RecipeIngredient } from '@/types/domain';
import {
  countMissing,
  formatMissingSummary,
  formatQuantity,
  formatUnit,
  resolveRecipeIngredients,
  toSentenceCase,
} from './recipeIngredients';

const CATALOG: Ingredient[] = [
  { id: 'i1', name: 'Arroz Blanco', category: 'almacen', basePrice: 2, unit: 'g' },
  { id: 'i2', name: 'Pollo (Pechuga)', category: 'carnes', basePrice: 10, unit: 'g' },
  { id: 'i3', name: 'Tomate', category: 'verduras', basePrice: 3, unit: 'unit' },
  { id: 'i5', name: 'Aceite de Oliva', category: 'almacen', basePrice: 15, unit: 'ml' },
];

const LINES: RecipeIngredient[] = [
  { ingredientId: 'i1', amount: 100 },
  { ingredientId: 'i2', amount: 200 },
  { ingredientId: 'i3', amount: 2 },
  { ingredientId: 'i5', amount: 10 },
];

type StockItem = Pick<InventoryItem, 'ingredientId' | 'quantity' | 'isLeftover'>;

function resolve(inventory: StockItem[], listedIngredientIds?: string[]) {
  return resolveRecipeIngredients({
    lines: LINES,
    catalog: CATALOG,
    inventory,
    listedIngredientIds,
  });
}

describe('formatUnit', () => {
  it('abbreviates each unit', () => {
    expect(formatUnit('g')).toBe('g');
    expect(formatUnit('ml')).toBe('ml');
    expect(formatUnit('unit')).toBe('u');
  });
});

describe('formatQuantity', () => {
  it('joins the amount and the abbreviated unit', () => {
    expect(formatQuantity(100, 'g')).toBe('100 g');
    expect(formatQuantity(2, 'unit')).toBe('2 u');
    expect(formatQuantity(10, 'ml')).toBe('10 ml');
  });

  it('keeps decimals without trailing zeros', () => {
    expect(formatQuantity(1.5, 'unit')).toBe('1.5 u');
    expect(formatQuantity(2.5, 'g')).toBe('2.5 g');
    expect(formatQuantity(3.0, 'ml')).toBe('3 ml');
  });

  it('rounds floating point noise away', () => {
    expect(formatQuantity(0.1 + 0.2, 'g')).toBe('0.3 g');
  });
});

describe('toSentenceCase', () => {
  it('uppercases only the first letter', () => {
    expect(toSentenceCase('Arroz Blanco')).toBe('Arroz blanco');
    expect(toSentenceCase('aceite de OLIVA')).toBe('Aceite de oliva');
  });

  it('lowercases the text inside parentheses', () => {
    expect(toSentenceCase('Pollo (Pechuga)')).toBe('Pollo (pechuga)');
  });

  it('trims surrounding whitespace', () => {
    expect(toSentenceCase('  Tomate  ')).toBe('Tomate');
  });

  it('returns an empty string for blank input', () => {
    expect(toSentenceCase('   ')).toBe('');
  });
});

describe('resolveRecipeIngredients', () => {
  it('describes each line with the catalog name and quantity, in recipe order', () => {
    const rows = resolve([]);

    expect(rows.map((row) => row.ingredientId)).toEqual(['i1', 'i2', 'i3', 'i5']);
    expect(rows.map((row) => row.name)).toEqual([
      'Arroz blanco',
      'Pollo (pechuga)',
      'Tomate',
      'Aceite de oliva',
    ]);
    expect(rows.map((row) => row.quantityLabel)).toEqual(['100 g', '200 g', '2 u', '10 ml']);
    expect(rows.map((row) => row.unit)).toEqual(['g', 'g', 'unit', 'ml']);
  });

  it('marks an ingredient in stock when the inventory covers the recipe amount', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantity: 500 }]);

    expect(rice).toEqual({
      ingredientId: 'i1',
      name: 'Arroz blanco',
      quantityLabel: '100 g',
      requiredAmount: 100,
      availableAmount: 500,
      missingAmount: 0,
      unit: 'g',
      status: 'in_stock',
    });
  });

  it('treats an inventory amount equal to the recipe amount as in stock', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantity: 100 }]);

    expect(rice.status).toBe('in_stock');
    expect(rice.missingAmount).toBe(0);
  });

  it('marks an ingredient missing when the inventory falls short', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantity: 99 }]);

    expect(rice.status).toBe('missing');
    expect(rice.availableAmount).toBe(99);
    expect(rice.missingAmount).toBe(1);
  });

  it('marks an ingredient missing when it is not in the inventory at all', () => {
    const chicken = resolve([])[1];

    expect(chicken.status).toBe('missing');
    expect(chicken.availableAmount).toBe(0);
    expect(chicken.missingAmount).toBe(200);
  });

  it('sums every inventory item of the same ingredient', () => {
    const [rice] = resolve([
      { ingredientId: 'i1', quantity: 60 },
      { ingredientId: 'i1', quantity: 40, isLeftover: true },
    ]);

    expect(rice.availableAmount).toBe(100);
    expect(rice.status).toBe('in_stock');
  });

  it('ignores an inventory item that is not linked to the ingredient catalog', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantity: 60 }, { quantity: 500 }]);

    expect(rice.availableAmount).toBe(60);
    expect(rice.missingAmount).toBe(40);
    expect(rice.status).toBe('missing');
  });

  it('counts no stock when no inventory item is linked to the ingredient catalog', () => {
    const rows = resolve([{ quantity: 500 }, { quantity: 3, isLeftover: true }]);

    expect(rows.map((row) => row.availableAmount)).toEqual([0, 0, 0, 0]);
    expect(rows.map((row) => row.status)).toEqual(['missing', 'missing', 'missing', 'missing']);
  });

  it('marks a short ingredient as listed when it is already on the shopping list', () => {
    const rows = resolve([], ['i2']);

    expect(rows[1].status).toBe('listed');
    expect(rows[1].missingAmount).toBe(200);
    expect(rows[0].status).toBe('missing');
  });

  it('marks every short ingredient the shopping list covers as listed', () => {
    const rows = resolve([{ ingredientId: 'i1', quantity: 99 }], ['i1', 'i3', 'i5']);

    expect(rows.map((row) => row.status)).toEqual(['listed', 'missing', 'listed', 'listed']);
  });

  it('keeps an ingredient in stock even when the shopping list has it', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantity: 500 }], ['i1']);

    expect(rice.status).toBe('in_stock');
  });

  it('falls back to a neutral row for an id that is not in the catalog', () => {
    const [unknown] = resolveRecipeIngredients({
      lines: [{ ingredientId: 'ghost', amount: 3 }],
      catalog: CATALOG,
      inventory: [{ ingredientId: 'ghost', quantity: 50 }],
    });

    expect(unknown).toEqual({
      ingredientId: 'ghost',
      name: 'Ingrediente desconocido',
      quantityLabel: '3',
      requiredAmount: 3,
      availableAmount: 50,
      missingAmount: 0,
      unit: null,
      status: 'missing',
    });
  });

  it('never marks an unknown ingredient as listed, even when its id is given as listed', () => {
    const [unknown] = resolveRecipeIngredients({
      lines: [{ ingredientId: 'ghost', amount: 3 }],
      catalog: CATALOG,
      inventory: [],
      listedIngredientIds: ['ghost'],
    });

    expect(unknown.status).toBe('missing');
  });

  it('returns no rows for a recipe without ingredients', () => {
    expect(resolveRecipeIngredients({ lines: [], catalog: CATALOG, inventory: [] })).toEqual([]);
  });
});

describe('countMissing', () => {
  it('counts every row that is not in stock, listed ones included', () => {
    const rows = resolve(
      [
        { ingredientId: 'i1', quantity: 500 },
        { ingredientId: 'i5', quantity: 250 },
      ],
      ['i3']
    );

    expect(countMissing(rows)).toBe(2);
  });

  it('counts nothing when everything is in stock', () => {
    const rows = resolve(
      LINES.map(({ ingredientId, amount }) => ({ ingredientId, quantity: amount }))
    );

    expect(countMissing(rows)).toBe(0);
  });
});

describe('formatMissingSummary', () => {
  it('returns nothing when no ingredient is missing', () => {
    expect(formatMissingSummary(0)).toBeNull();
  });

  it('uses the singular for one missing ingredient', () => {
    expect(formatMissingSummary(1)).toBe('1 te falta');
  });

  it('uses the plural for several missing ingredients', () => {
    expect(formatMissingSummary(2)).toBe('2 te faltan');
    expect(formatMissingSummary(7)).toBe('7 te faltan');
  });
});
