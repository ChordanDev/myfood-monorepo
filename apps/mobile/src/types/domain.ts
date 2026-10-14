/**
 * Tipos de dominio para la aplicación de planificación de comidas.
 * Basado en CONTEXT.md.
 */

export type UnitType = 'g' | 'ml' | 'unit';

// Categories allowed by the inventory PRD, in display order
export const INGREDIENT_CATEGORIES = [
  'verduras',
  'frutas',
  'carnes',
  'pescados_mariscos',
  'lacteos',
  'panaderia',
  'almacen',
  'congelados',
  'bebidas',
  'condimentos',
  'limpieza_otros',
  'otros',
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export interface RecipeThemeConfig {
  colorBlack: string;
  colorDark: string;
  colorMedium: string;
  colorLight: string;
  primaryAccent: string;
  appBg: string;
  appBgGradient?: [string, string];
  icon: string;
  textBlack: string;
  textDark: string;
  textMedium: string;
  textLight: string;
  primaryAccentIntense: string;
  alert: string;
}

// Meal slot codes of the API contract, in the order of the day. Their Spanish labels are
// `MEAL_SLOT_LABEL`.
export const ORDERED_MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;

export type MealSlot = (typeof ORDERED_MEAL_SLOTS)[number];

export interface MealPlanEntry {
  id: string;
  date: string; // ISO string format YYYY-MM-DD
  type: MealSlot;
  recipeId: string; // Id of the recipe, as `GET /api/recipes/:id` names it.
  isCooked: boolean;
  isSkipped?: boolean; // The meal passed and was not cooked. Never true together with isCooked.
  selectedQuantity?: number | null; // Servings the server holds for the meal.
}

// What the calendar read says about a recipe of the plan: enough to name it on Home. The full
// recipe is read from `GET /api/recipes/:id` when it is opened.
export interface RecipeSummary {
  name: string;
  isFavorite: boolean;
  prepTimeMinutes: number | null;
  calories: number | null;
}

export type BudgetLevel = 'muy barato' | 'estándar' | 'premium';

export interface MealPlan {
  id: string;
  userId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  entries: MealPlanEntry[];
  status: 'draft' | 'active' | 'archived';
  createdAt: string;
}
