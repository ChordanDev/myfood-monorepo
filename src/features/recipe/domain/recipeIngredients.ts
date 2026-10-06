import type { Ingredient, InventoryItem, RecipeIngredient, UnitType } from '@/types/domain';

export type UnitAbbreviation = 'g' | 'ml' | 'u';

const UNIT_ABBREVIATION: Record<UnitType, UnitAbbreviation> = {
  gramos: 'g',
  mililitros: 'ml',
  unidades: 'u',
};

/** Decimals kept when printing an amount; enough for halves and quarters. */
const AMOUNT_DECIMALS = 2;

export function formatUnit(unit: UnitType): UnitAbbreviation {
  return UNIT_ABBREVIATION[unit];
}

/** Prints an amount without trailing zeros or floating point noise. */
function formatAmount(amount: number): string {
  return String(Number(amount.toFixed(AMOUNT_DECIMALS)));
}

export function formatQuantity(amount: number, unit: UnitType): string {
  return `${formatAmount(amount)} ${formatUnit(unit)}`;
}

export function toSentenceCase(name: string): string {
  const lowered = name.trim().toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

export type RecipeIngredientStatus = 'in_stock' | 'missing' | 'requested';

export type RecipeIngredientRow = {
  ingredientId: string;
  name: string;
  quantityLabel: string;
  requiredAmount: number;
  availableAmount: number;
  missingAmount: number;
  /** `null` when the ingredient is not in the catalog. */
  unit: UnitType | null;
  status: RecipeIngredientStatus;
};

export const UNKNOWN_INGREDIENT_NAME = 'Ingrediente desconocido';

type ResolveRecipeIngredientsArgs = {
  lines: RecipeIngredient[];
  catalog: Ingredient[];
  inventory: InventoryItem[];
  /** Ingredients already sent to the shopping requests. */
  requestedIngredientIds?: string[];
};

/** Total stock per ingredient: the same ingredient may sit in several inventory items. */
function sumInventoryByIngredient(inventory: InventoryItem[]): Map<string, number> {
  const totals = new Map<string, number>();
  inventory.forEach((item) => {
    totals.set(item.ingredientId, (totals.get(item.ingredientId) ?? 0) + item.amount);
  });
  return totals;
}

/**
 * Turns the recipe lines into display rows with their stock status, in recipe order.
 *
 * An ingredient is in stock when the inventory covers the whole recipe amount. An id that is
 * missing from the catalog cannot be trusted to be the same product, so it is never in stock.
 */
export function resolveRecipeIngredients({
  lines,
  catalog,
  inventory,
  requestedIngredientIds = [],
}: ResolveRecipeIngredientsArgs): RecipeIngredientRow[] {
  const catalogById = new Map(catalog.map((ingredient) => [ingredient.id, ingredient]));
  const stockByIngredient = sumInventoryByIngredient(inventory);
  const requestedIds = new Set(requestedIngredientIds);

  return lines.map(({ ingredientId, amount }) => {
    const ingredient = catalogById.get(ingredientId);
    const availableAmount = stockByIngredient.get(ingredientId) ?? 0;
    const isCovered = ingredient !== undefined && availableAmount >= amount;
    const shortStatus: RecipeIngredientStatus = requestedIds.has(ingredientId)
      ? 'requested'
      : 'missing';

    return {
      ingredientId,
      name: ingredient ? toSentenceCase(ingredient.name) : UNKNOWN_INGREDIENT_NAME,
      quantityLabel: ingredient ? formatQuantity(amount, ingredient.unit) : formatAmount(amount),
      requiredAmount: amount,
      availableAmount,
      missingAmount: Math.max(0, amount - availableAmount),
      unit: ingredient?.unit ?? null,
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
