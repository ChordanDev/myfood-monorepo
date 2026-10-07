import type { Ingredient, MealPlanEntry, RecipeIngredient } from '@/types/domain';
import type { ManualShoppingListItem, ShoppingListInput, ShoppingListItem } from '../types';
import {
  deriveFullShoppingList,
  deriveShoppingList,
  getCartItems,
  getDefaultUntilDate,
  getPlannedItemId,
  getShoppingCounters,
} from './shoppingList';

const MILK: Ingredient = {
  id: 'milk',
  name: 'Leche entera',
  category: 'lacteos',
  basePrice: 1800,
  unit: 'ml',
};

const TOMATO: Ingredient = {
  id: 'tomato',
  name: 'Tomate',
  category: 'verduras',
  basePrice: 500,
  unit: 'unit',
};

function buildEntry(id: string, date: string, recipeId: string, isCooked = false): MealPlanEntry {
  return { id, date, type: 'almuerzo', recipeId, isCooked };
}

function buildRecipe(id: string, ingredients: RecipeIngredient[]) {
  return { id, ingredients };
}

function buildManualItem(
  id: string,
  name: string,
  status: ManualShoppingListItem['status'] = 'needed'
): ManualShoppingListItem {
  return { id, source: 'manual', status, name };
}

// One flan (500 ml of milk) planned for the 10th, unless overridden.
function buildInput(overrides: Partial<ShoppingListInput> = {}): ShoppingListInput {
  return {
    entries: [buildEntry('e1', '2026-10-10', 'flan')],
    recipes: [buildRecipe('flan', [{ ingredientId: 'milk', amount: 500 }])],
    ingredients: [MILK, TOMATO],
    inventory: [],
    cartIds: [],
    removedIds: [],
    manualItems: [],
    ...overrides,
  };
}

// Planned rows as [id, amountToBuy, status].
function summarize(items: ShoppingListItem[]) {
  return items.flatMap((item) =>
    item.source === 'planned_meal' ? [[item.id, item.amountToBuy, item.status]] : []
  );
}

