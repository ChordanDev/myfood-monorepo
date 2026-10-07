import type { IngredientCategory, UnitType } from '@/types/domain';
import type {
  ManualShoppingListItem,
  PlannedShoppingListItem,
  ShoppingGroup,
  ShoppingItemStatus,
  SupermarketOffer,
} from '../types';
import {
  getBestOffer,
  getManualItems,
  groupItemsByCategory,
  groupItemsBySupermarket,
} from './shoppingGroups';

function buildPlannedItem(
  ingredientId: string,
  category: IngredientCategory,
  amountToBuy = 1,
  status: ShoppingItemStatus = 'needed',
  unit: UnitType = 'unit'
): PlannedShoppingListItem {
  return {
    id: `planned:${ingredientId}`,
    source: 'planned_meal',
    status,
    name: ingredientId,
    ingredientId,
    amountToBuy,
    unit,
    category,
  };
}

function buildManualItem(
  id: string,
  status: ShoppingItemStatus = 'needed'
): ManualShoppingListItem {
  return { id, source: 'manual', status, name: id };
}

function buildOffer(
  ingredientId: string,
  supermarket: string,
  unitPrice: number
): SupermarketOffer {
  return { ingredientId, supermarket, unitPrice };
}

// Groups as [key, title, item ids].
function summarize(groups: ShoppingGroup[]) {
  return groups.map((group) => [group.key, group.title, group.items.map((item) => item.id)]);
}

describe('getBestOffer', () => {
  const milk = buildPlannedItem('milk', 'lacteos', 1000, 'needed', 'ml');

  it('picks the cheapest offer and prices it for the amount to buy', () => {
    const offers = [
      buildOffer('milk', 'Jumbo', 2.1),
      buildOffer('milk', 'Coto', 1.85),
      buildOffer('tomato', 'Dia', 0.5),
    ];

    expect(getBestOffer(milk, offers)).toEqual({
      supermarket: 'Coto',
      unitPrice: 1.85,
      price: 1850,
    });
  });

  it('keeps the first offer listed when prices tie', () => {
    const offers = [buildOffer('milk', 'Jumbo', 2), buildOffer('milk', 'Coto', 2)];

    expect(getBestOffer(milk, offers)?.supermarket).toBe('Jumbo');
  });

  it('returns nothing when no supermarket offers the ingredient', () => {
    expect(getBestOffer(milk, [buildOffer('tomato', 'Coto', 0.5)])).toBeUndefined();
  });

  it('returns nothing for a manual item', () => {
    expect(getBestOffer(buildManualItem('milk'), [buildOffer('milk', 'Coto', 2)])).toBeUndefined();
  });
});

