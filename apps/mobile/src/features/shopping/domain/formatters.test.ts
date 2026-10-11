import type { ShoppingLineAllocation, ShoppingListLine, ShoppingMealSlot } from '../types';
import {
  formatCartButtonLabel,
  formatCountersLabel,
  formatItemMealsLine,
  formatItemNameLine,
  formatRemovedLabel,
  formatSuggestedQuantity,
  parseBoughtQuantityMilli,
  parseQuantityMilli,
  formatUntilButtonLabel,
  formatUntilLabel,
} from './formatters';

describe('formatUntilLabel', () => {
  it('writes the day and the short Spanish month of a date key', () => {
    expect(formatUntilLabel('2026-10-12')).toBe('Hasta 12 Oct');
  });

  it('drops the leading zero of the day', () => {
    expect(formatUntilLabel('2026-03-05')).toBe('Hasta 5 Mar');
  });

  it('knows the twelve months', () => {
    const labels = Array.from({ length: 12 }, (_, index) =>
      formatUntilLabel(`2026-${String(index + 1).padStart(2, '0')}-01`)
    );

    expect(labels).toEqual([
      'Hasta 1 Ene',
      'Hasta 1 Feb',
      'Hasta 1 Mar',
      'Hasta 1 Abr',
      'Hasta 1 May',
      'Hasta 1 Jun',
      'Hasta 1 Jul',
      'Hasta 1 Ago',
      'Hasta 1 Sep',
      'Hasta 1 Oct',
      'Hasta 1 Nov',
      'Hasta 1 Dic',
    ]);
  });
});

describe('row lines', () => {
  const milk: ShoppingListLine = {
    id: 'milk:ml',
    source: 'planned_meal',
    status: 'needed',
    name: 'Leche entera',
    ingredientId: 'milk',
    quantityMilli: 1_000_000,
    unit: 'ml',
    category: 'lacteos',
    supermarketId: null,
    allocations: [],
  };

  const paper: ShoppingListLine = {
    id: 'manual-1',
    source: 'manual',
    status: 'needed',
    name: 'Papel de cocina',
    ingredientId: null,
    quantityMilli: 1_000,
    unit: 'unit',
    category: 'otros',
    supermarketId: null,
    allocations: [],
  };

  it('writes the quantity before the name of a planned item', () => {
    expect(formatItemNameLine(milk)).toBe('1 L · Leche entera');
  });

  it.each([
    [400_000, 'g', '400 g · Leche entera'],
    [1_250_000, 'g', '1,25 kg · Leche entera'],
    [2_500, 'g', '2,5 g · Leche entera'],
    [750_000, 'ml', '750 ml · Leche entera'],
    [5_000, 'unit', '5 u · Leche entera'],
  ] as const)('reads %d thousandths of a %s as "%s"', (quantityMilli, unit, line) => {
    expect(formatItemNameLine({ ...milk, quantityMilli, unit })).toBe(line);
  });

  it('writes the quantity before the name of a manual item too', () => {
    expect(formatItemNameLine(paper)).toBe('1 u · Papel de cocina');
  });
});

describe('formatItemMealsLine', () => {
  function share(date: string, slot: ShoppingMealSlot): ShoppingLineAllocation {
    return {
      itemId: `item:${date}:${slot}`,
      scheduledMealId: `meal:${date}:${slot}`,
      date,
      slot,
      quantityMilli: 1,
      status: 'needed',
    };
  }

  function line(...allocations: ShoppingLineAllocation[]): ShoppingListLine {
    return {
      id: 'rice:g',
      source: 'planned_meal',
      status: 'needed',
      name: 'Arroz',
      ingredientId: 'rice',
      quantityMilli: allocations.length,
      unit: 'g',
      category: 'granos',
      supermarketId: null,
      allocations,
    };
  }

  const lunch = share('2026-10-08', 'lunch');
  const dinner = share('2026-10-10', 'dinner');

  it('says which meal the line of one meal is for, with its day and its slot', () => {
    expect(formatItemMealsLine(line(lunch), 'meal')).toBe('8 Oct · Almuerzo');
  });

  it.each([
    ['breakfast', 'Desayuno'],
    ['lunch', 'Almuerzo'],
    ['snack', 'Merienda'],
    ['dinner', 'Cena'],
  ] as const)('names the %s slot "%s"', (slot, label) => {
    expect(formatItemMealsLine(line(share('2026-03-05', slot)), 'meal')).toBe(`5 Mar · ${label}`);
  });

  it('writes only the day of a slot it has no name for', () => {
    const brunch = share('2026-10-08', 'brunch' as ShoppingMealSlot);

    expect(formatItemMealsLine(line(brunch), 'meal')).toBe('8 Oct');
  });

  it('says how many meals an ingredient line adds up', () => {
    expect(formatItemMealsLine(line(lunch, dinner), 'ingredient')).toBe('Para 2 comidas');
    expect(formatItemMealsLine(line(lunch, dinner, lunch), 'ingredient')).toBe('Para 3 comidas');
  });

  it('has nothing to add to an ingredient line for a single meal', () => {
    expect(formatItemMealsLine(line(lunch), 'ingredient')).toBeUndefined();
  });

  it('never passes a line of several meals for the line of one, whatever the grouping', () => {
    expect(formatItemMealsLine(line(lunch, dinner), 'meal')).toBe('Para 2 comidas');
  });

  it('counts only the meals there is still something to buy for', () => {
    const bought: ShoppingLineAllocation = { ...lunch, status: 'purchased' };
    const removed: ShoppingLineAllocation = { ...dinner, status: 'removed' };

    expect(formatItemMealsLine(line(bought, lunch, dinner), 'ingredient')).toBe('Para 2 comidas');
    // Bought in part for its only meal: the remainder is for that one meal.
    expect(formatItemMealsLine(line(bought, lunch), 'ingredient')).toBeUndefined();
    expect(formatItemMealsLine(line(removed, lunch), 'ingredient')).toBeUndefined();
  });

  it('counts the meals a purchased line was bought for, and the ones a removed line had', () => {
    const bought: ShoppingLineAllocation = { ...lunch, status: 'purchased' };
    const alsoBought: ShoppingLineAllocation = { ...dinner, status: 'purchased' };
    const removed: ShoppingLineAllocation = { ...dinner, status: 'removed' };

    expect(
      formatItemMealsLine({ ...line(bought, alsoBought, removed), status: 'purchased' }, 'meal')
    ).toBe('Para 2 comidas');
    expect(formatItemMealsLine({ ...line(bought), status: 'purchased' }, 'meal')).toBe(
      '8 Oct · Almuerzo'
    );
    expect(
      formatItemMealsLine({ ...line(removed, removed), status: 'removed' }, 'ingredient')
    ).toBe('Para 2 comidas');
  });

  it('has nothing to say about a line without meals', () => {
    expect(formatItemMealsLine(line(), 'meal')).toBeUndefined();
    expect(formatItemMealsLine(line(), 'ingredient')).toBeUndefined();
  });
});

