import { useCallback } from 'react';
import { useMealPlanStore } from '@/store';
import { moveCalendarMeal } from '../api/calendarApi';
import { planEatTodayMove, type EatTodayParams } from '../domain/eatToday';
import { loadLivePlan } from './useLoadLivePlan';

/**
 * Moves a meal to today through `POST /api/calendar/meals/:mealId/move` and then re-reads the
 * calendar, so the plan on screen is the server's. Resolves to false when the move was not
 * confirmed: the cached plan does not allow it, and nothing is sent, or the server refused it or
 * did not answer, and the calendar is re-read all the same.
 */
export function useEatToday() {
  return useCallback(async (params: EatTodayParams): Promise<boolean> => {
    const move = planEatTodayMove(useMealPlanStore.getState().entries, params);

    if (!move) return false;

    try {
      await moveCalendarMeal(move.mealId, { date: move.date, slot: move.slot });
    } catch {
      // A refusal means the cached plan is not the server's any more (the meal is gone or
      // cooked), and a lost answer leaves open whether the move was done. The server's plan
      // settles both, so it is read before giving up.
      await loadLivePlan().catch(() => undefined);
      return false;
    }

    // The move is done on the server even if the refresh fails; the next read catches up.
    await loadLivePlan().catch(() => undefined);
    return true;
  }, []);
}
