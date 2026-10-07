import type { MealPlanEntry } from '@/types/domain';
import { roundQuantity } from '@/utils/formatQuantity';
import type {
  PlannedShoppingListItem,
  ShoppingCounters,
  ShoppingItemStatus,
  ShoppingListInput,
  ShoppingListItem,
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
