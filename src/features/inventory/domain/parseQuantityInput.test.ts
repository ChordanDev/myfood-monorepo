import { parseQuantityInput } from './parseQuantityInput';

describe('parseQuantityInput', () => {
  it.each([
    ['300', 300],
    ['1,5', 1.5],
    ['1.5', 1.5],
    [' 300 ', 300],
    ['0', 0],
    ['0,25', 0.25],
  ])('reads "%s" as %p', (text, expected) => {
    expect(parseQuantityInput(text)).toBe(expected);
  });

  it.each([
    ['empty text', ''],
    ['blank text', '   '],
    ['words', 'abc'],
    ['a number followed by a unit', '300 g'],
    ['a negative number', '-3'],
    ['two decimal separators', '1,5,2'],
    ['a lone separator', ','],
    ['exponent notation', '1e3'],
    ['infinity', 'Infinity'],
    ['a number too large to be finite', '9'.repeat(400)],
  ])('rejects %s', (_label, text) => {
    expect(parseQuantityInput(text)).toBeNull();
  });
});
