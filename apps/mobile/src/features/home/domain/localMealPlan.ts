import type { MealPlanEntry, MealSlot, RecipeSummary } from '@/types/domain';

type RecipeSummaries = Record<string, RecipeSummary>;

export type LocalMealPlanByDate = Record<string, MealPlanEntry[]>;

// The palette and image of the meal come from its Recipe, through `useHomeRecipeTheme`.
export type LocalMealSelection = MealPlanEntry & {
  description: string;
};

export type HomeMealSummary = {
  id: string;
  type: MealSlot;
  name: string;
};

const ORDERED_HOME_MEAL_TYPES: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

const MEAL_TYPE_MINUTES: Record<MealSlot, number> = {
  breakfast: 8 * 60,
  lunch: 13 * 60,
  dinner: 20 * 60,
};

export function buildLocalMealPlanByDate(entries: MealPlanEntry[]): LocalMealPlanByDate {
  return entries.reduce<LocalMealPlanByDate>((planByDate, entry) => {
    planByDate[entry.date] = [...(planByDate[entry.date] ?? []), entry];
    return planByDate;
  }, {});
}

export function getInitialSelectedDate(availableDateKeys: string[], todayKey: string) {
  if (availableDateKeys.includes(todayKey)) {
    return todayKey;
  }

  return availableDateKeys[0] ?? todayKey;
}

export function getAvailableHomeMealTypes(entries: MealPlanEntry[]): MealSlot[] {
  const types = new Set(entries.map((entry) => entry.type));
  return ORDERED_HOME_MEAL_TYPES.filter((type) => types.has(type));
}

export function getClosestHomeMealType(availableMealTypes: MealSlot[], now: Date) {
  if (!availableMealTypes.length) {
    return null;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return availableMealTypes.reduce((closestType, currentType) => {
    const currentDistance = Math.abs(MEAL_TYPE_MINUTES[currentType] - currentMinutes);
    const closestDistance = Math.abs(MEAL_TYPE_MINUTES[closestType] - currentMinutes);
    return currentDistance < closestDistance ? currentType : closestType;
  });
}

export function getDefaultHomeMealType(entries: MealPlanEntry[], now: Date): MealSlot | null {
  const uncookedMealTypes = getAvailableHomeMealTypes(entries.filter((entry) => !entry.isCooked));

  return (
    getClosestHomeMealType(uncookedMealTypes, now) ??
    getClosestHomeMealType(getAvailableHomeMealTypes(entries), now)
  );
}

export function getSelectedLocalMeal(
  entries: MealPlanEntry[],
  selectedMealType: MealSlot | null
): LocalMealSelection | null {
  if (!selectedMealType) {
    return null;
  }

  const selectedEntry = entries.find((entry) => entry.type === selectedMealType);

  if (!selectedEntry) {
    return null;
  }

  // The calendar read carries no description for a meal.
  return { ...selectedEntry, description: 'Sin descripción' };
}

export function getHomeMealSummaries(
  entries: MealPlanEntry[],
  summaries: RecipeSummaries = {}
): HomeMealSummary[] {
  return ORDERED_HOME_MEAL_TYPES.flatMap((type) =>
    entries
      .filter((entry) => entry.type === type)
      .map((entry) => ({
        id: entry.id,
        type,
        name: summaries[entry.recipeId]?.name ?? 'Receta sin nombre',
      }))
  );
}

export function getAllowedMonthKeys(planByDate: LocalMealPlanByDate) {
  const monthKeys = Object.keys(planByDate)
    .filter((dateKey) => Boolean(planByDate[dateKey]?.length))
    .map((dateKey) => dateKey.slice(0, 7));

  return Array.from(new Set(monthKeys)).sort();
}

export function isMealConfirmed(entry: MealPlanEntry) {
  return entry.isCooked || Boolean(entry.isSkipped);
}

export function getPendingConfirmationEntries(entries: MealPlanEntry[]) {
  return ORDERED_HOME_MEAL_TYPES.flatMap((type) =>
    entries.filter((entry) => entry.type === type && !isMealConfirmed(entry))
  );
}

export function getPendingHomeMealType(entries: MealPlanEntry[]): MealSlot | null {
  return getAvailableHomeMealTypes(getPendingConfirmationEntries(entries))[0] ?? null;
}

export function isPendingConfirmationDate(
  dateString: string,
  planByDate: LocalMealPlanByDate,
  today: Date,
  parseDateKey: (dateString: string) => Date
) {
  return (
    parseDateKey(dateString) < today &&
    getPendingConfirmationEntries(planByDate[dateString] ?? []).length > 0
  );
}

export function isSelectableMealDate(
  dateString: string,
  planByDate: LocalMealPlanByDate,
  today: Date,
  parseDateKey: (dateString: string) => Date
) {
  if (parseDateKey(dateString) < today) {
    return isPendingConfirmationDate(dateString, planByDate, today, parseDateKey);
  }

  return Boolean(planByDate[dateString]?.length);
}
