import type { ManualShoppingListItem, PlannedShoppingListItem } from '../types';
import {
  formatCountersLabel,
  formatItemMetaLine,
  formatItemNameLine,
  formatPrice,
  formatQuantity,
  formatUntilLabel,
} from './formatters';

describe('formatQuantity', () => {
  it('writes grams below a kilo as g', () => {
    expect(formatQuantity(300, 'gramos')).toBe('300 g');
    expect(formatQuantity(999, 'gramos')).toBe('999 g');
  });

  it('writes grams from a kilo on as kg, with a decimal comma', () => {
    expect(formatQuantity(1000, 'gramos')).toBe('1 kg');
    expect(formatQuantity(1500, 'gramos')).toBe('1,5 kg');
  });

  it('writes millilitres below a litre as ml', () => {
    expect(formatQuantity(500, 'mililitros')).toBe('500 ml');
  });

  it('writes millilitres from a litre on as L, with a decimal comma', () => {
    expect(formatQuantity(1000, 'mililitros')).toBe('1 L');
    expect(formatQuantity(1500, 'mililitros')).toBe('1,5 L');
  });

  it('writes units as u, whatever the amount', () => {
    expect(formatQuantity(2, 'unidades')).toBe('2 u');
    expect(formatQuantity(1500, 'unidades')).toBe('1500 u');
  });

  it('keeps at most two decimals', () => {
    expect(formatQuantity(1234, 'gramos')).toBe('1,23 kg');
    expect(formatQuantity(0.5, 'unidades')).toBe('0,5 u');
    expect(formatQuantity(999.999, 'gramos')).toBe('1 kg');
  });
});

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
    unit: 'mililitros',
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
  it('writes how many items are listed and how many of them are purchased', () => {
    expect(formatCountersLabel({ total: 14, purchased: 3, removed: 0 })).toBe(
      '14 ítems · 3 comprados'
    );
    expect(formatCountersLabel({ total: 0, purchased: 0, removed: 2 })).toBe(
      '0 ítems · 0 comprados'
    );
  });

  it('uses the singular for one item and for one purchase', () => {
    expect(formatCountersLabel({ total: 1, purchased: 1, removed: 0 })).toBe('1 ítem · 1 comprado');
    expect(formatCountersLabel({ total: 2, purchased: 1, removed: 0 })).toBe(
      '2 ítems · 1 comprado'
    );
  });
});
