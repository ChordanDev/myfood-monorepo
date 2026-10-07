import type { ManualShoppingListItem, PlannedShoppingListItem } from '../types';
import {
  formatCartButtonLabel,
  formatCountersLabel,
  formatItemMetaLine,
  formatItemNameLine,
  formatPrice,
  formatRemovedLabel,
  formatUntilLabel,
} from './formatters';

describe('formatPrice', () => {
  it('writes pesos with a thousands dot and no decimals', () => {
    expect(formatPrice(1850)).toBe('$1.850');
    expect(formatPrice(450)).toBe('$450');
    expect(formatPrice(1234567)).toBe('$1.234.567');
  });

  it('rounds to the nearest peso', () => {
    expect(formatPrice(1849.5)).toBe('$1.850');
    expect(formatPrice(999.6)).toBe('$1.000');
    expect(formatPrice(0.4)).toBe('$0');
  });
});

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
  const milk: PlannedShoppingListItem = {
    id: 'planned:milk',
    source: 'planned_meal',
    status: 'needed',
    name: 'Leche entera',
    ingredientId: 'milk',
    amountToBuy: 1000,
    unit: 'ml',
    category: 'lacteos',
  };

  const paper: ManualShoppingListItem = {
    id: 'manual-1',
    source: 'manual',
    status: 'needed',
    name: 'Papel de cocina',
  };

  it('writes the quantity before the name of a planned item', () => {
    expect(formatItemNameLine(milk)).toBe('1 L · Leche entera');
  });

  it('writes just the name of a manual item', () => {
    expect(formatItemNameLine(paper)).toBe('Papel de cocina');
  });

  it('writes the supermarket and the price of the best offer', () => {
    const offer = { supermarket: 'Coto', unitPrice: 1.85, price: 1850 };

    expect(formatItemMetaLine(offer)).toBe('Coto · $1.850');
  });

  it('says there is no price when there is no offer', () => {
    expect(formatItemMetaLine(undefined)).toBe('Sin precio');
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

describe('formatRemovedLabel', () => {
  it('offers to restore the one item that was removed', () => {
    expect(formatRemovedLabel(1)).toBe('1 quitado · Restaurar');
  });

  it('uses the plural for several removed items', () => {
    expect(formatRemovedLabel(2)).toBe('2 quitados · Restaurar');
    expect(formatRemovedLabel(11)).toBe('11 quitados · Restaurar');
  });
});
