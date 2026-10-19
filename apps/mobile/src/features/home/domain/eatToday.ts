import type { MealPlanEntry, MealSlot } from '@/types/domain';
import type { CalendarMealDestination } from '../types/calendarApi';

export type EatTodayDestinationType = Extract<MealSlot, 'lunch' | 'dinner'>;

export const EAT_TODAY_DESTINATION_TYPES: EatTodayDestinationType[] = ['lunch', 'dinner'];

export const EAT_TODAY_CUTOFF_MINUTES: Record<EatTodayDestinationType, number> = {
  lunch: 15 * 60,
  dinner: 22 * 60,
};

export const EAT_TODAY_LABEL: Record<EatTodayDestinationType, string> = {
  lunch: 'Mediodía',
  dinner: 'Cena',
};

export function getAvailableEatTodayDestinations(
  todayEntries: MealPlanEntry[],
  now: Date
): EatTodayDestinationType[] {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return EAT_TODAY_DESTINATION_TYPES.filter((mealType) => {
    const cutoffMinutes = EAT_TODAY_CUTOFF_MINUTES[mealType];
    const todayEntry = todayEntries.find((entry) => entry.type === mealType);

    return currentMinutes < cutoffMinutes && !todayEntry?.isCooked;
  });
}

/**
 * The destinations whose meal has a Cooking session in progress. The server refuses to move a meal
 * being cooked (`calendar_meal_cooking_in_progress`), so the sheet shows them disabled.
 */
export function getCookingEatTodayDestinations(
  todayEntries: MealPlanEntry[]
): EatTodayDestinationType[] {
  return EAT_TODAY_DESTINATION_TYPES.filter(
    (mealType) => todayEntries.find((entry) => entry.type === mealType)?.isCooking === true
  );
}

export interface EatTodayParams {
  sourceDate: string;
  sourceType: MealPlanEntry['type'];
  targetDate: string;
  targetType: MealPlanEntry['type'];
}

export interface EatTodayMove extends CalendarMealDestination {
  mealId: string;
}

/**
 * What `POST /api/calendar/meals/:mealId/move` needs to move the source meal to the destination
 * slot: the id of that meal and where it goes. The server hands the destination's meal to the
 * slot the source leaves, so that meal is not named here. Returns null when nothing can move:
 * the source is missing, either meal is cooked or has a Cooking session in progress, or the
 * source is already at the destination.
 */
export function planEatTodayMove(
  entries: MealPlanEntry[],
  { sourceDate, sourceType, targetDate, targetType }: EatTodayParams
): EatTodayMove | null {
  const source = entries.find((entry) => entry.date === sourceDate && entry.type === sourceType);
  const target = entries.find((entry) => entry.date === targetDate && entry.type === targetType);

  if (
    !source ||
    source.isCooked ||
    source.isCooking ||
    target?.isCooked ||
    target?.isCooking ||
    target?.id === source.id
  ) {
    return null;
  }

  return { mealId: source.id, date: targetDate, slot: targetType };
}
