import type { LocalMealSelection } from './localMealPlan';

export function getThemeForLocalMealSelection(selectedMeal: LocalMealSelection | null) {
  return selectedMeal?.theme ?? null;
}
