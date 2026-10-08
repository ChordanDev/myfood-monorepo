import type { RecipeThemeConfig } from '@/types/domain';

export const RECIPE_SOURCES = ['traditional', 'ai_generated', 'user_created'] as const;

export type RecipeSource = (typeof RECIPE_SOURCES)[number];

export const RECIPE_UNITS = ['g', 'ml', 'unit'] as const;

export type RecipeUnit = (typeof RECIPE_UNITS)[number];

// Categories of the API ingredient catalog. They are not the inventory's `IngredientCategory`.
export const RECIPE_INGREDIENT_CATEGORIES = [
  'lacteos',
  'frutas',
  'verduras',
  'carnes',
  'granos',
  'congelados',
  'no_perecederos',
  'otros',
] as const;

export type RecipeIngredientCategory = (typeof RECIPE_INGREDIENT_CATEGORIES)[number];

export interface RecipeIngredientLine {
  ingredientId: string;
  name: string;
  // Read from the ingredient when the recipe is served; null once the ingredient is gone.
  category: RecipeIngredientCategory | null;
  // Integer, in thousandths of `unit`: 500000 with `g` is 500 g.
  quantityMilli: number;
  unit: RecipeUnit;
}

export interface RecipePreparationStep {
  order: number;
  text: string;
  durationMinutes: number | null;
}

/**
 * Frozen version of a recipe, as `GET /api/recipes/:id` serves it. A recipe id always answers
 * the same `recipeVersionId`: a correction is another recipe, named by `successorRecipeId`.
 */
export interface Recipe {
  id: string;
  recipeVersionId: string;
  successorRecipeId: string | null;
  source: RecipeSource;
  name: string;
  description: string | null;
  // Servings the quantities are for. They are not scaled.
  servings: number | null;
  // Preparation plus cooking time; null when the recipe has neither.
  durationMinutes: number | null;
  ingredients: RecipeIngredientLine[];
  steps: RecipePreparationStep[];
  // Integer cents; 0 when no cost is known.
  estimatedCostCents: number;
  tags: string[];
  imageUrl: string | null;
  theme: RecipeThemeConfig | null;
}
