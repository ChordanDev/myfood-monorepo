import { INGREDIENT_CATEGORY_LABELS } from '@/constants/ingredientCategories';
import { INGREDIENT_CATEGORIES, type IngredientCategory } from '@/types/domain';
import type { ShoppingMealSlot } from '../types';

// Group of the lines whose category has no title here.
export const FALLBACK_CATEGORY: IngredientCategory = 'otros';

// Categories the server files an ingredient under that the rest of the app does not have.
const SERVER_ONLY_CATEGORY_LABELS = {
  granos: 'Granos',
  no_perecederos: 'No perecederos',
};

// Title of every category a line can be grouped under.
export const SHOPPING_CATEGORY_LABELS: Record<string, string> = {
  ...INGREDIENT_CATEGORY_LABELS,
  ...SERVER_ONLY_CATEGORY_LABELS,
};

// Order of the category groups: the one the categories are listed in everywhere, then the
// ones only the server has, and the fallback group last.
export const SHOPPING_CATEGORIES: string[] = [
  ...INGREDIENT_CATEGORIES.filter((category) => category !== FALLBACK_CATEGORY),
  ...Object.keys(SERVER_ONLY_CATEGORY_LABELS),
  FALLBACK_CATEGORY,
];

// The longest name the server takes for an item added by hand. It counts codepoints and a
// text input counts UTF-16 units, so a name that fits the input always fits the server.
export const MANUAL_ITEM_NAME_MAX_LENGTH = 200;

export const SHOPPING_SLOT_LABELS: Record<ShoppingMealSlot, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  snack: 'Merienda',
  dinner: 'Cena',
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
