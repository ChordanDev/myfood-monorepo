import { formatQuantity, roundQuantity } from '../formatQuantity';

describe('formatQuantity', () => {
  it.each([
    [300, 'g', '300 g'],
    [999, 'g', '999 g'],
    [250, 'ml', '250 ml'],
    [500, 'ml', '500 ml'],
    [2, 'unit', '2 u'],
    [3, 'unit', '3 u'],
    [0, 'g', '0 g'],
  ] as const)('shows %p %s as "%s"', (quantity, unit, expected) => {
    expect(formatQuantity(quantity, unit)).toBe(expected);
  });

  it.each([
    [1000, 'g', '1 kg'],
    [1500, 'g', '1,5 kg'],
    [1000, 'ml', '1 L'],
    [1500, 'ml', '1,5 L'],
    [2250, 'ml', '2,25 L'],
  ] as const)('switches %p %s to the larger unit as "%s"', (quantity, unit, expected) => {
    expect(formatQuantity(quantity, unit)).toBe(expected);
  });

  it('keeps units as units however many there are', () => {
    expect(formatQuantity(1200, 'unit')).toBe('1200 u');
    expect(formatQuantity(1500, 'unit')).toBe('1500 u');
  });

  it('uses a comma as the decimal separator', () => {
    expect(formatQuantity(2.5, 'unit')).toBe('2,5 u');
    expect(formatQuantity(0.5, 'unit')).toBe('0,5 u');
  });

  it('rounds to two decimals at most', () => {
    expect(formatQuantity(1234, 'g')).toBe('1,23 kg');
    expect(formatQuantity(0.456, 'ml')).toBe('0,46 ml');
  });

  it('trims trailing zeros', () => {
    expect(formatQuantity(1.5, 'g')).toBe('1,5 g');
    expect(formatQuantity(2000, 'ml')).toBe('2 L');
  });

  it('switches to the larger unit when rounding reaches a thousand', () => {
    expect(formatQuantity(999.999, 'g')).toBe('1 kg');
  });
});

describe('roundQuantity', () => {
  it('rounds to the two decimals a quantity is displayed with', () => {
    expect(roundQuantity(0.456)).toBe(0.46);
    expect(roundQuantity(0.004)).toBe(0);
    expect(roundQuantity(300)).toBe(300);
  });

  it('clears a floating point residue', () => {
    expect(roundQuantity(0.1 + 0.2 - 0.3)).toBe(0);
  });
});
