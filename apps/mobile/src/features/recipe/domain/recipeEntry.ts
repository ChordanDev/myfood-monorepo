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

/** A meal that was already cooked or skipped is settled; the meal plan refuses to cook it too. */
export function canMarkAsCooked(entry: MealPlanEntry | null): boolean {
  return entry !== null && !entry.isCooked && !entry.isSkipped;
}

/**
 * A meal planned before the Account's today has no Cooking session: it is confirmed instead. The
 * day is the server's, so a device on another date does not send today's meal to be confirmed.
 */
export function isPastMeal(entry: MealPlanEntry, todayKey: string): boolean {
  return entry.date < todayKey;
}
