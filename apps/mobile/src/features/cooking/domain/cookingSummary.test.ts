import {
  COOKING_FINISH_COVERED,
  COOKING_FINISH_WITH_SHORTAGE,
  COOKING_SCHEDULED_MEAL_ID,
} from '../fixtures';
import { formatMilliQuantity, summarizeCookingFinish } from './cookingSummary';

describe('formatMilliQuantity', () => {
  it.each([
    [200000, 'g', '200 g'],
    [15000, 'ml', '15 ml'],
    [2000, 'unit', '2 u'],
    [1500, 'g', '1,5 g'],
    [333, 'g', '0,33 g'],
  ] as const)('writes %s milli of %s as %s', (milli, unit, expected) => {
    expect(formatMilliQuantity(milli, unit)).toBe(expected);
  });
});

describe('summarizeCookingFinish', () => {
  it('carries the Scheduled meal the finish belongs to', () => {
    const summary = summarizeCookingFinish(COOKING_FINISH_WITH_SHORTAGE);

    expect(summary.scheduledMealId).toBe(COOKING_SCHEDULED_MEAL_ID);
  });

  it('adds the lots of one ingredient into a single consumed line', () => {
    const summary = summarizeCookingFinish(COOKING_FINISH_WITH_SHORTAGE);

    expect(summary.recipeName).toBe('Arroz con aceite');
    expect(summary.consumed).toEqual([
      { ingredientId: expect.any(String), name: 'Arroz', unit: 'g', quantity: '200 g', lots: 2 },
      {
        ingredientId: expect.any(String),
        name: 'Aceite de oliva',
        unit: 'ml',
        quantity: '15 ml',
        lots: 1,
      },
    ]);
  });

  it('keeps the units of one ingredient in separate consumed lines', () => {
    const [lot] = COOKING_FINISH_WITH_SHORTAGE.inventoryMutations;
    const summary = summarizeCookingFinish({
      ...COOKING_FINISH_WITH_SHORTAGE,
      inventoryMutations: [
        { ...lot, unit: 'g', quantityDeltaMilli: -100000 },
        { ...lot, unit: 'unit', quantityDeltaMilli: -2000 },
        { ...lot, unit: 'g', quantityDeltaMilli: -50000 },
      ],
    });

    expect(summary.consumed).toEqual([
      { ingredientId: lot.ingredientId, name: 'Arroz', unit: 'g', quantity: '150 g', lots: 2 },
      { ingredientId: lot.ingredientId, name: 'Arroz', unit: 'unit', quantity: '2 u', lots: 1 },
    ]);
  });

  it('lists what the stock could not cover', () => {
    const summary = summarizeCookingFinish(COOKING_FINISH_WITH_SHORTAGE);

    expect(summary.shortages).toEqual([
      { ingredientId: expect.any(String), name: 'Sal', unit: 'g', missing: '5 g' },
    ]);
  });

  it('has no shortage when the stock covered everything', () => {
    expect(summarizeCookingFinish(COOKING_FINISH_COVERED).shortages).toEqual([]);
  });
});