describe('deriveShoppingList', () => {
  it('lists the ingredients of an uncooked planned meal as needed items', () => {
    expect(deriveShoppingList(buildInput())).toEqual([
      {
        id: 'planned:milk',
        source: 'planned_meal',
        status: 'needed',
        name: 'Leche entera',
        ingredientId: 'milk',
        amountToBuy: 500,
        unit: 'ml',
        category: 'lacteos',
      },
    ]);
  });

  it('ignores meals that are already cooked', () => {
    const items = deriveShoppingList(
      buildInput({ entries: [buildEntry('e1', '2026-10-10', 'flan', true)] })
    );

    expect(items).toEqual([]);
  });

  it('counts meals up to the until date, that day included', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [
          buildEntry('e1', '2026-10-10', 'flan'),
          buildEntry('e2', '2026-10-12', 'flan'),
          buildEntry('e3', '2026-10-13', 'salad'),
        ],
        recipes: [
          buildRecipe('flan', [{ ingredientId: 'milk', amount: 500 }]),
          buildRecipe('salad', [{ ingredientId: 'tomato', amount: 2 }]),
        ],
        untilDate: '2026-10-12',
      })
    );

    expect(summarize(items)).toEqual([['planned:milk', 1000, 'needed']]);
  });

  it('aggregates an ingredient repeated across recipes and days into one item', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [
          buildEntry('e1', '2026-10-10', 'flan'),
          buildEntry('e2', '2026-10-11', 'salad'),
          buildEntry('e3', '2026-10-12', 'flan'),
        ],
        recipes: [
          buildRecipe('flan', [{ ingredientId: 'milk', amount: 500 }]),
          buildRecipe('salad', [
            { ingredientId: 'tomato', amount: 2 },
            { ingredientId: 'milk', amount: 100 },
          ]),
        ],
      })
    );

    expect(summarize(items)).toEqual([
      ['planned:milk', 1100, 'needed'],
      ['planned:tomato', 2, 'needed'],
    ]);
  });

  it('asks only for the shortfall the inventory does not cover', () => {
    const items = deriveShoppingList(
      buildInput({ inventory: [{ ingredientId: 'milk', quantity: 200 }] })
    );

    expect(summarize(items)).toEqual([['planned:milk', 300, 'needed']]);
  });

  it('does not list an ingredient the inventory fully covers', () => {
    const items = deriveShoppingList(
      buildInput({ inventory: [{ ingredientId: 'milk', quantity: 500 }] })
    );

    expect(items).toEqual([]);
  });

  it('asks for the whole amount of an ingredient that ran out, kept in the inventory at zero', () => {
    const items = deriveShoppingList(
      buildInput({ inventory: [{ ingredientId: 'milk', quantity: 0 }] })
    );

    expect(summarize(items)).toEqual([['planned:milk', 500, 'needed']]);
  });

  it('does not count an inventory item that is not linked to an ingredient as stock', () => {
    const items = deriveShoppingList(buildInput({ inventory: [{ quantity: 1000 }] }));

    expect(summarize(items)).toEqual([['planned:milk', 500, 'needed']]);
  });

  it('adds up the inventory items linked to the same ingredient', () => {
    const items = deriveShoppingList(
      buildInput({
        inventory: [
          { ingredientId: 'milk', quantity: 200 },
          { ingredientId: 'milk', quantity: 0 },
          { ingredientId: 'milk', quantity: 100 },
        ],
      })
    );

    expect(summarize(items)).toEqual([['planned:milk', 200, 'needed']]);
  });

  it('does not list a floating point residue as a shortfall', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [buildEntry('e1', '2026-10-10', 'a'), buildEntry('e2', '2026-10-11', 'b')],
        recipes: [
          buildRecipe('a', [{ ingredientId: 'tomato', amount: 0.1 }]),
          buildRecipe('b', [{ ingredientId: 'tomato', amount: 0.2 }]),
        ],
        inventory: [{ ingredientId: 'tomato', quantity: 0.3 }],
      })
    );

    expect(items).toEqual([]);
  });

  it('lists a row that was put in the cart as in the cart, for the same amount', () => {
    const items = deriveShoppingList(buildInput({ cartIds: ['planned:milk'] }));

    expect(summarize(items)).toEqual([['planned:milk', 500, 'in_cart']]);
  });

  it('keeps the other rows needed while one of them is in the cart', () => {
    const items = deriveShoppingList(
      buildInput({
        recipes: [
          buildRecipe('flan', [
            { ingredientId: 'milk', amount: 500 },
            { ingredientId: 'tomato', amount: 2 },
          ]),
        ],
        cartIds: ['planned:tomato'],
      })
    );

    expect(summarize(items)).toEqual([
      ['planned:milk', 500, 'needed'],
      ['planned:tomato', 2, 'in_cart'],
    ]);
  });

  it('follows the shortfall of a row in the cart when the stock or the plan changes', () => {
    const items = deriveShoppingList(
      buildInput({
        recipes: [buildRecipe('flan', [{ ingredientId: 'milk', amount: 800 }])],
        inventory: [{ ingredientId: 'milk', quantity: 300 }],
        cartIds: ['planned:milk'],
      })
    );

    expect(summarize(items)).toEqual([['planned:milk', 500, 'in_cart']]);
  });

  it.each([
    ['the stock covers the plan', { inventory: [{ ingredientId: 'milk', quantity: 500 }] }],
    ['its meal was cooked', { entries: [buildEntry('e1', '2026-10-10', 'flan', true)] }],
    [
      'its meal falls after the until date',
      { entries: [buildEntry('e1', '2026-10-13', 'flan')], untilDate: '2026-10-12' },
    ],
  ])('does not list a row in the cart once %s', (_case, overrides) => {
    const items = deriveShoppingList(buildInput({ ...overrides, cartIds: ['planned:milk'] }));

    expect(items).toEqual([]);
  });

  it('does not list a shortfall that rounds to nothing at display precision', () => {
    const items = deriveShoppingList(
      buildInput({
        recipes: [buildRecipe('flan', [{ ingredientId: 'milk', amount: 500.004 }])],
        inventory: [{ ingredientId: 'milk', quantity: 500 }],
      })
    );

    expect(items).toEqual([]);
  });

  it('keeps removed items in the output, flagged as removed', () => {
    const items = deriveShoppingList(buildInput({ removedIds: ['planned:milk'] }));

    expect(summarize(items)).toEqual([['planned:milk', 500, 'removed']]);
  });

  it('flags a removed item as removed even when its id is in the cart', () => {
    const items = deriveShoppingList(
      buildInput({ cartIds: ['planned:milk'], removedIds: ['planned:milk'] })
    );

    expect(summarize(items)).toEqual([['planned:milk', 500, 'removed']]);
  });

  it('passes manual items through after the planned ones, with their own status', () => {
    const paper = buildManualItem('manual-1', 'Papel de cocina');
    const soap = buildManualItem('manual-2', 'Jabón', 'in_cart');

    const items = deriveShoppingList(buildInput({ manualItems: [paper, soap] }));

    expect(items.slice(1)).toEqual([paper, soap]);
  });

  it('never merges a manual item with a planned one, even with the same name', () => {
    const items = deriveShoppingList(
      buildInput({ manualItems: [buildManualItem('manual-1', 'Leche entera')] })
    );

    expect(items.map((item) => [item.id, item.source])).toEqual([
      ['planned:milk', 'planned_meal'],
      ['manual-1', 'manual'],
    ]);
  });

  it('skips unknown recipes and unknown ingredients instead of throwing', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [buildEntry('e1', '2026-10-10', 'ghost'), buildEntry('e2', '2026-10-11', 'flan')],
        recipes: [
          buildRecipe('flan', [
            { ingredientId: 'unknown', amount: 3 },
            { ingredientId: 'milk', amount: 500 },
          ]),
        ],
      })
    );

    expect(summarize(items)).toEqual([['planned:milk', 500, 'needed']]);
  });
});

