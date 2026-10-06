import type { MasterRecipe, MealPlanEntry, MealType, RecipeThemeConfig } from '@/types/domain';

export type HomeMealType = Extract<MealType, 'desayuno' | 'almuerzo' | 'cena'>;

export type LocalMealPlanByDate = Record<string, MealPlanEntry[]>;

export type LocalMealSelection = MealPlanEntry & {
  description: string;
  imageUrl?: string;
  theme?: RecipeThemeConfig;
};

const ORDERED_HOME_MEAL_TYPES: HomeMealType[] = ['desayuno', 'almuerzo', 'cena'];

const MEAL_TYPE_MINUTES: Record<HomeMealType, number> = {
  desayuno: 8 * 60,
  almuerzo: 13 * 60,
  cena: 20 * 60,
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

export function getAvailableHomeMealTypes(entries: MealPlanEntry[]): HomeMealType[] {
  const types = new Set(entries.map((entry) => entry.type));
  return ORDERED_HOME_MEAL_TYPES.filter((type) => types.has(type));
}

export function getClosestHomeMealType(availableMealTypes: HomeMealType[], now: Date) {
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

export function getDefaultHomeMealType(entries: MealPlanEntry[], now: Date): HomeMealType | null {
  const uncookedMealTypes = getAvailableHomeMealTypes(entries.filter((entry) => !entry.isCooked));

  return (
    getClosestHomeMealType(uncookedMealTypes, now) ??
    getClosestHomeMealType(getAvailableHomeMealTypes(entries), now)
  );
}

export function getSelectedLocalMeal(
  entries: MealPlanEntry[],
  recipes: MasterRecipe[],
  selectedMealType: HomeMealType | null
): LocalMealSelection | null {
  if (!selectedMealType) {
    return null;
  }

  const selectedEntry = entries.find((entry) => entry.type === selectedMealType);

  if (!selectedEntry) {
    return null;
  }

  const recipe = recipes.find((candidate) => candidate.id === selectedEntry.recipeId);

  return {
    ...selectedEntry,
    description: recipe?.description ?? 'Sin descripción',
    imageUrl: recipe?.imageUrl,
    theme: recipe?.theme,
  };
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

export function getPendingHomeMealType(entries: MealPlanEntry[]): HomeMealType | null {
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
