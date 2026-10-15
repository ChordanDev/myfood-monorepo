import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RecipeThemeProvider, useRecipeTheme } from '@/context/RecipeThemeContext';
import { getRecipe } from '@/features/recipe/api/recipeApi';
import { fixtureRecipe } from '@/features/recipe/fixtures/recipeDetail';
import { useRecipeCacheStore } from '@/features/recipe/store';
import type { Recipe } from '@/features/recipe/types/recipe';
import type { RecipeThemeConfig } from '@/types/domain';
import type { LocalMealSelection } from '../../domain/localMealPlan';
import { formatDateKey } from '../../utils/calendarDate';
import { useHomeRecipeTheme } from '../useHomeRecipeTheme';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/features/recipe/api/recipeApi', () => ({ getRecipe: jest.fn() }));

// The real provider is used on purpose: what is asserted is the palette the app ends up with.
const LUNCH_THEME: RecipeThemeConfig = {
  colorBlack: '#101010',
  colorDark: '#202020',
  colorMedium: '#303030',
  colorLight: '#404040',
  primaryAccent: '#ef9432',
  appBg: '#bcbfa7',
  icon: '#d8d98b',
  textBlack: '#050505',
  textDark: '#060606',
  textMedium: '#070707',
  textLight: '#080808',
  primaryAccentIntense: '#ef7a00',
  alert: '#c94f3d',
};

const DINNER_THEME: RecipeThemeConfig = { ...LUNCH_THEME, colorDark: '#2a1a0a', appBg: '#e0d0b0' };

const LUNCH_RECIPE: Recipe = {
  ...fixtureRecipe(),
  id: 'r-lunch',
  recipeVersionId: 'v-lunch',
  imageUrl: 'https://img.example/lunch.png',
  theme: LUNCH_THEME,
};

