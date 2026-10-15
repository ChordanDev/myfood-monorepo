import { useCallback } from 'react';
import { getAuthErrorMessage, isApiError } from '@/api/errors';
import { useMealPlanStore } from '@/store';
import { moveCalendarMeal } from '../api/calendarApi';
import { planEatTodayMove, type EatTodayParams } from '../domain/eatToday';
import { loadLivePlan } from './useLoadLivePlan';

// The cached plan no longer has the meal where the User picked it, or it is cooked already.
const MOVE_NOT_ALLOWED_MESSAGE = 'Esta comida ya no se puede mover a hoy.';
// The move is done, but the plan on screen is still the one from before it.
const REFRESH_FAILED_MESSAGE =
  'La comida se movió, pero no pudimos actualizar tu plan. Se va a actualizar en un rato.';

export interface EatTodayResult {
  /** The server confirmed the move. */
  moved: boolean;
  /** What the User should read about how it went, in the app's words; null when all went well. */
  errorMessage: string | null;
}

/**
 * Moves a meal to today through `POST /api/calendar/meals/:mealId/move` and then re-reads the
 * calendar, so the plan on screen is the server's. The move is not confirmed when the cached plan
 * does not allow it, and nothing is sent; when the device is offline, and the plan is not re-read;
 * or when the server refused it or its answer was lost, and the calendar is re-read all the same.
 * Each of those, and a move whose re-read failed, comes with a message for the User.
 */
export function useEatToday() {
  return useCallback(async (params: EatTodayParams): Promise<EatTodayResult> => {
    const move = planEatTodayMove(useMealPlanStore.getState().entries, params);

    if (!move) return { moved: false, errorMessage: MOVE_NOT_ALLOWED_MESSAGE };

    try {
      await moveCalendarMeal(move.mealId, { date: move.date, slot: move.slot });
    } catch (error) {
      const errorMessage = getAuthErrorMessage(error);

      // `network_error` is a request that could not be sent: the device is offline, the server's
      // plan is the cached one, and a calendar read would only make the User wait for the same
      // failure. A timeout is not one of them: the move may have been done.
      if (isApiError(error) && error.code === 'network_error') {
        return { moved: false, errorMessage };
      }

      // A refusal means the cached plan is not the server's any more (the meal is gone or
      // cooked), and a lost answer leaves open whether the move was done. The server's plan
      // settles both, so it is read before giving up.
      await loadLivePlan().catch(() => undefined);
      return { moved: false, errorMessage };
    }

    // The move is done on the server even if the refresh fails; the next read catches up.
    try {
      await loadLivePlan();
      return { moved: true, errorMessage: null };
    } catch {
      return { moved: true, errorMessage: REFRESH_FAILED_MESSAGE };
    }
  }, []);
}
