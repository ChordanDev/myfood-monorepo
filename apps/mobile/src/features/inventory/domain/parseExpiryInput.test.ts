import { parseExpiryInput } from './parseExpiryInput';

describe('parseExpiryInput', () => {
  it.each([
    ['28/10/2026', '2026-10-28'],
    ['1/3/2027', '2027-03-01'],
    [' 05/01/2027 ', '2027-01-05'],
    ['29/02/2028', '2028-02-29'],
  ])('reads "%s" as the date %s', (text, expected) => {
    expect(parseExpiryInput(text)).toBe(expected);
  });

  it.each(['', '   '])('reads the blank text "%s" as no expiry', (text) => {
    expect(parseExpiryInput(text)).toBeUndefined();
  });

  it.each([
    ['words', 'mañana'],
    ['a date without its year', '28/10'],
    ['a two digit year', '28/10/26'],
    ['an ISO date', '2026-10-28'],
    ['a month that does not exist', '10/13/2026'],
    ['a day the month does not have', '31/04/2026'],
    ['the 29th of February of a common year', '29/02/2027'],
    ['a day zero', '0/10/2026'],
  ])('rejects %s', (_label, text) => {
    expect(parseExpiryInput(text)).toBeNull();
  });
});
