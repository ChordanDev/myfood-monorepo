import { CHICKEN, MILK, ONION, RICE, STEW, buildInventoryItem } from '../fixtures';
import { groupInventoryByFreshness } from './groupInventoryByFreshness';

describe('groupInventoryByFreshness', () => {
  it('returns no sections for an empty inventory', () => {
    expect(groupInventoryByFreshness([])).toEqual([]);
  });

  it('puts what to use first first: expired, then about to expire, then the rest', () => {
    const sections = groupInventoryByFreshness([RICE, MILK, CHICKEN]);

    expect(sections).toEqual([
      { freshness: 'expired', items: [CHICKEN] },
      { freshness: 'warning', items: [MILK] },
      { freshness: 'ok', items: [RICE] },
    ]);
  });

  it('leaves out a section that has no items', () => {
    expect(groupInventoryByFreshness([RICE, ONION]).map((section) => section.freshness)).toEqual([
      'ok',
    ]);
  });

  it('orders the lots of a section by expiry, the soonest first', () => {
    const [section] = groupInventoryByFreshness([RICE, ONION, STEW]);

    expect(section.items).toEqual([STEW, ONION, RICE]);
  });

  it('orders the lots that expire the same day by name, using Spanish collation', () => {
    const lot = (name: string) => buildInventoryItem({ id: `lot-${name}`, name });

    const [section] = groupInventoryByFreshness([lot('Zapallo'), lot('Ñame'), lot('ajo')]);

    expect(section.items.map((item) => item.name)).toEqual(['ajo', 'Ñame', 'Zapallo']);
  });

  it('does not reorder the inventory it receives', () => {
    const items = [RICE, ONION];

    groupInventoryByFreshness(items);

    expect(items).toEqual([RICE, ONION]);
  });
});
