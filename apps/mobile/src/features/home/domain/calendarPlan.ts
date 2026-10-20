import { MEAL_SLOT_LABEL } from '@/constants/mealSlots';
import type { MealPlanEntry, MealSlot, RecipeSummary } from '@/types/domain';
import { CALENDAR_DOT_SLOTS, WEEKDAY_NAMES } from '../constants/calendar';
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
            isSkipped: meal.isSkipped ?? false,
            isCooking: meal.isCooking ?? false,
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

/** The slots of a day that hold a Scheduled meal, in the calendar's order. */
export function getPlannedSlots(entries: MealPlanEntry[] | undefined): MealSlot[] {
  const types = new Set(entries?.map((entry) => entry.type));
  return CALENDAR_DOT_SLOTS.filter((slot) => types.has(slot));
}

function joinSlotNames(slots: MealSlot[]) {
  const names = slots.map((slot) => MEAL_SLOT_LABEL[slot].toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0];
}

/** What a screen reader says for a calendar day, such as "martes 14, desayuno y cena planificados". */
export function describeDayForAccessibility(dayDate: Date, plannedSlots: MealSlot[]) {
  const day = `${WEEKDAY_NAMES[dayDate.getDay()]} ${dayDate.getDate()}`;

  if (!plannedSlots.length) {
    return `${day}, sin comidas planificadas`;
  }

  // "Cena" is the one feminine slot name: alone it takes the feminine form.
  const planned =
    plannedSlots.length > 1
      ? 'planificados'
      : plannedSlots[0] === 'dinner'
        ? 'planificada'
        : 'planificado';

  return `${day}, ${joinSlotNames(plannedSlots)} ${planned}`;
}
