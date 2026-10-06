import type { MealPlanEntry } from '@/types/domain';
import type { HomeMealType } from './localMealPlan';

export type EatTodayDestinationType = Extract<HomeMealType, 'almuerzo' | 'cena'>;

export const EAT_TODAY_DESTINATION_TYPES: EatTodayDestinationType[] = ['almuerzo', 'cena'];

export const EAT_TODAY_CUTOFF_MINUTES: Record<EatTodayDestinationType, number> = {
  almuerzo: 15 * 60,
  cena: 22 * 60,
};

export const EAT_TODAY_LABEL: Record<EatTodayDestinationType, string> = {
  almuerzo: 'Mediodía',
  cena: 'Cena',
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
