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

export interface Ingredient {
  id: string;
  name: string;
  category: IngredientCategory;
  basePrice: number; // Precio promedio de mercado
  unit: UnitType;
}

export interface RecipeIngredient {
  ingredientId: string;
  amount: number;
}

export interface RecipeStep {
  order: number;
  instruction: string;
}

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

export interface MasterRecipe {
  id: string;
  name: string;
  description: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  estimatedCost: number;
  tags: string[]; // ['económica', 'vegetariana', 'rápida', etc.]
  imageUrl?: string;
  theme: RecipeThemeConfig;
}

export interface CustomizedRecipe extends MasterRecipe {
  originalRecipeId: string;
  isFavorite: boolean;
}

// Meal slot codes of the API contract, in the order of the day. Their Spanish labels are
// `MEAL_SLOT_LABEL`.
export const ORDERED_MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;

export type MealSlot = (typeof ORDERED_MEAL_SLOTS)[number];

export interface MealPlanEntry {
  id: string;
  date: string; // ISO string format YYYY-MM-DD
  type: MealSlot;
  recipeId: string; // Referencia a MasterRecipe o CustomizedRecipe
  isCooked: boolean;
  isSkipped?: boolean; // The meal passed and was not cooked. Never true together with isCooked.
}

export type BudgetLevel = 'muy barato' | 'estándar' | 'premium';

export interface UserPreferences {
  budgetMode: 'level' | 'total';
  budgetLevel?: BudgetLevel;
  totalBudget?: number;
  restrictions: string[]; // ['sin-gluten', 'vegano', etc.]
  preferences: string[]; // ['mediterranea', 'picante', etc.]
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface MealPlan {
  id: string;
  userId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  entries: MealPlanEntry[];
  status: 'draft' | 'active' | 'archived';
  createdAt: string;
}