const DINNER_RECIPE: Recipe = {
  ...fixtureRecipe(),
  id: 'r-dinner',
  recipeVersionId: 'v-dinner',
  imageUrl: 'https://img.example/dinner.png',
  theme: DINNER_THEME,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = formatDateKey(new Date());
const YESTERDAY = formatDateKey(new Date(Date.now() - 2 * DAY_MS));
const TOMORROW = formatDateKey(new Date(Date.now() + 2 * DAY_MS));

const getRecipeMock = jest.mocked(getRecipe);

function buildMeal(recipeId: string, type: LocalMealSelection['type'] = 'lunch') {
  return {
    id: `entry-${recipeId}`,
    date: TODAY,
    type,
    recipeId,
    isCooked: false,
    description: '',
  } satisfies LocalMealSelection;
}

function cacheRecipes(...recipes: Recipe[]) {
  useRecipeCacheStore.setState({
    recipesByVersionId: Object.fromEntries(recipes.map((r) => [r.recipeVersionId, r])),
    versionIdByRecipeId: Object.fromEntries(recipes.map((r) => [r.id, r.recipeVersionId])),
  });
}

// A request the test answers when it chooses to.
function pendingRequest() {
  let resolve: (recipe: Recipe) => void = () => {};
  const request = new Promise<Recipe>((resolveRequest) => {
    resolve = resolveRequest;
  });

  return { request, resolve };
}

// Every tree a test mounts, unmounted after it so it does not react to the next test's cache.
const mountedTrees: ReactTestRenderer[] = [];

let activeTheme: RecipeThemeConfig;
let homeImageUrl: string | null;

function Harness({ meal, date }: { meal: LocalMealSelection | null; date: string | null }) {
  const { imageUrl } = useHomeRecipeTheme(meal, date);
  const { theme } = useRecipeTheme();
  useEffect(() => {
    activeTheme = theme;
    homeImageUrl = imageUrl;
  }, [imageUrl, theme]);
  return null;
}

function Tree({ meal, date }: { meal: LocalMealSelection | null; date: string | null }) {
  return (
    <RecipeThemeProvider>
      <Harness meal={meal} date={date} />
    </RecipeThemeProvider>
  );
}

function mount(meal: LocalMealSelection | null, date: string | null) {
  let tree: ReactTestRenderer;

  act(() => {
    tree = create(<Tree meal={meal} date={date} />);
  });
  mountedTrees.push(tree!);

  return tree!;
}

function defaultTheme(): RecipeThemeConfig {
  mount(null, TODAY);
  return activeTheme;
}

beforeEach(() => {
  useRecipeCacheStore.getState().clear();
  getRecipeMock.mockReset();
});

afterEach(() => {
  act(() => {
    mountedTrees.splice(0).forEach((tree) => tree.unmount());
  });
});

describe('useHomeRecipeTheme', () => {
  it("applies the palette and image of today's selected meal from the recipe cache", () => {
    cacheRecipes(LUNCH_RECIPE);

    mount(buildMeal('r-lunch'), TODAY);

    expect(activeTheme).toEqual(LUNCH_THEME);
    expect(homeImageUrl).toBe('https://img.example/lunch.png');
    expect(getRecipeMock).not.toHaveBeenCalled();
  });

  it('applies the palette of each meal of today on its own', () => {
    cacheRecipes(LUNCH_RECIPE, DINNER_RECIPE);
    const tree = mount(buildMeal('r-lunch'), TODAY);
    expect(activeTheme).toEqual(LUNCH_THEME);

    act(() => {
      tree.update(<Tree meal={buildMeal('r-dinner', 'dinner')} date={TODAY} />);
    });

    expect(activeTheme).toEqual(DINNER_THEME);
    expect(homeImageUrl).toBe('https://img.example/dinner.png');
  });

  it('fetches a recipe the cache does not hold, then applies its palette', async () => {
    const fallback = defaultTheme();
    const { request, resolve } = pendingRequest();
    getRecipeMock.mockReturnValue(request);

    mount(buildMeal('r-lunch'), TODAY);

    expect(getRecipeMock).toHaveBeenCalledWith('r-lunch');
    expect(activeTheme).toEqual(fallback);
    expect(homeImageUrl).toBeNull();

    await act(async () => {
      resolve(LUNCH_RECIPE);
      await request;
    });

    expect(activeTheme).toEqual(LUNCH_THEME);
    expect(homeImageUrl).toBe('https://img.example/lunch.png');
  });

  it('keeps the default palette when the fetch fails', async () => {
    const fallback = defaultTheme();
    getRecipeMock.mockRejectedValue(new Error('offline'));

    await act(async () => {
      mountedTrees.push(create(<Tree meal={buildMeal('r-lunch')} date={TODAY} />));
    });

    expect(getRecipeMock).toHaveBeenCalledWith('r-lunch');
    expect(activeTheme).toEqual(fallback);
    expect(homeImageUrl).toBeNull();
  });

  it('keeps the default palette and image when today has no selected meal, without fetching', () => {
    const fallback = defaultTheme();
    cacheRecipes(LUNCH_RECIPE);

    mount(null, TODAY);

    expect(activeTheme).toEqual(fallback);
    expect(homeImageUrl).toBeNull();
    expect(getRecipeMock).not.toHaveBeenCalled();
  });

  it('keeps the default palette and image for a past day, even when cached', () => {
    const fallback = defaultTheme();
    cacheRecipes(LUNCH_RECIPE);

    mount(buildMeal('r-lunch'), YESTERDAY);

    expect(activeTheme).toEqual(fallback);
    expect(activeTheme.appBg).not.toBe(LUNCH_THEME.appBg);
    expect(homeImageUrl).toBeNull();
  });

  it('keeps the default palette for a future day, without fetching', () => {
    const fallback = defaultTheme();

    mount(buildMeal('r-lunch'), TOMORROW);

    expect(activeTheme).toEqual(fallback);
    expect(getRecipeMock).not.toHaveBeenCalled();
  });

  it('keeps the default palette when the Recipe has no theme', () => {
    const fallback = defaultTheme();
    cacheRecipes({ ...LUNCH_RECIPE, theme: null });

    mount(buildMeal('r-lunch'), TODAY);

    expect(activeTheme).toEqual(fallback);
  });

  it('recolors when the user moves from today to another day and back', () => {
    const fallback = defaultTheme();
    cacheRecipes(LUNCH_RECIPE);
    const tree = mount(buildMeal('r-lunch'), TODAY);
    expect(activeTheme).toEqual(LUNCH_THEME);

    act(() => {
      tree.update(<Tree meal={buildMeal('r-lunch')} date={TOMORROW} />);
    });
    expect(activeTheme).toEqual(fallback);

    act(() => {
      tree.update(<Tree meal={buildMeal('r-lunch')} date={TODAY} />);
    });
    expect(activeTheme).toEqual(LUNCH_THEME);
  });
});
