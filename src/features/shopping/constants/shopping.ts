import type { IngredientCategory } from '@/types/domain';

// The category groups are listed in `INGREDIENT_CATEGORIES` order, under the shared
// `INGREDIENT_CATEGORY_LABELS`. This is the group of the items whose category is not one of them.
export const FALLBACK_CATEGORY: IngredientCategory = 'otros';

// Group of the items no supermarket has an offer for.
export const NO_SUPERMARKET_GROUP_KEY = 'no-supermarket';
export const NO_SUPERMARKET_TITLE = 'Sin súper';

export const NO_PRICE_LABEL = 'Sin precio';

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
