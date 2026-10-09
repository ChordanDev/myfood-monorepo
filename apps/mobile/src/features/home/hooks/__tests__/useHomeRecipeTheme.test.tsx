import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RecipeThemeProvider, useRecipeTheme } from '@/context/RecipeThemeContext';
import type { RecipeThemeConfig } from '@/types/domain';
import type { LocalMealSelection } from '../../domain/localMealPlan';
import { formatDateKey } from '../../utils/calendarDate';
import { useHomeRecipeTheme } from '../useHomeRecipeTheme';

// The real provider is used on purpose: what is asserted is the palette the app ends up with.
const MEAL_THEME: RecipeThemeConfig = {
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

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = formatDateKey(new Date());
const YESTERDAY = formatDateKey(new Date(Date.now() - 2 * DAY_MS));
const TOMORROW = formatDateKey(new Date(Date.now() + 2 * DAY_MS));

function buildMeal(theme?: RecipeThemeConfig): LocalMealSelection {
  return {
    id: 'entry-1',
    date: TODAY,
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
    description: '',
    theme,
  };
}

let activeTheme: RecipeThemeConfig;

function Harness({ meal, date }: { meal: LocalMealSelection | null; date: string | null }) {
  useHomeRecipeTheme(meal, date);
  const { theme } = useRecipeTheme();
  useEffect(() => {
    activeTheme = theme;
  }, [theme]);
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

  return tree!;
}

function defaultTheme(): RecipeThemeConfig {
  mount(null, TODAY);
  return activeTheme;
}

describe('useHomeRecipeTheme', () => {
  it("applies the selected meal's theme when the selected day is today", () => {
    mount(buildMeal(MEAL_THEME), TODAY);

    expect(activeTheme).toEqual(MEAL_THEME);
  });

  it('keeps the default theme for a past day', () => {
    const fallback = defaultTheme();

    mount(buildMeal(MEAL_THEME), YESTERDAY);

    expect(activeTheme).toEqual(fallback);
    expect(activeTheme.appBg).not.toBe(MEAL_THEME.appBg);
  });

  it('keeps the default theme for a future day', () => {
    const fallback = defaultTheme();

    mount(buildMeal(MEAL_THEME), TOMORROW);

    expect(activeTheme).toEqual(fallback);
  });

  it('keeps the default theme when the meal has no theme', () => {
    const fallback = defaultTheme();

    mount(buildMeal(undefined), TODAY);

    expect(activeTheme).toEqual(fallback);
  });

  it('recolors when the user moves from today to another day and back', () => {
    const fallback = defaultTheme();
    const tree = mount(buildMeal(MEAL_THEME), TODAY);
    expect(activeTheme).toEqual(MEAL_THEME);

    act(() => {
      tree.update(<Tree meal={buildMeal(MEAL_THEME)} date={TOMORROW} />);
    });
    expect(activeTheme).toEqual(fallback);

    act(() => {
      tree.update(<Tree meal={buildMeal(MEAL_THEME)} date={TODAY} />);
    });
    expect(activeTheme).toEqual(MEAL_THEME);
  });
});
