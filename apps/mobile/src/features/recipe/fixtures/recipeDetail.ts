import {
  RECIPE_INGREDIENT_CATEGORIES,
  RECIPE_SOURCES,
  RECIPE_UNITS,
  type Recipe,
} from '../types/recipe';
import recipeDetail from './recipeDetail.json';

function oneOf<T extends string>(allowed: readonly T[], value: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Unexpected fixture value: ${value}`);
  return match;
}

// A JSON import types its strings as `string`, so the union fields are narrowed here. Every
// other field of the frozen payload is checked against `Recipe` by the compiler.
export function fixtureRecipe(): Recipe {
  const { data } = recipeDetail;

  return {
    ...data,
    source: oneOf(RECIPE_SOURCES, data.source),
    ingredients: data.ingredients.map((line) => ({
      ...line,
      category: oneOf(RECIPE_INGREDIENT_CATEGORIES, line.category),
      unit: oneOf(RECIPE_UNITS, line.unit),
    })),
  };
}
