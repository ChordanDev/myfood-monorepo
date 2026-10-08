import type { Ingredient, MasterRecipe, RecipeThemeConfig } from '@/types/domain';
import { recipeFromMasterRecipe, toSentenceCase } from './recipeFromMasterRecipe';

const CATALOG: Ingredient[] = [
  { id: 'i1', name: 'Arroz Blanco', category: 'almacen', basePrice: 2, unit: 'g' },
  { id: 'i3', name: 'Tomate', category: 'verduras', basePrice: 3, unit: 'unit' },
  { id: 'i5', name: 'Aceite de Oliva', category: 'almacen', basePrice: 15, unit: 'ml' },
];

const THEME = { appBg: '#bcbfa7' } as RecipeThemeConfig;

const MASTER_RECIPE: MasterRecipe = {
  id: 'r1',
  name: 'Pollo con Arroz y Tomate',
  description: 'Una receta clásica.',
  estimatedCost: 15.5,
  tags: ['económica', 'rápida'],
  ingredients: [
    { ingredientId: 'i1', amount: 100 },
    { ingredientId: 'i3', amount: 2 },
    { ingredientId: 'i5', amount: 10 },
  ],
  steps: [
    { order: 1, instruction: 'Cocinar el arroz.' },
    { order: 2, instruction: 'Servir.' },
  ],
  imageUrl: 'recipes/r1.png',
  theme: THEME,
};

function convert(overrides: Partial<MasterRecipe> = {}) {
  return recipeFromMasterRecipe({ ...MASTER_RECIPE, ...overrides }, CATALOG);
}

describe('toSentenceCase', () => {
  it('uppercases only the first letter', () => {
    expect(toSentenceCase('Arroz Blanco')).toBe('Arroz blanco');
    expect(toSentenceCase('aceite de OLIVA')).toBe('Aceite de oliva');
  });

  it('lowercases the text inside parentheses', () => {
    expect(toSentenceCase('Pollo (Pechuga)')).toBe('Pollo (pechuga)');
  });

  it('trims surrounding whitespace', () => {
    expect(toSentenceCase('  Tomate  ')).toBe('Tomate');
  });

  it('returns an empty string for blank input', () => {
    expect(toSentenceCase('   ')).toBe('');
  });
});

describe('recipeFromMasterRecipe', () => {
  it('describes a flat recipe in the shape the API serves', () => {
    expect(convert()).toEqual({
      id: 'r1',
      recipeVersionId: 'local:r1',
      successorRecipeId: null,
      source: 'traditional',
      name: 'Pollo con Arroz y Tomate',
      description: 'Una receta clásica.',
      servings: null,
      durationMinutes: null,
      ingredients: [
        {
          ingredientId: 'i1',
          name: 'Arroz blanco',
          category: null,
          quantityMilli: 100000,
          unit: 'g',
        },
        { ingredientId: 'i3', name: 'Tomate', category: null, quantityMilli: 2000, unit: 'unit' },
        {
          ingredientId: 'i5',
          name: 'Aceite de oliva',
          category: null,
          quantityMilli: 10000,
          unit: 'ml',
        },
      ],
      steps: [
        { order: 1, text: 'Cocinar el arroz.', durationMinutes: null },
        { order: 2, text: 'Servir.', durationMinutes: null },
      ],
      estimatedCostCents: 0,
      tags: ['económica', 'rápida'],
      imageUrl: 'recipes/r1.png',
      theme: THEME,
    });
  });

  it('keeps the palette object of the flat recipe, so it is not activated twice', () => {
    expect(convert().theme).toBe(THEME);
  });

  it('writes fractional amounts as whole thousandths, without floating point noise', () => {
    const { ingredients } = convert({
      ingredients: [
        { ingredientId: 'i3', amount: 0.5 },
        { ingredientId: 'i1', amount: 0.1 + 0.2 },
      ],
    });

    expect(ingredients.map((line) => line.quantityMilli)).toEqual([500, 300]);
  });

  it('keeps a line whose ingredient left the catalog, under a neutral name and counted in units', () => {
    const { ingredients } = convert({ ingredients: [{ ingredientId: 'ghost', amount: 3 }] });

    expect(ingredients).toEqual([
      {
        ingredientId: 'ghost',
        name: 'Ingrediente desconocido',
        category: null,
        quantityMilli: 3000,
        unit: 'unit',
      },
    ]);
  });

  it('reports no known cost, whatever the flat recipe says', () => {
    expect(convert({ estimatedCost: 15.5 }).estimatedCostCents).toBe(0);
    expect(convert({ estimatedCost: 0 }).estimatedCostCents).toBe(0);
  });

  it('has no image when the flat recipe has none', () => {
    expect(convert({ imageUrl: undefined }).imageUrl).toBeNull();
  });
});
