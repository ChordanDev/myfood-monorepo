import type { SupermarketOffer } from '@/features/shopping/types';

// The price-per-supermarket contract is not defined yet (issue #44). Until a backend serves
// it, this file is the single place the offers come from: replace it, nothing else.

const COTO = 'Coto';
const DIA = 'Día';
const CARREFOUR = 'Carrefour';

// `unitPrice` is in pesos per base unit of the ingredient in `MOCK_INGREDIENTS`: per gram,
// per millilitre or per unit. The first offer of each ingredient is its cheapest one.
export const MOCK_SUPERMARKET_OFFERS: SupermarketOffer[] = [
  // i1 · Arroz Blanco, per gram
  { ingredientId: 'i1', supermarket: DIA, unitPrice: 1.9 },
  { ingredientId: 'i1', supermarket: CARREFOUR, unitPrice: 2.1 },
  { ingredientId: 'i1', supermarket: COTO, unitPrice: 2.2 },
  // i2 · Pollo (Pechuga), per gram
  { ingredientId: 'i2', supermarket: DIA, unitPrice: 7.6 },
  { ingredientId: 'i2', supermarket: COTO, unitPrice: 8.2 },
  { ingredientId: 'i2', supermarket: CARREFOUR, unitPrice: 8.9 },
  // i3 · Tomate, per unit
  { ingredientId: 'i3', supermarket: COTO, unitPrice: 550 },
  { ingredientId: 'i3', supermarket: CARREFOUR, unitPrice: 590 },
  { ingredientId: 'i3', supermarket: DIA, unitPrice: 620 },
  // i4 · Cebolla, per unit
  { ingredientId: 'i4', supermarket: CARREFOUR, unitPrice: 450 },
  { ingredientId: 'i4', supermarket: COTO, unitPrice: 480 },
  { ingredientId: 'i4', supermarket: DIA, unitPrice: 520 },
  // i5 · Aceite de Oliva, per millilitre
  { ingredientId: 'i5', supermarket: COTO, unitPrice: 11.8 },
  { ingredientId: 'i5', supermarket: CARREFOUR, unitPrice: 12.6 },
  { ingredientId: 'i5', supermarket: DIA, unitPrice: 13.2 },
  // i6 · Fideos de Pasta, per gram
  { ingredientId: 'i6', supermarket: CARREFOUR, unitPrice: 3.2 },
  { ingredientId: 'i6', supermarket: COTO, unitPrice: 3.5 },
  { ingredientId: 'i6', supermarket: DIA, unitPrice: 3.6 },
  // i7 · Espinaca has no offer on purpose: it is the row that shows "Sin precio" and falls
  // under "Sin súper".
];
