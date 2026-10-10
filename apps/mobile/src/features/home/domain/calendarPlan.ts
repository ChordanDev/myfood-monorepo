import type { MealPlanEntry, RecipeSummary } from '@/types/domain';
import type { CalendarMeal } from '../types/calendarApi';

const DAYS_BEFORE_TODAY = 31;
const DAYS_AFTER_TODAY = 90;

function toDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The days the app asks the calendar for: a month back, so meals still waiting for a
 * confirmation are found, and three months ahead. Centered on the device's day only to size
 * the window; which day is "today" for the plan is the server's.
 */
export function getCalendarWindow(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS_BEFORE_TODAY);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DAYS_AFTER_TODAY);

  return { startDate: toDateKey(start), endDate: toDateKey(end) };
}

/** The meals of the plan: slots without a recipe are not meals the User can see or cook. */
export function toPlanEntries(meals: CalendarMeal[]): MealPlanEntry[] {
  return meals.flatMap((meal) =>
    meal.recipeId === null
      ? []
      : [
          {
            id: meal.mealId,
            date: meal.date,
            type: meal.slot,
            recipeId: meal.recipeId,
            isCooked: meal.isCooked,
            selectedQuantity: meal.selectedQuantity,
          },
        ]
  );
}

export function toRecipeSummaries(meals: CalendarMeal[]): Record<string, RecipeSummary> {
  const summaries: Record<string, RecipeSummary> = {};

  for (const meal of meals) {
    if (meal.recipeId === null || meal.recipeName === null) continue;

    summaries[meal.recipeId] = {
      name: meal.recipeName,
      isFavorite: meal.isFavorite,
      prepTimeMinutes: meal.prepTimeMinutes,
      calories: meal.macros?.calories ?? null,
    };
  }

  return summaries;
}
