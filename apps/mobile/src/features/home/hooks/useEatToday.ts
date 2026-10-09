import { useCallback } from 'react';
import { useMealPlanStore } from '@/store';
import { replaceCalendarRange } from '../api/calendarApi';
import { planEatTodayReplacement, type EatTodayParams } from '../domain/eatToday';
import { loadLivePlan } from './useLoadLivePlan';

/**
 * Moves a meal to today through `PUT /api/calendar/meals/range` and then re-reads the calendar,
 * so the plan on screen is the server's. Resolves to false when nothing moved: the swap is not
 * allowed or the server refused it, and the cached plan is left as it was.
 */
export function useEatToday() {
  return useCallback(async (params: EatTodayParams): Promise<boolean> => {
    const replacement = planEatTodayReplacement(useMealPlanStore.getState().entries, params);

    if (!replacement) return false;

    try {
      await replaceCalendarRange(replacement);
    } catch {
      return false;
    }

    // The move is done on the server even if the refresh fails; the next read catches up.
    await loadLivePlan().catch(() => undefined);
    return true;
  }, []);
}