describe('getPlannedItemId', () => {
  it('derives a stable item id from the ingredient id', () => {
    expect(getPlannedItemId('milk')).toBe('planned:milk');
  });
});

describe('getDefaultUntilDate', () => {
  it('returns the latest date of the plan', () => {
    const entries = [
      buildEntry('e1', '2026-10-12', 'flan'),
      buildEntry('e2', '2026-11-02', 'flan'),
      buildEntry('e3', '2026-10-30', 'flan'),
    ];

    expect(getDefaultUntilDate(entries)).toBe('2026-11-02');
  });

  it('returns undefined for an empty plan', () => {
    expect(getDefaultUntilDate([])).toBeUndefined();
  });
});

describe('deriveFullShoppingList', () => {
  it('derives the list from every planned meal, up to the last one', () => {
    const { untilDate: _untilDate, ...sources } = buildInput({
      entries: [
        buildEntry('e1', '2026-10-10', 'flan'),
        buildEntry('e2', '2026-11-02', 'salad'),
        buildEntry('e3', '2026-10-30', 'flan'),
      ],
      recipes: [
        buildRecipe('flan', [{ ingredientId: 'milk', amount: 500 }]),
        buildRecipe('salad', [{ ingredientId: 'tomato', amount: 3 }]),
      ],
      manualItems: [buildManualItem('manual:1', 'Servilletas')],
    });

    const items = deriveFullShoppingList(sources);

    expect(summarize(items)).toEqual([
      ['planned:milk', 1000, 'needed'],
      ['planned:tomato', 3, 'needed'],
    ]);
    expect(items).toEqual(deriveShoppingList({ ...sources, untilDate: '2026-11-02' }));
    expect(items[2]).toEqual(buildManualItem('manual:1', 'Servilletas'));
  });
});

describe('getShoppingCounters', () => {
  it('counts the listed rows, the ones in the cart among them, and the removed ones apart', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [buildEntry('e1', '2026-10-10', 'flan'), buildEntry('e2', '2026-10-11', 'salad')],
        recipes: [
          buildRecipe('flan', [{ ingredientId: 'milk', amount: 500 }]),
          buildRecipe('salad', [{ ingredientId: 'tomato', amount: 2 }]),
        ],
        cartIds: ['planned:milk'],
        removedIds: ['planned:tomato'],
        manualItems: [
          buildManualItem('manual-1', 'Papel de cocina'),
          buildManualItem('manual-2', 'Jabón', 'in_cart'),
          buildManualItem('manual-3', 'Velas', 'removed'),
        ],
      })
    );

    expect(getShoppingCounters(items)).toEqual({ total: 3, inCart: 2, removed: 2 });
  });

  it('does not count an id in the cart whose row no longer exists', () => {
    const items = deriveShoppingList(
      buildInput({
        inventory: [{ ingredientId: 'milk', quantity: 500 }],
        cartIds: ['planned:milk', 'planned:ghost'],
      })
    );

    expect(getShoppingCounters(items)).toEqual({ total: 0, inCart: 0, removed: 0 });
  });
});

describe('getCartItems', () => {
  it('returns the planned and the manual rows in the cart, in list order', () => {
    const soap = buildManualItem('manual-2', 'Jabón', 'in_cart');
    const items = deriveShoppingList(
      buildInput({
        recipes: [
          buildRecipe('flan', [
            { ingredientId: 'milk', amount: 500 },
            { ingredientId: 'tomato', amount: 2 },
          ]),
        ],
        cartIds: ['planned:tomato'],
        manualItems: [buildManualItem('manual-1', 'Papel de cocina'), soap],
      })
    );

    expect(getCartItems(items).map((item) => item.id)).toEqual(['planned:tomato', 'manual-2']);
  });

  it('leaves out a removed row, even with its id still in the cart', () => {
    const items = deriveShoppingList(
      buildInput({
        cartIds: ['planned:milk'],
        removedIds: ['planned:milk'],
        manualItems: [buildManualItem('manual-3', 'Velas', 'removed')],
      })
    );

    expect(getCartItems(items)).toEqual([]);
  });
});
