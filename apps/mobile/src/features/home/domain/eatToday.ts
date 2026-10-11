import type { MealPlanEntry } from '@/types/domain';
import type { CalendarMealDestination } from '../types/calendarApi';
import type { HomeMealSlot } from './localMealPlan';

export type EatTodayDestinationType = Extract<HomeMealSlot, 'lunch' | 'dinner'>;

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
 * the source is missing or cooked, the destination meal is cooked, or the source is already at
 * the destination.
 */
export function planEatTodayMove(
  entries: MealPlanEntry[],
  { sourceDate, sourceType, targetDate, targetType }: EatTodayParams
): EatTodayMove | null {
  const source = entries.find((entry) => entry.date === sourceDate && entry.type === sourceType);
  const target = entries.find((entry) => entry.date === targetDate && entry.type === targetType);

  if (!source || source.isCooked || target?.isCooked || target?.id === source.id) {
    return null;
  }

  return { mealId: source.id, date: targetDate, slot: targetType };
}
