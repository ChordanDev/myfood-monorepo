import type { Ingredient } from '@/types/domain';
import type { RecipeIngredientLine } from '../types/recipe';
import { countMissing, formatMissingSummary, resolveRecipeIngredients } from './recipeIngredients';

const CATALOG: Ingredient[] = [
  { id: 'i1', name: 'Arroz Blanco', category: 'almacen', basePrice: 2, unit: 'g' },
  { id: 'i2', name: 'Pollo (Pechuga)', category: 'carnes', basePrice: 10, unit: 'g' },
  { id: 'i3', name: 'Tomate', category: 'verduras', basePrice: 3, unit: 'unit' },
  { id: 'i5', name: 'Aceite de Oliva', category: 'almacen', basePrice: 15, unit: 'ml' },
];

function line(overrides: Partial<RecipeIngredientLine> & { ingredientId: string }) {
  return { name: 'Arroz', category: null, quantityMilli: 100000, unit: 'g', ...overrides } as const;
}

const LINES: RecipeIngredientLine[] = [
  line({ ingredientId: 'i1', name: 'Arroz' }),
  line({ ingredientId: 'i2', name: 'Pechuga de pollo', quantityMilli: 200000 }),
  line({ ingredientId: 'i3', name: 'Tomate', quantityMilli: 2000, unit: 'unit' }),
  line({ ingredientId: 'i5', name: 'Aceite de oliva', quantityMilli: 10000, unit: 'ml' }),
];

// The inventory counts in thousandths of the unit: 500_000 is 500 g.
type StockItem = { ingredientId?: string; quantityMilli: number; isLeftover?: boolean };

function resolve(inventory: StockItem[], listedIngredientIds?: string[]) {
  return resolveRecipeIngredients({
    lines: LINES,
    catalog: CATALOG,
    inventory,
    listedIngredientIds,
  });
}

describe('resolveRecipeIngredients', () => {
  it('describes each line with its own name and quantity, in recipe order', () => {
    const rows = resolve([]);

    expect(rows.map((row) => row.ingredientId)).toEqual(['i1', 'i2', 'i3', 'i5']);
    expect(rows.map((row) => row.name)).toEqual([
      'Arroz',
      'Pechuga de pollo',
      'Tomate',
      'Aceite de oliva',
    ]);
    expect(rows.map((row) => row.quantityLabel)).toEqual(['100 g', '200 g', '2 u', '10 ml']);
    expect(rows.map((row) => row.unit)).toEqual(['g', 'g', 'unit', 'ml']);
  });

  it('prints a large or fractional quantity as the rest of the app does', () => {
    const rows = resolveRecipeIngredients({
      lines: [
        line({ ingredientId: 'i1', quantityMilli: 1500000 }),
        line({ ingredientId: 'i3', quantityMilli: 500, unit: 'unit' }),
      ],
      catalog: CATALOG,
      inventory: [],
    });

    expect(rows.map((row) => row.quantityLabel)).toEqual(['1,5 kg', '0,5 u']);
    expect(rows.map((row) => row.requiredAmount)).toEqual([1500, 0.5]);
  });

  it('marks an ingredient in stock when the inventory covers the recipe amount', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantityMilli: 500_000 }]);

    expect(rice).toEqual({
      ingredientId: 'i1',
      name: 'Arroz',
      quantityLabel: '100 g',
      requiredAmount: 100,
      availableAmount: 500,
      missingAmount: 0,
      unit: 'g',
      status: 'in_stock',
    });
  });

  it('treats an inventory amount equal to the recipe amount as in stock', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantityMilli: 100_000 }]);

    expect(rice.status).toBe('in_stock');
    expect(rice.missingAmount).toBe(0);
  });

  it('marks an ingredient missing when the inventory falls short', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantityMilli: 99_000 }]);

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
      { ingredientId: 'i1', quantityMilli: 60_000 },
      { ingredientId: 'i1', quantityMilli: 40_000, isLeftover: true },
    ]);

    expect(rice.availableAmount).toBe(100);
    expect(rice.status).toBe('in_stock');
  });

  it('reads a fraction of a unit from its thousandths', () => {
    const tomato = resolve([{ ingredientId: 'i3', quantityMilli: 1_500 }])[2];

    expect(tomato.availableAmount).toBe(1.5);
    expect(tomato.missingAmount).toBe(0.5);
    expect(tomato.status).toBe('missing');
  });

  it('ignores an inventory item that is not linked to the ingredient catalog', () => {
    const [rice] = resolve([
      { ingredientId: 'i1', quantityMilli: 60_000 },
      { quantityMilli: 500_000 },
    ]);

    expect(rice.availableAmount).toBe(60);
    expect(rice.missingAmount).toBe(40);
    expect(rice.status).toBe('missing');
  });

  it('counts no stock when no inventory item is linked to the ingredient catalog', () => {
    const rows = resolve([{ quantityMilli: 500_000 }, { quantityMilli: 3_000, isLeftover: true }]);

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
    const rows = resolve([{ ingredientId: 'i1', quantityMilli: 99_000 }], ['i1', 'i3', 'i5']);

    expect(rows.map((row) => row.status)).toEqual(['listed', 'missing', 'listed', 'listed']);
  });

  it('keeps an ingredient in stock even when the shopping list has it', () => {
    const [rice] = resolve([{ ingredientId: 'i1', quantityMilli: 500_000 }], ['i1']);

    expect(rice.status).toBe('in_stock');
  });

  it('shows a line outside the catalog with its name and quantity, never as stock', () => {
    const [unknown] = resolveRecipeIngredients({
      lines: [line({ ingredientId: 'ghost', name: 'Papa', quantityMilli: 500000 })],
      catalog: CATALOG,
      inventory: [{ ingredientId: 'ghost', quantityMilli: 900_000 }],
    });

    expect(unknown).toEqual({
      ingredientId: 'ghost',
      name: 'Papa',
      quantityLabel: '500 g',
      requiredAmount: 500,
      availableAmount: 900,
      missingAmount: 0,
      unit: null,
      status: 'missing',
    });
  });

  it('does not compare a line with a catalog ingredient that is counted in another unit', () => {
    const [rice] = resolveRecipeIngredients({
      lines: [line({ ingredientId: 'i1', quantityMilli: 2000, unit: 'unit' })],
      catalog: CATALOG,
      inventory: [{ ingredientId: 'i1', quantityMilli: 500_000 }],
      listedIngredientIds: ['i1'],
    });

    expect(rice).toMatchObject({ quantityLabel: '2 u', unit: null, status: 'missing' });
  });

  it('never marks an unknown ingredient as listed, even when its id is given as listed', () => {
    const [unknown] = resolveRecipeIngredients({
      lines: [line({ ingredientId: 'ghost' })],
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
        { ingredientId: 'i1', quantityMilli: 500_000 },
        { ingredientId: 'i5', quantityMilli: 250_000 },
      ],
      ['i3']
    );

    expect(countMissing(rows)).toBe(2);
  });

  it('counts nothing when everything is in stock', () => {
    const rows = resolve(
      LINES.map(({ ingredientId, quantityMilli }) => ({ ingredientId, quantityMilli }))
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
