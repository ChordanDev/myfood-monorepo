import type { MealPlanEntry } from '@/types/domain';
import { roundQuantity } from '@/utils/formatQuantity';
import type {
  PlannedShoppingListItem,
  ShoppingCounters,
  ShoppingItemStatus,
  ShoppingListInput,
  ShoppingListItem,
  ShoppingListSources,
  ShoppingUntilCalendar,
} from '../types';

export function getPlannedItemId(ingredientId: string) {
  return `planned:${ingredientId}`;
}

// Date keys are 'YYYY-MM-DD', so they compare lexicographically.
export function getDefaultUntilDate(entries: MealPlanEntry[]): string | undefined {
  return entries.reduce<string | undefined>(
    (latest, entry) => (latest === undefined || entry.date > latest ? entry.date : latest),
    undefined
  );
}

// Days the list can be asked to reach: from today on, with at least one planned meal. In
// ascending order, each one once. `todayKey` is a date key too.
export function getSelectableUntilDates(entries: MealPlanEntry[], todayKey: string): string[] {
  const dates = entries.map((entry) => entry.date).filter((date) => date >= todayKey);

  return [...new Set(dates)].sort();
}

// The date the list reaches: the chosen day while it can still be chosen, otherwise the last
// planned one. A chosen day stops counting when it passes or loses its meals.
export function resolveUntilDate(
  entries: MealPlanEntry[],
  chosenUntilDate: string | undefined,
  todayKey: string
): string | undefined {
  const isChosenDateSelectable =
    chosenUntilDate !== undefined &&
    getSelectableUntilDates(entries, todayKey).includes(chosenUntilDate);

  return isChosenDateSelectable ? chosenUntilDate : getDefaultUntilDate(entries);
}

// The calendar that picks the date: the same days `resolveUntilDate` accepts can be picked,
// they carry the mark of a planned day, and only their months can be walked.
export function getUntilCalendar(
  entries: MealPlanEntry[],
  todayKey: string
): ShoppingUntilCalendar {
  const selectableDates = getSelectableUntilDates(entries, todayKey);
  const planByDate: ShoppingUntilCalendar['planByDate'] = {};

  for (const entry of entries) {
    if (entry.date < todayKey) continue;

    planByDate[entry.date] = [...(planByDate[entry.date] ?? []), entry];
  }

  return {
    planByDate,
    isDateSelectable: (dateKey) => selectableDates.includes(dateKey),
    monthBounds: { months: [...new Set(selectableDates.map((date) => date.slice(0, 7)))] },
  };
}

// Total amount each ingredient needs across the uncooked meals up to `untilDate`.
function getPlannedAmounts({ entries, recipes, untilDate }: ShoppingListInput) {
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const plannedAmounts = new Map<string, number>();

  for (const entry of entries) {
    if (entry.isCooked || (untilDate !== undefined && entry.date > untilDate)) continue;

    for (const { ingredientId, amount } of recipeById.get(entry.recipeId)?.ingredients ?? []) {
      plannedAmounts.set(ingredientId, (plannedAmounts.get(ingredientId) ?? 0) + amount);
    }
  }

  return plannedAmounts;
}

// Stock of each ingredient. An inventory item that is not linked to an ingredient covers no
// planned amount, and one that ran out stays in the inventory at quantity 0: no stock.
function getStockAmounts({ inventory }: ShoppingListInput) {
  const stockAmounts = new Map<string, number>();

  for (const { ingredientId, quantity } of inventory) {
    if (ingredientId === undefined) continue;

    stockAmounts.set(ingredientId, (stockAmounts.get(ingredientId) ?? 0) + quantity);
  }

  return stockAmounts;
}

/**
 * Builds the list from the plan: one planned item per ingredient, in order of first
 * appearance, followed by the manual items untouched.
 *
 * A planned item exists exactly while the plan has a shortfall (planned minus stock), for
 * that amount. Being in the cart only changes its status: a confirmed purchase lands in the
 * inventory, the shortfall closes and the item leaves the list by itself.
 */
export function deriveShoppingList(input: ShoppingListInput): ShoppingListItem[] {
  const ingredientById = new Map(
    input.ingredients.map((ingredient) => [ingredient.id, ingredient])
  );
  const stockAmounts = getStockAmounts(input);
  const cartIds = new Set(input.cartIds);
  const removedIds = new Set(input.removedIds);
  const plannedItems: PlannedShoppingListItem[] = [];

  for (const [ingredientId, plannedAmount] of getPlannedAmounts(input)) {
    const ingredient = ingredientById.get(ingredientId);
    if (!ingredient) continue;

    const id = getPlannedItemId(ingredientId);
    // Rounded to the precision it is displayed with, so no listed amount reads as zero.
    const amountToBuy = roundQuantity(plannedAmount - (stockAmounts.get(ingredientId) ?? 0));
    if (amountToBuy <= 0) continue;

    // Removed wins: a row taken off the list is not in the cart, whatever the cart says.
    let status: ShoppingItemStatus = cartIds.has(id) ? 'in_cart' : 'needed';
    if (removedIds.has(id)) status = 'removed';

    plannedItems.push({
      id,
      source: 'planned_meal',
      status,
      name: ingredient.name,
      ingredientId,
      amountToBuy,
      unit: ingredient.unit,
      category: ingredient.category,
    });
  }

  return [...plannedItems, ...input.manualItems];
}

// The list as the user has it: every reader derives it here, so they all reach the same date.
export function deriveCurrentShoppingList(
  { chosenUntilDate, ...input }: ShoppingListSources,
  todayKey: string
): ShoppingListItem[] {
  return deriveShoppingList({
    ...input,
    untilDate: resolveUntilDate(input.entries, chosenUntilDate, todayKey),
  });
}

// Rows of the cart, planned and manual, in the order of the list.
export function getCartItems(items: ShoppingListItem[]): ShoppingListItem[] {
  return items.filter((item) => item.status === 'in_cart');
}

export function getShoppingCounters(items: ShoppingListItem[]): ShoppingCounters {
  const removed = items.filter((item) => item.status === 'removed').length;

  return {
    total: items.length - removed,
    inCart: getCartItems(items).length,
    removed,
  };
}
