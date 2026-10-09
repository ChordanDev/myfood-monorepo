import {
  formatQuantityMilli,
  milliToInputText,
  milliToQuantity,
  parseQuantityInputMilli,
  quantityToMilli,
} from './quantityMilli';

describe('milliToQuantity', () => {
  it.each([
    [1500, 1.5],
    [1_000_000, 1000],
    [1, 0.001],
    [0, 0],
  ])('reads %p thousandths as %p', (quantityMilli, expected) => {
    expect(milliToQuantity(quantityMilli)).toBe(expected);
  });
});

describe('quantityToMilli', () => {
  it.each([
    [1.5, 1500],
    [2, 2000],
    [0, 0],
    [0.001, 1],
  ])('writes %p as %p thousandths', (quantity, expected) => {
    expect(quantityToMilli(quantity)).toBe(expected);
  });

  it('always answers an integer, whatever the floating point noise', () => {
    expect(quantityToMilli(0.1 + 0.2)).toBe(300);
    expect(quantityToMilli(1.005)).toBe(1005);
    expect(quantityToMilli(0.0004)).toBe(0);
  });
});

describe('formatQuantityMilli', () => {
  it.each([
    [300_000, 'g', '300 g'],
    [1_500_000, 'g', '1,5 kg'],
    [750_000, 'ml', '750 ml'],
    [2_250_000, 'ml', '2,25 L'],
    [3_000, 'unit', '3 u'],
    [500, 'unit', '0,5 u'],
    [0, 'g', '0 g'],
  ] as const)('shows %p thousandths of %s as "%s"', (quantityMilli, unit, expected) => {
    expect(formatQuantityMilli(quantityMilli, unit)).toBe(expected);
  });
});

describe('parseQuantityInputMilli', () => {
  it.each([
    ['300', 300_000],
    ['1,5', 1500],
    ['1.5', 1500],
    [' 2 ', 2000],
    ['0', 0],
    ['0,25', 250],
    ['1,005', 1005],
    ['0,0004', 0],
  ])('reads "%s" as %p thousandths', (text, expected) => {
    expect(parseQuantityInputMilli(text)).toBe(expected);
  });

  it.each([
    ['empty text', ''],
    ['words', 'abc'],
    ['a negative number', '-3'],
    ['a number followed by a unit', '300 g'],
    ['exponent notation', '1e3'],
    ['a number too large to be finite', '9'.repeat(400)],
    ['a number too large to stay an exact integer', '9'.repeat(20)],
  ])('rejects %s', (_label, text) => {
    expect(parseQuantityInputMilli(text)).toBeNull();
  });
});

describe('milliToInputText', () => {
  it.each([
    [1_000_000, '1000'],
    [1500, '1,5'],
    [500, '0,5'],
    [1, '0,001'],
    [0, '0'],
  ])('writes %p thousandths as "%s"', (quantityMilli, expected) => {
    expect(milliToInputText(quantityMilli)).toBe(expected);
  });

  it('writes a text that parses back to the same quantity', () => {
    for (const quantityMilli of [1, 333, 1005, 750_000, 1_234_567]) {
      expect(parseQuantityInputMilli(milliToInputText(quantityMilli))).toBe(quantityMilli);
    }
  });
});
