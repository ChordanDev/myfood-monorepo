import { COOKING_FINISH_COVERED, COOKING_FINISH_WITH_SHORTAGE } from '../fixtures';
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
  it('adds the lots of one ingredient into a single consumed line', () => {
    const summary = summarizeCookingFinish(COOKING_FINISH_WITH_SHORTAGE);

    expect(summary.recipeName).toBe('Arroz con aceite');
    expect(summary.consumed).toEqual([
      { ingredientId: expect.any(String), name: 'Arroz', quantity: '200 g', lots: 2 },
      { ingredientId: expect.any(String), name: 'Aceite de oliva', quantity: '15 ml', lots: 1 },
    ]);
  });

  it('lists what the stock could not cover', () => {
    const summary = summarizeCookingFinish(COOKING_FINISH_WITH_SHORTAGE);

    expect(summary.shortages).toEqual([
      { ingredientId: expect.any(String), name: 'Sal', missing: '5 g' },
    ]);
  });

  it('has no shortage when the stock covered everything', () => {
    expect(summarizeCookingFinish(COOKING_FINISH_COVERED).shortages).toEqual([]);
  });
});
