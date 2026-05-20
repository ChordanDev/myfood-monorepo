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
  // Colores para el FoodCard (SVG Gradient)
  foodCardGradient: [string, string]; // [Color1, Color2]

  // Colores de la UI Global (Home)
  primaryAccent: string; // Botones, iconos destacados
  appBgGradient: [string, string, string]; // Colores para el fondo [Top, Middle, Bottom]
  calendarBg: string; // Fondo del contenedor del calendario
  calendarDayActive: string; // Círculo del día seleccionado
  textMain: string; // Color de los textos de la receta (en la card)
  tabIconBgInactive: string; // Color de los iconos de las tabs
  tabIconBgActive: string; // Color de los iconos de las tabs cuando están activos
  tabOvalBg: string; // Fondo del óvalo animado de las tabs
  tabOvalBorder: string; // Borde del óvalo animado de las tabs
  tabBarGradient: [string, string]; // Gradiente para el fondo de la tab bar (opcional, si no se usa el default)
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
