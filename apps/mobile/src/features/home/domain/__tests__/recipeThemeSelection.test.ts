import type { RecipeThemeConfig } from '@/types/domain';
import type { LocalMealSelection } from '../localMealPlan';
import { getThemeForLocalMealSelection } from '../recipeThemeSelection';

const THEME: RecipeThemeConfig = {
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

function buildSelection(theme?: RecipeThemeConfig): LocalMealSelection {
  return {
    id: 'entry-1',
    date: '2026-10-08',
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
    description: '',
    theme,
  };
}

describe('getThemeForLocalMealSelection', () => {
  it('returns the theme the selected meal carries', () => {
    expect(getThemeForLocalMealSelection(buildSelection(THEME))).toBe(THEME);
  });

  it('returns null, meaning the default theme, when the meal has no theme', () => {
    expect(getThemeForLocalMealSelection(buildSelection(undefined))).toBeNull();
  });

  it('returns null when no meal is selected', () => {
    expect(getThemeForLocalMealSelection(null)).toBeNull();
  });
});
