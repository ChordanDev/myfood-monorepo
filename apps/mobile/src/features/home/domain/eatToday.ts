import type { MealPlanEntry } from '@/types/domain';
import type { CalendarRangeMeal, CalendarRangeReplacement } from '../types/calendarApi';
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

function toRangeMeal(entry: MealPlanEntry): CalendarRangeMeal {
  return {
    date: entry.date,
    slot: entry.type,
    recipeId: entry.recipeId,
    isCooked: entry.isCooked,
    ...(entry.selectedQuantity === undefined ? {} : { selectedQuantity: entry.selectedQuantity }),
  };
}

/**
 * The body of `PUT /api/calendar/meals/range` that moves the source meal to the destination
 * slot, handing the destination's meal to the source's slot. The server deletes every meal of
 * the range it is sent and inserts the given ones, so the range is the span of the two days and
 * the body holds every meal of that span, swapped or not. Returns null when nothing can move:
 * the source is missing or cooked, or the destination meal is cooked.
 */
export function planEatTodayReplacement(
  entries: MealPlanEntry[],
  { sourceDate, sourceType, targetDate, targetType }: EatTodayParams
): CalendarRangeReplacement | null {
  const source = entries.find((entry) => entry.date === sourceDate && entry.type === sourceType);
  const target = entries.find((entry) => entry.date === targetDate && entry.type === targetType);

  if (!source || source.isCooked || target?.isCooked) {
    return null;
  }

  const from = sourceDate < targetDate ? sourceDate : targetDate;
  const to = sourceDate < targetDate ? targetDate : sourceDate;

  const meals = entries
    .map((entry) => {
      if (entry.id === source.id) return { ...entry, date: targetDate, type: targetType };
      if (target && entry.id === target.id) return { ...entry, date: sourceDate, type: sourceType };
      return entry;
    })
    .filter((entry) => entry.date >= from && entry.date <= to)
    .map(toRangeMeal);

  return { from, to, meals };
}
