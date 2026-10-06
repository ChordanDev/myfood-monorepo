import type { Ingredient, MealPlanEntry, RecipeIngredient } from '@/types/domain';
import type { ManualShoppingListItem, ShoppingListInput, ShoppingListItem } from '../types';
import {
  deriveShoppingList,
  getDefaultUntilDate,
  getPlannedItemId,
  getShoppingCounters,
} from './shoppingList';

const MILK: Ingredient = {
  id: 'milk',
  name: 'Leche entera',
  category: 'lacteos',
  basePrice: 1800,
  unit: 'mililitros',
};

const TOMATO: Ingredient = {
  id: 'tomato',
  name: 'Tomate',
  category: 'verduras',
  basePrice: 500,
  unit: 'unidades',
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
    purchases: {},
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
        unit: 'mililitros',
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
      buildInput({ inventory: [{ ingredientId: 'milk', amount: 200 }] })
    );

    expect(summarize(items)).toEqual([['planned:milk', 300, 'needed']]);
  });

  it('does not list an ingredient the inventory fully covers', () => {
    const items = deriveShoppingList(
      buildInput({ inventory: [{ ingredientId: 'milk', amount: 500 }] })
    );

    expect(items).toEqual([]);
  });

  it('does not list a floating point residue as a shortfall', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [buildEntry('e1', '2026-10-10', 'a'), buildEntry('e2', '2026-10-11', 'b')],
        recipes: [
          buildRecipe('a', [{ ingredientId: 'tomato', amount: 0.1 }]),
          buildRecipe('b', [{ ingredientId: 'tomato', amount: 0.2 }]),
        ],
        inventory: [{ ingredientId: 'tomato', amount: 0.3 }],
      })
    );

    expect(items).toEqual([]);
  });

  it('keeps a purchased item with its amount once the purchase is in the inventory', () => {
    // 200 ml were in stock, the missing 300 ml were bought and added to the inventory.
    const items = deriveShoppingList(
      buildInput({
        inventory: [{ ingredientId: 'milk', amount: 500 }],
        purchases: { 'planned:milk': 300 },
      })
    );

    expect(summarize(items)).toEqual([['planned:milk', 300, 'purchased']]);
  });

  it.each([
    ['needs the rest when the plan outgrew the purchase', 800, 500, 300, 'needed'],
    ['needs it all again when the stock no longer backs the record', 500, 0, 500, 'needed'],
    ['stays purchased after one of its meals was cooked', 250, 250, 500, 'purchased'],
    ['stays purchased when the stock covers the plan exactly', 500, 500, 500, 'purchased'],
  ])('with a 500 ml purchase record, %s', (_case, planned, stock, amountToBuy, status) => {
    const items = deriveShoppingList(
      buildInput({
        recipes: [buildRecipe('flan', [{ ingredientId: 'milk', amount: planned }])],
        inventory: [{ ingredientId: 'milk', amount: stock }],
        purchases: { 'planned:milk': 500 },
      })
    );

    expect(summarize(items)).toEqual([['planned:milk', amountToBuy, status]]);
  });

  it('does not list a shortfall that rounds to nothing at display precision', () => {
    const items = deriveShoppingList(
      buildInput({
        recipes: [buildRecipe('flan', [{ ingredientId: 'milk', amount: 500.004 }])],
        inventory: [{ ingredientId: 'milk', amount: 500 }],
      })
    );

    expect(items).toEqual([]);
  });

  it('drops a purchase whose meal falls after the until date', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [buildEntry('e1', '2026-10-13', 'flan')],
        inventory: [{ ingredientId: 'milk', amount: 500 }],
        purchases: { 'planned:milk': 500 },
        untilDate: '2026-10-12',
      })
    );

    expect(items).toEqual([]);
  });

  it('drops a purchase whose ingredient no uncooked meal needs anymore', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [buildEntry('e1', '2026-10-10', 'flan', true)],
        purchases: { 'planned:milk': 300 },
      })
    );

    expect(items).toEqual([]);
  });

  it('keeps removed items in the output, flagged as removed', () => {
    const items = deriveShoppingList(buildInput({ removedIds: ['planned:milk'] }));

    expect(summarize(items)).toEqual([['planned:milk', 500, 'removed']]);
  });

  it('flags a removed item as removed even when it was purchased', () => {
    const items = deriveShoppingList(
      buildInput({
        inventory: [{ ingredientId: 'milk', amount: 500 }],
        purchases: { 'planned:milk': 500 },
        removedIds: ['planned:milk'],
      })
    );

    expect(summarize(items)).toEqual([['planned:milk', 500, 'removed']]);
  });

  it('passes manual items through after the planned ones, with their own status', () => {
    const paper = buildManualItem('manual-1', 'Papel de cocina');
    const soap = buildManualItem('manual-2', 'Jabón', 'purchased');

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

describe('getShoppingCounters', () => {
  it('counts total and purchased over the non-removed items, and the removed ones apart', () => {
    const items = deriveShoppingList(
      buildInput({
        entries: [buildEntry('e1', '2026-10-10', 'flan'), buildEntry('e2', '2026-10-11', 'salad')],
        recipes: [
          buildRecipe('flan', [{ ingredientId: 'milk', amount: 500 }]),
          buildRecipe('salad', [{ ingredientId: 'tomato', amount: 2 }]),
        ],
        // The milk was bought, so it is in stock.
        inventory: [{ ingredientId: 'milk', amount: 500 }],
        purchases: { 'planned:milk': 500 },
        removedIds: ['planned:tomato'],
        manualItems: [
          buildManualItem('manual-1', 'Papel de cocina'),
          buildManualItem('manual-2', 'Jabón', 'purchased'),
          buildManualItem('manual-3', 'Velas', 'removed'),
        ],
      })
    );

    expect(getShoppingCounters(items)).toEqual({ total: 3, purchased: 2, removed: 2 });
  });
});