describe('groupItemsByCategory', () => {
  it('orders the groups as the screen lists them, with Spanish titles', () => {
    const items = [
      buildPlannedItem('napkins', 'otros'),
      buildPlannedItem('soap', 'limpieza_otros'),
      buildPlannedItem('salt', 'condimentos'),
      buildPlannedItem('cola', 'bebidas'),
      buildPlannedItem('peas', 'congelados'),
      buildPlannedItem('rice', 'almacen'),
      buildPlannedItem('bread', 'panaderia'),
      buildPlannedItem('milk', 'lacteos'),
      buildPlannedItem('hake', 'pescados_mariscos'),
      buildPlannedItem('chicken', 'carnes'),
      buildPlannedItem('apple', 'frutas'),
      buildPlannedItem('tomato', 'verduras'),
    ];

    expect(summarize(groupItemsByCategory(items))).toEqual([
      ['verduras', 'Verduras', ['planned:tomato']],
      ['frutas', 'Frutas', ['planned:apple']],
      ['carnes', 'Carnes', ['planned:chicken']],
      ['pescados_mariscos', 'Pescados y mariscos', ['planned:hake']],
      ['lacteos', 'Lácteos', ['planned:milk']],
      ['panaderia', 'Panadería', ['planned:bread']],
      ['almacen', 'Despensa', ['planned:rice']],
      ['congelados', 'Congelados', ['planned:peas']],
      ['bebidas', 'Bebidas', ['planned:cola']],
      ['condimentos', 'Condimentos', ['planned:salt']],
      ['limpieza_otros', 'Limpieza y otros', ['planned:soap']],
      ['otros', 'Otros', ['planned:napkins']],
    ]);
  });

  it('omits empty groups', () => {
    const items = [buildPlannedItem('milk', 'lacteos'), buildPlannedItem('tomato', 'verduras')];

    expect(summarize(groupItemsByCategory(items))).toEqual([
      ['verduras', 'Verduras', ['planned:tomato']],
      ['lacteos', 'Lácteos', ['planned:milk']],
    ]);
  });

  it('sorts the items of a group by name, in Spanish order', () => {
    const items = [
      buildPlannedItem('zapallo', 'verduras'),
      buildPlannedItem('Échalote', 'verduras'),
      buildPlannedItem('ajo', 'verduras'),
    ];

    expect(summarize(groupItemsByCategory(items))).toEqual([
      ['verduras', 'Verduras', ['planned:ajo', 'planned:Échalote', 'planned:zapallo']],
    ]);
  });

  it('puts an item of an unknown category under "Otros"', () => {
    const items = [
      buildPlannedItem('salt', 'otros'),
      buildPlannedItem('kibble', 'mascotas' as IngredientCategory),
    ];

    expect(summarize(groupItemsByCategory(items))).toEqual([
      ['otros', 'Otros', ['planned:kibble', 'planned:salt']],
    ]);
  });

  it('leaves out removed and manual items, and keeps the ones in the cart', () => {
    const items = [
      buildPlannedItem('milk', 'lacteos', 1, 'in_cart'),
      buildPlannedItem('tomato', 'verduras', 1, 'removed'),
      buildManualItem('manual-1'),
    ];

    expect(summarize(groupItemsByCategory(items))).toEqual([
      ['lacteos', 'Lácteos', ['planned:milk']],
    ]);
  });
});

describe('groupItemsBySupermarket', () => {
  it('groups each item under the supermarket holding its best offer, both sorted by name', () => {
    const items = [
      buildPlannedItem('milk', 'lacteos'),
      buildPlannedItem('tomato', 'verduras'),
      buildPlannedItem('rice', 'almacen'),
      buildPlannedItem('apple', 'frutas'),
    ];
    const offers = [
      buildOffer('milk', 'Jumbo', 5),
      buildOffer('milk', 'Coto', 9),
      buildOffer('tomato', 'Día', 3),
      buildOffer('rice', 'Disco', 4),
      buildOffer('apple', 'Jumbo', 2),
    ];

    expect(summarize(groupItemsBySupermarket(items, offers))).toEqual([
      ['supermarket:Día', 'Día', ['planned:tomato']],
      ['supermarket:Disco', 'Disco', ['planned:rice']],
      ['supermarket:Jumbo', 'Jumbo', ['planned:apple', 'planned:milk']],
    ]);
  });

  it('puts the items without an offer under "Sin súper", last and sorted by name', () => {
    const items = [
      buildPlannedItem('salt', 'otros'),
      buildPlannedItem('milk', 'lacteos'),
      buildPlannedItem('pepper', 'otros'),
    ];

    expect(summarize(groupItemsBySupermarket(items, [buildOffer('milk', 'Coto', 9)]))).toEqual([
      ['supermarket:Coto', 'Coto', ['planned:milk']],
      ['no-supermarket', 'Sin súper', ['planned:pepper', 'planned:salt']],
    ]);
  });

  it('leaves out removed and manual items', () => {
    const items = [buildPlannedItem('milk', 'lacteos', 1, 'removed'), buildManualItem('manual-1')];

    expect(groupItemsBySupermarket(items, [buildOffer('milk', 'Coto', 9)])).toEqual([]);
  });
});

describe('getManualItems', () => {
  it('lists the manual items that are not removed, in list order', () => {
    const paper = buildManualItem('manual-1');
    const soap = buildManualItem('manual-2', 'in_cart');
    const items = [
      buildPlannedItem('milk', 'lacteos'),
      paper,
      buildManualItem('manual-3', 'removed'),
      soap,
    ];

    expect(getManualItems(items)).toEqual([paper, soap]);
  });
});
