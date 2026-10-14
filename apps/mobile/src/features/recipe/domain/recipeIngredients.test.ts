import { POTATO } from '@/features/inventory/mocks/inventoryApiFixtures';
import type { UnitType } from '@/types/domain';
import { fixtureRecipe } from '../fixtures/recipeDetail';
import type { RecipeIngredientLine } from '../types/recipe';
import { countMissing, formatMissingSummary, resolveRecipeIngredients } from './recipeIngredients';

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
type StockItem = {
  ingredientId: string;
  unit: UnitType;
  quantityMilli: number;
  isLeftover?: boolean;
};

function lot(ingredientId: string, quantityMilli: number, unit: UnitType = 'g'): StockItem {
  return { ingredientId, unit, quantityMilli };
}

function resolve(inventory: StockItem[], listedIngredientIds?: string[]) {
  return resolveRecipeIngredients({ lines: LINES, inventory, listedIngredientIds });
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
      inventory: [],
    });

    expect(rows.map((row) => row.quantityLabel)).toEqual(['1,5 kg', '0,5 u']);
    expect(rows.map((row) => row.requiredAmount)).toEqual([1500, 0.5]);
  });

  it('marks an ingredient in stock when the inventory covers the recipe amount', () => {
    const [rice] = resolve([lot('i1', 500_000)]);

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
    const [rice] = resolve([lot('i1', 100_000)]);

    expect(rice.status).toBe('in_stock');
    expect(rice.missingAmount).toBe(0);
  });

  it('marks an ingredient missing when the inventory falls short', () => {
    const [rice] = resolve([lot('i1', 99_000)]);

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

  it('shows a line with no lot with its name, quantity and own unit, as missing', () => {
    const [papa] = resolveRecipeIngredients({
      lines: [line({ ingredientId: 'ghost', name: 'Papa', quantityMilli: 500000 })],
      inventory: [lot('i1', 900_000)],
    });

    expect(papa).toEqual({
      ingredientId: 'ghost',
      name: 'Papa',
      quantityLabel: '500 g',
      requiredAmount: 500,
      availableAmount: 0,
      missingAmount: 500,
      unit: 'g',
      status: 'missing',
    });
  });

  it('sums every inventory item of the same ingredient', () => {
    const [rice] = resolve([lot('i1', 60_000), { ...lot('i1', 40_000), isLeftover: true }]);

    expect(rice.availableAmount).toBe(100);
    expect(rice.status).toBe('in_stock');
  });

  it('does not compare a line with lots of its ingredient that are counted in another unit', () => {
    const [rice] = resolveRecipeIngredients({
      lines: [line({ ingredientId: 'i1', quantityMilli: 2000, unit: 'unit' })],
      inventory: [lot('i1', 500_000, 'g')],
      listedIngredientIds: [],
    });

    expect(rice).toMatchObject({
      quantityLabel: '2 u',
      unit: 'unit',
      availableAmount: 0,
      missingAmount: 2,
      status: 'missing',
    });
  });

  it('adds nothing from a lot in another unit to the lots in the unit of the line', () => {
    const [rice] = resolve([lot('i1', 60_000, 'g'), lot('i1', 500_000, 'ml')]);

    expect(rice.availableAmount).toBe(60);
    expect(rice.missingAmount).toBe(40);
    expect(rice.status).toBe('missing');
  });

  it('reads a fraction of a unit from its thousandths', () => {
    const tomato = resolve([lot('i3', 1_500, 'unit')])[2];

    expect(tomato.availableAmount).toBe(1.5);
    expect(tomato.missingAmount).toBe(0.5);
    expect(tomato.status).toBe('missing');
  });

  it('marks a short ingredient as listed when it is already on the shopping list', () => {
    const rows = resolve([], ['i2']);

    expect(rows[1].status).toBe('listed');
    expect(rows[1].missingAmount).toBe(200);
    expect(rows[0].status).toBe('missing');
  });

  it('marks every short ingredient the shopping list covers as listed', () => {
    const rows = resolve([lot('i1', 99_000)], ['i1', 'i3', 'i5']);

    expect(rows.map((row) => row.status)).toEqual(['listed', 'missing', 'listed', 'listed']);
  });

  it('keeps an ingredient in stock even when the shopping list has it', () => {
    const [rice] = resolve([lot('i1', 500_000)], ['i1']);

    expect(rice.status).toBe('in_stock');
  });

  it('marks a short line as listed from its id alone, whatever the inventory holds', () => {
    const [rice] = resolveRecipeIngredients({
      lines: [line({ ingredientId: 'i1', quantityMilli: 2000, unit: 'unit' })],
      inventory: [lot('i1', 500_000, 'g')],
      listedIngredientIds: ['i1'],
    });

    expect(rice).toMatchObject({ unit: 'unit', status: 'listed' });
  });

  it('reads the Recipe and the Inventory of the API fixtures: only the potato is in stock', () => {
    const rows = resolveRecipeIngredients({
      lines: fixtureRecipe().ingredients,
      inventory: [POTATO],
    });

    expect(rows.map((row) => [row.name, row.status])).toEqual([
      ['Papa', 'in_stock'],
      ['Aceite de girasol', 'missing'],
      ['Huevo', 'missing'],
      ['Cebolla', 'missing'],
    ]);
    expect(rows[0]).toMatchObject({ availableAmount: 800, missingAmount: 0, unit: 'g' });
  });

  it('returns no rows for a recipe without ingredients', () => {
    expect(resolveRecipeIngredients({ lines: [], inventory: [] })).toEqual([]);
  });
});

describe('countMissing', () => {
  it('counts every row that is not in stock, listed ones included', () => {
    const rows = resolve([lot('i1', 500_000), lot('i5', 250_000, 'ml')], ['i3']);

    expect(countMissing(rows)).toBe(2);
  });

  it('counts nothing when everything is in stock', () => {
    const rows = resolve(
      LINES.map(({ ingredientId, quantityMilli, unit }) => ({ ingredientId, quantityMilli, unit }))
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
