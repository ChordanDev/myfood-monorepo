import {
  buildRecipeFacts,
  formatCostCents,
  formatDurationMinutes,
  formatQuantityMilli,
  formatServings,
} from './recipeFormat';

describe('formatQuantityMilli', () => {
  it.each([
    [500000, 'g', '500 g'],
    [60000, 'ml', '60 ml'],
    [4000, 'unit', '4 u'],
  ] as const)('prints %d thousandths of %s as %s', (quantityMilli, unit, expected) => {
    expect(formatQuantityMilli(quantityMilli, unit)).toBe(expected);
  });

  it('promotes grams to kilograms and millilitres to litres from a thousand up', () => {
    expect(formatQuantityMilli(999000, 'g')).toBe('999 g');
    expect(formatQuantityMilli(1000000, 'g')).toBe('1 kg');
    expect(formatQuantityMilli(1500000, 'g')).toBe('1,5 kg');
    expect(formatQuantityMilli(2250000, 'ml')).toBe('2,25 L');
  });

  it('never promotes whole units', () => {
    expect(formatQuantityMilli(1200000, 'unit')).toBe('1200 u');
  });

  it('writes decimals with a comma, up to two, without trailing zeros', () => {
    expect(formatQuantityMilli(500, 'unit')).toBe('0,5 u');
    expect(formatQuantityMilli(2250, 'g')).toBe('2,25 g');
    expect(formatQuantityMilli(1234, 'ml')).toBe('1,23 ml');
    expect(formatQuantityMilli(3000, 'ml')).toBe('3 ml');
  });
});

describe('formatCostCents', () => {
  it('prints whole pesos with a dot every three digits', () => {
    expect(formatCostCents(385000)).toBe('$3.850');
    expect(formatCostCents(1550)).toBe('$16');
    expect(formatCostCents(123456789)).toBe('$1.234.568');
  });

  it('has nothing to print when no cost is known', () => {
    expect(formatCostCents(0)).toBeNull();
  });

  it('does not print a cost that rounds to zero pesos', () => {
    expect(formatCostCents(40)).toBeNull();
  });
});

describe('formatServings', () => {
  it('counts the servings, with a singular for one', () => {
    expect(formatServings(4)).toBe('4 porciones');
    expect(formatServings(1)).toBe('1 porción');
  });

  it('has nothing to print when the servings are unknown', () => {
    expect(formatServings(null)).toBeNull();
    expect(formatServings(0)).toBeNull();
  });
});

describe('formatDurationMinutes', () => {
  it('prints plain minutes, also from an hour up', () => {
    expect(formatDurationMinutes(40)).toBe('40 min');
    expect(formatDurationMinutes(90)).toBe('90 min');
  });

  it('has nothing to print when the duration is unknown', () => {
    expect(formatDurationMinutes(null)).toBeNull();
    expect(formatDurationMinutes(0)).toBeNull();
  });
});

describe('buildRecipeFacts', () => {
  it('lists the servings, the duration and the cost, in that order', () => {
    expect(
      buildRecipeFacts({ servings: 4, durationMinutes: 40, estimatedCostCents: 385000 })
    ).toEqual([
      { id: 'servings', label: 'Rinde', value: '4 porciones' },
      { id: 'duration', label: 'Tiempo', value: '40 min' },
      { id: 'cost', label: 'Costo estimado', value: '$3.850' },
    ]);
  });

  it('leaves out what is not known', () => {
    expect(
      buildRecipeFacts({ servings: null, durationMinutes: 25, estimatedCostCents: 0 })
    ).toEqual([{ id: 'duration', label: 'Tiempo', value: '25 min' }]);
  });

  it('lists nothing for a recipe that knows none of them', () => {
    expect(
      buildRecipeFacts({ servings: null, durationMinutes: null, estimatedCostCents: 0 })
    ).toEqual([]);
  });
});
