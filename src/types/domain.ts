/**
 * Tipos de dominio para la aplicación de planificación de comidas.
 * Basado en CONTEXT.md.
 */

export type UnitType = 'gramos' | 'mililitros' | 'unidades';

export interface Ingredient {
  id: string;
  name: string;
  category: 'verduras' | 'proteinas' | 'lacteos' | 'despensa' | 'frutas' | 'otros';
  basePrice: number; // Precio promedio de mercado
  unit: UnitType;
}

export interface InventoryItem {
  ingredientId: string;
  amount: number; // Cantidad aproximada
  isLeftover?: boolean;
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

export type MealType = 'desayuno' | 'almuerzo' | 'cena' | 'snack';

export interface MealPlanEntry {
  id: string;
  date: string; // ISO string format YYYY-MM-DD
  type: MealType;
  recipeId: string; // Referencia a MasterRecipe o CustomizedRecipe
  isCooked: boolean;
}

export interface ShoppingListItem {
  ingredientId: string;
  amountToBuy: number;
  isPurchased: boolean;
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
