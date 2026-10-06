import type { MealPlanEntry } from '@/types/domain';

type ResolveRecipeEntryArgs = {
  entries: MealPlanEntry[];
  recipeId: string;
  /** The planned meal the screen was opened for, when the route carries it. */
  entryId?: string | null;
  todayKey: string;
};

/**
 * Finds the planned meal a recipe screen stands for. The same recipe can be planned on several
 * days, so the route's entry wins; without a usable one, today's meal is preferred over any other.
 */
export function resolveRecipeEntry({
  entries,
  recipeId,
  entryId,
  todayKey,
}: ResolveRecipeEntryArgs): MealPlanEntry | null {
  const recipeEntries = entries.filter((entry) => entry.recipeId === recipeId);

  return (
    recipeEntries.find((entry) => entry.id === entryId) ??
    recipeEntries.find((entry) => entry.date === todayKey) ??
    recipeEntries[0] ??
    null
  );
}

/** The assistant chat only works on the day the meal is planned; other days are read-only. */
export function isRecipeChatEnabled(entry: MealPlanEntry | null, todayKey: string): boolean {
  return entry !== null && entry.date === todayKey;
}

export function canMarkAsCooked(entry: MealPlanEntry | null): boolean {
  return entry !== null && !entry.isCooked;
}
