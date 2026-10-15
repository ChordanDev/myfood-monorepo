import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useRecipeCacheStore } from '@/features/recipe/store';
import { useMealPlanStore } from '@/store';
import { getCalendar } from '../api/calendarApi';
import { getCalendarWindow, toPlanEntries, toRecipeSummaries } from '../domain/calendarPlan';
import { formatDateKey } from '../utils/calendarDate';

// Counts the reads started, so an answer that arrives after the one of a later read is dropped:
// the later read may follow a change the earlier one did not see.
let latestReadId = 0;
// The read the mounted callers share while it is on its way.
let sharedRead: Promise<void> | null = null;

/**
 * Reads the live plan from `GET /api/calendar` and replaces the cached one with it. The store is
 * only a cache of that answer: a failed read leaves what was cached untouched, and so does an
 * answer that arrives after the one of a later read.
 */
export async function loadLivePlan(now: Date = new Date()): Promise<void> {
  latestReadId += 1;
  const readId = latestReadId;
  const calendar = await getCalendar(getCalendarWindow(now));
  if (readId !== latestReadId) return;
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

// Home and the Planner both mount the hook: they wait for one read instead of firing one each.
function refreshLivePlan(): Promise<void> {
  sharedRead ??= loadLivePlan().finally(() => {
    sharedRead = null;
  });
  return sharedRead;
}

/** Loads the live plan on mount and each time the app comes back to the foreground. */
export function useLoadLivePlan() {
  useEffect(() => {
    // The cache stays on screen when the read fails; the next launch or reconnect retries.
    const refresh = () => {
      refreshLivePlan()
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
