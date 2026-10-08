import type { InventoryItem } from '@/features/inventory';
import type { Ingredient, UnitType } from '@/types/domain';
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
  /**
   * The unit the local catalog counts the ingredient in; `null` when the catalog does not have
   * it, or counts it in another unit than the recipe does.
   */
  unit: UnitType | null;
  status: RecipeIngredientStatus;
};

/** What the recipe reads from an inventory item: its catalog link and how much there is. */
type InventoryStockItem = Pick<InventoryItem, 'ingredientId' | 'quantity'>;

type ResolveRecipeIngredientsArgs = {
  lines: RecipeIngredientLine[];
  catalog: Ingredient[];
  inventory: InventoryStockItem[];
  /** Ingredients the shopping list already has a row for. */
  listedIngredientIds?: string[];
};

/**
 * Total stock per ingredient: the same ingredient may sit in several inventory items. An item
 * without a catalog link cannot be matched to a recipe line, so it never counts as stock.
 */
function sumInventoryByIngredient(inventory: InventoryStockItem[]): Map<string, number> {
  const totals = new Map<string, number>();
  inventory.forEach(({ ingredientId, quantity }) => {
    if (ingredientId === undefined) return;

    totals.set(ingredientId, (totals.get(ingredientId) ?? 0) + quantity);
  });
  return totals;
}

/**
 * Turns the recipe lines into display rows with their stock status, in recipe order. The name
 * and the quantity are the line's own; only the stock is read from the local inventory.
 *
 * An ingredient is in stock when the inventory covers the whole recipe amount. An id that is
 * missing from the catalog cannot be trusted to be the same product, and one the catalog counts
 * in another unit cannot be compared: neither is ever in stock, nor listed.
 */
export function resolveRecipeIngredients({
  lines,
  catalog,
  inventory,
  listedIngredientIds = [],
}: ResolveRecipeIngredientsArgs): RecipeIngredientRow[] {
  const catalogById = new Map(catalog.map((ingredient) => [ingredient.id, ingredient]));
  const stockByIngredient = sumInventoryByIngredient(inventory);
  const listedIds = new Set(listedIngredientIds);

  return lines.map(({ ingredientId, name, quantityMilli, unit }) => {
    const requiredAmount = quantityMilli / MILLI_PER_UNIT;
    const isInCatalog = catalogById.get(ingredientId)?.unit === unit;
    const availableAmount = stockByIngredient.get(ingredientId) ?? 0;
    const isCovered = isInCatalog && availableAmount >= requiredAmount;
    const isListed = isInCatalog && listedIds.has(ingredientId);
    const shortStatus: RecipeIngredientStatus = isListed ? 'listed' : 'missing';

    return {
      ingredientId,
      name,
      quantityLabel: formatQuantityMilli(quantityMilli, unit),
      requiredAmount,
      availableAmount,
      missingAmount: Math.max(0, requiredAmount - availableAmount),
      unit: isInCatalog ? unit : null,
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
