import type { Ingredient, UnitType } from '@/types/domain';

type IngredientCategory = Ingredient['category'];

// Order in which the category groups are listed on the screen.
export const CATEGORY_ORDER: IngredientCategory[] = [
  'lacteos',
  'verduras',
  'frutas',
  'proteinas',
  'despensa',
  'otros',
];

export const CATEGORY_TITLE: Record<IngredientCategory, string> = {
  lacteos: 'Lácteos',
  verduras: 'Verduras',
  frutas: 'Frutas',
  proteinas: 'Proteínas',
  despensa: 'Despensa',
  otros: 'Otros',
};

// Group of the items whose category is none of the listed ones.
export const FALLBACK_CATEGORY: IngredientCategory = 'otros';

// Group of the items no supermarket has an offer for.
export const NO_SUPERMARKET_GROUP_KEY = 'no-supermarket';
export const NO_SUPERMARKET_TITLE = 'Sin súper';

export const NO_PRICE_LABEL = 'Sin precio';

// Precision shared by the derivation and the display, so no listed amount reads as zero.
export const AMOUNT_DECIMALS = 2;

// From this amount on, a unit with a `large` label is written in it (1000 g -> 1 kg).
export const LARGE_UNIT_FACTOR = 1000;

export const UNIT_LABEL: Record<UnitType, { base: string; large?: string }> = {
  gramos: { base: 'g', large: 'kg' },
  mililitros: { base: 'ml', large: 'L' },
  unidades: { base: 'u' },
};

export const SHORT_MONTHS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];
