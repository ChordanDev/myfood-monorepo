import React, { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import { RecipeThemeProvider, useRecipeTheme } from '@/context/RecipeThemeContext';
import { fixtureRecipe } from '@/features/recipe/fixtures/recipeDetail';
import { useActivateRecipePalette } from '@/features/recipe/hooks/useActivateRecipePalette';
import type { Recipe } from '@/features/recipe/types/recipe';
import type { RecipeThemeConfig } from '@/types/domain';

// The palette a Recipe payload carries, in the shape the API serves it (camelCase, thirteen
// required tokens).
const PAYLOAD_THEME: RecipeThemeConfig = {
  colorBlack: '#2b2f1e',
  colorDark: '#3b3f2a',
  colorMedium: '#6f7458',
  colorLight: '#8d9373',
  primaryAccent: '#ef9432',
  appBg: '#bcbfa7',
  icon: '#d8d98b',
  textBlack: '#1e2014',
  textDark: '#262916',
  textMedium: '#d8d98b',
  textLight: '#f1f2e4',
  primaryAccentIntense: '#ef7a00',
  alert: '#c94f3d',
};

let activeTheme: RecipeThemeConfig;

function RecipeInView({ recipe }: { recipe: Recipe | undefined }) {
  useActivateRecipePalette(recipe?.theme);
  const { theme } = useRecipeTheme();
  useEffect(() => {
    activeTheme = theme;
  }, [theme]);
  return null;
}

function mount(recipe: Recipe | undefined) {
  return act(() => {
    create(
      <RecipeThemeProvider>
        <RecipeInView recipe={recipe} />
      </RecipeThemeProvider>
    );
  });
}

function defaultTheme(): RecipeThemeConfig {
  mount(undefined);
  return activeTheme;
}

describe('the app palette comes from the recipe payload', () => {
  it('paints the app with the theme the recipe payload carries', () => {
    mount({ ...fixtureRecipe(), theme: PAYLOAD_THEME });

    expect(activeTheme).toEqual(PAYLOAD_THEME);
  });

  it('paints the app with the default theme when the payload theme is null', () => {
    const fallback = defaultTheme();
    const recipe = fixtureRecipe();
    expect(recipe.theme).toBeNull();

    mount(recipe);

    expect(activeTheme).toEqual(fallback);
    expect(activeTheme.appBg).not.toBe(PAYLOAD_THEME.appBg);
  });

  it('does not carry the palette of a previous recipe over to a recipe without a theme', () => {
    const fallback = defaultTheme();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <RecipeThemeProvider>
          <RecipeInView recipe={{ ...fixtureRecipe(), theme: PAYLOAD_THEME }} />
        </RecipeThemeProvider>
      );
    });
    expect(activeTheme).toEqual(PAYLOAD_THEME);

    act(() => {
      tree.update(
        <RecipeThemeProvider>
          <RecipeInView recipe={fixtureRecipe()} />
        </RecipeThemeProvider>
      );
    });

    expect(activeTheme).toEqual(fallback);
  });
});
