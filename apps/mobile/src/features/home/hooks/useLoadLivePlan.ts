import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useRecipeCacheStore } from '@/features/recipe/store';
import { useMealPlanStore } from '@/store';
import { getCalendar } from '../api/calendarApi';
import { getCalendarWindow, toPlanEntries, toRecipeSummaries } from '../domain/calendarPlan';
import { formatDateKey } from '../utils/calendarDate';

/**
 * Reads the live plan from `GET /api/calendar` and replaces the cached one with it. The store is
 * only a cache of that answer: a failed read leaves what was cached untouched.
 */
export async function loadLivePlan(now: Date = new Date()): Promise<void> {
  const calendar = await getCalendar(getCalendarWindow(now));
  const { setPlan, setRecipeSummaries } = useMealPlanStore.getState();

  setRecipeSummaries(toRecipeSummaries(calendar.meals));
  setPlan(toPlanEntries(calendar.meals));
}

/**
 * Loads the Recipes of today's meals into the recipe cache, so Home applies their palette
 * without first showing the default one. A failed load is left for Home to retry.
 */
function prefetchTodayRecipes(now: Date = new Date()) {
  const todayKey = formatDateKey(now);
  const recipeIds = useMealPlanStore
    .getState()
    .entries.filter((entry) => entry.date === todayKey)
    .map((entry) => entry.recipeId);
  const { loadRecipe } = useRecipeCacheStore.getState();

  new Set(recipeIds).forEach((recipeId) => {
    loadRecipe(recipeId).catch(() => undefined);
  });
}

/** Loads the live plan on mount and each time the app comes back to the foreground. */
export function useLoadLivePlan() {
  useEffect(() => {
    // The cache stays on screen when the read fails; the next launch or reconnect retries.
    const refresh = () => {
      loadLivePlan()
        .then(() => prefetchTodayRecipes())
        .catch(() => undefined);
    };

    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => subscription.remove();
  }, []);
}
