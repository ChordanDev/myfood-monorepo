import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useMealPlanStore } from '@/store';
import { getCalendar } from '../api/calendarApi';
import { getCalendarWindow, toPlanEntries, toRecipeSummaries } from '../domain/calendarPlan';

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

/** Loads the live plan on mount and each time the app comes back to the foreground. */
export function useLoadLivePlan() {
  useEffect(() => {
    // The cache stays on screen when the read fails; the next launch or reconnect retries.
    const refresh = () => {
      loadLivePlan().catch(() => undefined);
    };

    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => subscription.remove();
  }, []);
}
