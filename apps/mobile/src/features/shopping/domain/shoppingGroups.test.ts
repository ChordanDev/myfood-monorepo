import type { ShoppingGroup, ShoppingItemStatus, ShoppingListLine } from '../types';
import { groupItemsByCategory } from './shoppingGroups';

function buildLine(
  id: string,
  category: string,
  status: ShoppingItemStatus = 'needed',
  name = id
): ShoppingListLine {
  return {
    id,
    source: 'planned_meal',
    status,
    name,
    ingredientId: id,
    quantityMilli: 1000,
    unit: 'unit',
    category,
    supermarketId: null,
    allocations: [],
  };
}

// Groups as [key, title, line ids].
function summarize(groups: ShoppingGroup[]) {
  return groups.map((group) => [group.key, group.title, group.items.map((item) => item.id)]);
}

describe('groupItemsByCategory', () => {
  it('orders the groups as the screen lists them, with Spanish titles', () => {
    const lines = [
      buildLine('lentejas', 'granos'),
      buildLine('bread', 'panaderia'),
      buildLine('soap', 'limpieza_otros'),
      buildLine('milk', 'lacteos'),
      buildLine('tomato', 'verduras'),
      buildLine('juice', 'bebidas'),
      buildLine('apple', 'frutas'),
      buildLine('rice', 'almacen'),
      buildLine('tuna', 'no_perecederos'),
      buildLine('beef', 'carnes'),
      buildLine('peas', 'congelados'),
      buildLine('salmon', 'pescados_mariscos'),
      buildLine('candle', 'otros'),
      buildLine('salt', 'condimentos'),
    ];

    expect(summarize(groupItemsByCategory(lines))).toEqual([
      ['verduras', 'Verduras', ['tomato']],
      ['frutas', 'Frutas', ['apple']],
      ['carnes', 'Carnes', ['beef']],
      ['pescados_mariscos', 'Pescados y mariscos', ['salmon']],
      ['lacteos', 'Lácteos', ['milk']],
      ['panaderia', 'Panadería', ['bread']],
      ['almacen', 'Despensa', ['rice']],
      ['congelados', 'Congelados', ['peas']],
      ['bebidas', 'Bebidas', ['juice']],
      ['condimentos', 'Condimentos', ['salt']],
      ['limpieza_otros', 'Limpieza y otros', ['soap']],
      ['granos', 'Granos', ['lentejas']],
      ['no_perecederos', 'No perecederos', ['tuna']],
      ['otros', 'Otros', ['candle']],
    ]);
  });

  it('titles every category the server files an ingredient under', () => {
    const serverCategories = [
      'lacteos',
      'frutas',
      'verduras',
      'carnes',
      'granos',
      'congelados',
      'no_perecederos',
      'otros',
    ];
    const groups = groupItemsByCategory(
      serverCategories.map((category) => buildLine(category, category))
    );

    // Each one has a group of its own: none of them falls under the fallback.
    expect(groups.map((group) => group.key).sort()).toEqual([...serverCategories].sort());
    expect(groups.map((group) => group.title)).toEqual([
      'Verduras',
      'Frutas',
      'Carnes',
      'Lácteos',
      'Congelados',
      'Granos',
      'No perecederos',
      'Otros',
    ]);
  });

  it('omits empty groups', () => {
    const lines = [buildLine('milk', 'lacteos'), buildLine('cheese', 'lacteos')];

    expect(summarize(groupItemsByCategory(lines))).toEqual([
      ['lacteos', 'Lácteos', ['cheese', 'milk']],
    ]);
  });

  it('sorts the lines of a group by name, in Spanish order', () => {
    const lines = [
      buildLine('1', 'verduras', 'needed', 'Zapallo'),
      buildLine('2', 'verduras', 'needed', 'ñame'),
      buildLine('3', 'verduras', 'needed', 'Ajo'),
      buildLine('4', 'verduras', 'needed', 'Ñoquis'),
      buildLine('5', 'verduras', 'needed', 'Nabo'),
    ];

    const [group] = groupItemsByCategory(lines);

    expect(group.items.map((item) => item.name)).toEqual([
      'Ajo',
      'Nabo',
      'ñame',
      'Ñoquis',
      'Zapallo',
    ]);
  });

  it('keeps the lines an ingredient has per meal together, in the order of the read', () => {
    const lines = [
      buildLine('rice-oct-8', 'granos', 'needed', 'Arroz'),
      buildLine('oats-oct-8', 'granos', 'needed', 'Avena'),
      buildLine('rice-oct-10', 'granos', 'needed', 'Arroz'),
      buildLine('rice-oct-12', 'granos', 'needed', 'Arroz'),
    ];

    expect(summarize(groupItemsByCategory(lines))).toEqual([
      ['granos', 'Granos', ['rice-oct-8', 'rice-oct-10', 'rice-oct-12', 'oats-oct-8']],
    ]);
  });

  it('puts a line of a category it has no title for under "Otros"', () => {
    const lines = [buildLine('candle', 'otros'), buildLine('mystery', 'especias_raras')];

    expect(summarize(groupItemsByCategory(lines))).toEqual([
      ['otros', 'Otros', ['candle', 'mystery']],
    ]);
  });

  it('leaves out the removed lines, and keeps the ones in the cart', () => {
    const lines = [
      buildLine('cheese', 'lacteos', 'removed'),
      buildLine('milk', 'lacteos', 'in_cart'),
      buildLine('yogurt', 'lacteos'),
    ];

    expect(summarize(groupItemsByCategory(lines))).toEqual([
      ['lacteos', 'Lácteos', ['milk', 'yogurt']],
    ]);
  });

  it('leaves the lines of the read in the order they came in', () => {
    const lines = [buildLine('b', 'lacteos'), buildLine('a', 'lacteos')];

    groupItemsByCategory(lines);

    expect(lines.map((line) => line.id)).toEqual(['b', 'a']);
  });
});
