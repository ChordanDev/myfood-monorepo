import type { Ingredient, MasterRecipe, RecipeIngredient } from '@/types/domain';
import type { Recipe, RecipeIngredientLine } from '../types/recipe';
import { MILLI_PER_UNIT } from './recipeFormat';

// Ticket R7 (#38) removes this module together with the flat `MasterRecipe` type: until then
// the meals of the local plan are drawn through the one shape the recipe screen knows.

export const UNKNOWN_INGREDIENT_NAME = 'Ingrediente desconocido';

export function toSentenceCase(name: string): string {
  const lowered = name.trim().toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

/**
 * A flat line carries only an id and an amount: its name and unit are the catalog's, and the
 * catalog counts in the units a recipe line does. A line whose ingredient left the catalog is
 * kept under a neutral name and counted in units, since nothing says what its amount measures.
 */
function toIngredientLine(
  { ingredientId, amount }: RecipeIngredient,
  catalogById: Map<string, Ingredient>
): RecipeIngredientLine {
  const ingredient = catalogById.get(ingredientId);

  return {
    ingredientId,
    name: ingredient ? toSentenceCase(ingredient.name) : UNKNOWN_INGREDIENT_NAME,
    category: null,
    quantityMilli: Math.round(amount * MILLI_PER_UNIT),
    unit: ingredient?.unit ?? 'unit',
  };
}

/** Describes a recipe of the local plan in the shape `GET /api/recipes/:id` serves. */
export function recipeFromMasterRecipe(recipe: MasterRecipe, catalog: Ingredient[]): Recipe {
  const catalogById = new Map(catalog.map((ingredient) => [ingredient.id, ingredient]));

  return {
    id: recipe.id,
    // A local recipe has no version on the server; the id only has to be stable.
    recipeVersionId: `local:${recipe.id}`,
    successorRecipeId: null,
    source: 'traditional',
    name: recipe.name,
    description: recipe.description,
    servings: null,
    durationMinutes: null,
    ingredients: recipe.ingredients.map((line) => toIngredientLine(line, catalogById)),
    steps: recipe.steps.map(({ order, instruction }) => ({
      order,
      text: instruction,
      durationMinutes: null,
    })),
    // The flat cost has no stated currency unit, so it is reported as unknown.
    estimatedCostCents: 0,
    tags: recipe.tags,
    imageUrl: recipe.imageUrl ?? null,
    theme: recipe.theme,
  };
}