describe('formatCountersLabel', () => {
  it('writes how many items are listed and how many of them are in the cart', () => {
    expect(formatCountersLabel({ total: 4, inCart: 2, removed: 0 })).toBe(
      '4 ítems · 2 en el carrito'
    );
    expect(formatCountersLabel({ total: 0, inCart: 0, removed: 2 })).toBe(
      '0 ítems · 0 en el carrito'
    );
  });

  it('uses the singular for one item; the cart part has a single form', () => {
    expect(formatCountersLabel({ total: 1, inCart: 1, removed: 0 })).toBe(
      '1 ítem · 1 en el carrito'
    );
    expect(formatCountersLabel({ total: 2, inCart: 1, removed: 0 })).toBe(
      '2 ítems · 1 en el carrito'
    );
  });
});

describe('formatCartButtonLabel', () => {
  it('says the cart is empty', () => {
    expect(formatCartButtonLabel(0)).toBe('Ver carrito, vacío');
  });

  it('counts the rows in the cart, in the singular for one', () => {
    expect(formatCartButtonLabel(1)).toBe('Ver carrito, 1 ítem');
    expect(formatCartButtonLabel(2)).toBe('Ver carrito, 2 ítems');
    expect(formatCartButtonLabel(12)).toBe('Ver carrito, 12 ítems');
  });
});

describe('formatUntilButtonLabel', () => {
  it('says what the pill does and the day the list reaches now', () => {
    expect(formatUntilButtonLabel('2026-10-12')).toBe('Elegir hasta qué día comprar, ahora 12 Oct');
    expect(formatUntilButtonLabel('2026-01-05')).toBe('Elegir hasta qué día comprar, ahora 5 Ene');
  });
});

describe('formatRemovedLabel', () => {
  it('offers to restore the one item that was removed', () => {
    expect(formatRemovedLabel(1)).toBe('1 quitado · Restaurar');
  });

  it('uses the plural for several removed items', () => {
    expect(formatRemovedLabel(2)).toBe('2 quitados · Restaurar');
    expect(formatRemovedLabel(11)).toBe('11 quitados · Restaurar');
  });
});

describe('parseQuantityMilli', () => {
  it.each([
    ['1', 1_000],
    ['2,5', 2_500],
    ['2.5', 2_500],
    [' 0,001 ', 1],
    ['500', 500_000],
    ['3.', 3_000],
  ])('reads "%s" as %d thousandths', (text, milli) => {
    expect(parseQuantityMilli(text)).toBe(milli);
  });

  it.each(['', ' ', '0', '0,0', '-1', 'abc', '1,2,3', '1e3', '0,0004', '1 2'])(
    'refuses "%s"',
    (text) => {
      expect(parseQuantityMilli(text)).toBeUndefined();
    }
  );
});

describe('parseBoughtQuantityMilli', () => {
  it.each([
    ['1', 1_000],
    ['2,5', 2_500],
    ['400', 400_000],
    ['0', 0],
    ['0,0', 0],
    [' 0,001 ', 1],
  ])('reads "%s" as %d thousandths', (text, milli) => {
    expect(parseBoughtQuantityMilli(text)).toBe(milli);
  });

  it.each(['', ' ', '-1', 'abc', '1,2,3', '1e3', '1 2'])('refuses "%s"', (text) => {
    expect(parseBoughtQuantityMilli(text)).toBeUndefined();
  });
});

describe('formatSuggestedQuantity', () => {
  it('says what the Cart holds of a line, as the list writes quantities', () => {
    expect(formatSuggestedQuantity(400_000, 'g')).toBe('Sugerido: 400 g');
    expect(formatSuggestedQuantity(1_250_000, 'g')).toBe('Sugerido: 1,25 kg');
    expect(formatSuggestedQuantity(2_000, 'unit')).toBe('Sugerido: 2 u');
  });
});
