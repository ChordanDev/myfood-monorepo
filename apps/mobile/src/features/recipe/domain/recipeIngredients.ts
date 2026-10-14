import type { UnitType } from '@/types/domain';
import type { RecipeIngredientLine } from '../types/recipe';
import { MILLI_PER_UNIT, formatQuantityMilli } from './recipeFormat';

/** `listed` is a missing ingredient the shopping list already has; `missing` is one it lacks. */
export type RecipeIngredientStatus = 'in_stock' | 'missing' | 'listed';

export type RecipeIngredientRow = {
  ingredientId: string;
  name: string;
  quantityLabel: string;
  requiredAmount: number;
  availableAmount: number;
  missingAmount: number;
  /** The unit of the recipe line: the quantities above are in it. */
  unit: UnitType;
  status: RecipeIngredientStatus;
};

/**
 * What the recipe reads from an inventory lot: its ingredient, and how much there is in which
 * unit, in thousandths of it.
 */
type InventoryStockItem = { ingredientId: string; unit: UnitType; quantityMilli: number };

type ResolveRecipeIngredientsArgs = {
  lines: RecipeIngredientLine[];
  inventory: InventoryStockItem[];
  /** Ingredients the shopping list already has a row for. */
  listedIngredientIds?: string[];
};

/**
 * Total stock per ingredient and unit, in thousandths: the same ingredient may sit in several
 * lots, and a lot in another unit cannot be added to those of the recipe's unit.
 */
function sumInventoryByIngredientAndUnit(inventory: InventoryStockItem[]): Map<string, number> {
  const totals = new Map<string, number>();
  inventory.forEach(({ ingredientId, unit, quantityMilli }) => {
    const key = stockKey(ingredientId, unit);

    totals.set(key, (totals.get(key) ?? 0) + quantityMilli);
  });
  return totals;
}

function stockKey(ingredientId: string, unit: UnitType): string {
  return `${ingredientId}:${unit}`;
}

/**
 * Turns the recipe lines into display rows with their stock status, in recipe order. The name
 * and the quantity are the line's own; only the stock is read from the local inventory.
 *
 * An ingredient is in stock when the lots of the same ingredient and unit cover the whole recipe
 * amount. Lots in another unit are not converted: they add nothing.
 */
export function resolveRecipeIngredients({
  lines,
  inventory,
  listedIngredientIds = [],
}: ResolveRecipeIngredientsArgs): RecipeIngredientRow[] {
  const stockByIngredient = sumInventoryByIngredientAndUnit(inventory);
  const listedIds = new Set(listedIngredientIds);

  return lines.map(({ ingredientId, name, quantityMilli, unit }) => {
    const requiredAmount = quantityMilli / MILLI_PER_UNIT;
    const availableAmount =
      (stockByIngredient.get(stockKey(ingredientId, unit)) ?? 0) / MILLI_PER_UNIT;
    const isCovered = availableAmount >= requiredAmount;
    const shortStatus: RecipeIngredientStatus = listedIds.has(ingredientId) ? 'listed' : 'missing';

    return {
      ingredientId,
      name,
      quantityLabel: formatQuantityMilli(quantityMilli, unit),
      requiredAmount,
      availableAmount,
      missingAmount: Math.max(0, requiredAmount - availableAmount),
      unit,
      status: isCovered ? 'in_stock' : shortStatus,
    };
  });
}

export function countMissing(rows: RecipeIngredientRow[]): number {
  return rows.filter((row) => row.status !== 'in_stock').length;
}

export function formatMissingSummary(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 te falta' : `${count} te faltan`;
}
