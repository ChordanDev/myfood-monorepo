import { ONION } from '../mocks';
import type { InventoryCategory, InventoryItem } from '../types';
import { groupInventoryByCategory } from './groupInventoryByCategory';

function buildItem(name: string, category: InventoryCategory, quantityMilli = 1000): InventoryItem {
  return { ...ONION, id: `inv-${name}`, name, category, quantityMilli };
}

describe('groupInventoryByCategory', () => {
  it('returns no groups for an empty inventory', () => {
    expect(groupInventoryByCategory([])).toEqual([]);
  });

  it('puts each item under its category', () => {
    const onion = buildItem('Cebolla', 'verduras');
    const tomato = buildItem('Tomate', 'verduras');
    const milk = buildItem('Leche', 'lacteos');

    expect(groupInventoryByCategory([onion, milk, tomato])).toEqual([
      { category: 'verduras', items: [onion, tomato] },
      { category: 'lacteos', items: [milk] },
    ]);
  });

  it('orders the groups as the category list does, whatever the item order', () => {
    const groups = groupInventoryByCategory([
      buildItem('Guiso', 'otros'),
      buildItem('Arroz', 'no_perecederos'),
      buildItem('Banana', 'frutas'),
      buildItem('Cebolla', 'verduras'),
    ]);

    expect(groups.map((group) => group.category)).toEqual([
      'verduras',
      'frutas',
      'almacen',
      'otros',
    ]);
  });

  it('puts the categories of the API that share a display category in one group', () => {
    const rice = buildItem('Arroz', 'no_perecederos');
    const oats = buildItem('Avena', 'granos');

    expect(groupInventoryByCategory([rice, oats])).toEqual([
      { category: 'almacen', items: [rice, oats] },
    ]);
  });

  it('hides the items that ran out', () => {
    const rice = buildItem('Arroz', 'no_perecederos');

    expect(groupInventoryByCategory([rice, buildItem('Fideos', 'no_perecederos', 0)])).toEqual([
      { category: 'almacen', items: [rice] },
    ]);
  });

  it('omits a category whose items all ran out', () => {
    expect(groupInventoryByCategory([buildItem('Leche', 'lacteos', 0)])).toEqual([]);
  });

  it('sorts the items of a group by name using Spanish collation', () => {
    const groups = groupInventoryByCategory([
      buildItem('Zapallo', 'verduras'),
      buildItem('Ñame', 'verduras'),
      buildItem('ajo', 'verduras'),
      buildItem('Apio', 'verduras'),
      buildItem('Nabo', 'verduras'),
    ]);

    expect(groups[0].items.map((item) => item.name)).toEqual([
      'ajo',
      'Apio',
      'Nabo',
      'Ñame',
      'Zapallo',
    ]);
  });

  it('does not reorder the inventory it receives', () => {
    const items = [buildItem('Tomate', 'verduras'), buildItem('Cebolla', 'verduras')];

    groupInventoryByCategory(items);

    expect(items.map((item) => item.name)).toEqual(['Tomate', 'Cebolla']);
  });
});
