import type {
  MealPlanEntry,
  PlannedShoppingListItem,
  ShoppingItemStatus,
  ShoppingListItem,
} from '@/types/domain';
import type { ShoppingCounters, ShoppingListInput } from '../types';
import { roundAmount } from './amounts';

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

function getStockAmounts({ inventory }: ShoppingListInput) {
  const stockAmounts = new Map<string, number>();

  for (const { ingredientId, amount } of inventory) {
    stockAmounts.set(ingredientId, (stockAmounts.get(ingredientId) ?? 0) + amount);
  }

  return stockAmounts;
}

/**
 * Builds the list from the plan: one planned item per ingredient, in order of first
 * appearance, followed by the manual items untouched.
 *
 * The shortfall (planned minus stock) always wins: while it is positive the item is needed
 * for that amount, whatever was bought before. A purchase lands in the inventory, so once
 * the stock covers the plan the item would vanish; its purchase record keeps it listed as
 * purchased, with the recorded amount.
 */
export function deriveShoppingList(input: ShoppingListInput): ShoppingListItem[] {
  const ingredientById = new Map(
    input.ingredients.map((ingredient) => [ingredient.id, ingredient])
  );
  const stockAmounts = getStockAmounts(input);
  const removedIds = new Set(input.removedIds);
  const plannedItems: PlannedShoppingListItem[] = [];

  for (const [ingredientId, plannedAmount] of getPlannedAmounts(input)) {
    const ingredient = ingredientById.get(ingredientId);
    if (!ingredient) continue;

    const id = getPlannedItemId(ingredientId);
    const shortfall = roundAmount(plannedAmount - (stockAmounts.get(ingredientId) ?? 0));
    const isPurchased = shortfall <= 0;
    const amountToBuy = isPurchased ? roundAmount(input.purchases[id] ?? 0) : shortfall;
    if (amountToBuy <= 0) continue;

    let status: ShoppingItemStatus = isPurchased ? 'purchased' : 'needed';
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

export function getShoppingCounters(items: ShoppingListItem[]): ShoppingCounters {
  const removed = items.filter((item) => item.status === 'removed').length;

  return {
    total: items.length - removed,
    purchased: items.filter((item) => item.status === 'purchased').length,
    removed,
  };
}
