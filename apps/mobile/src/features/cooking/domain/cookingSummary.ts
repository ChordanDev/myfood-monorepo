import type { UnitType } from '@/types/domain';
import type { CookingFinish } from '../types/cookingApi';

export interface ConsumedLine {
  ingredientId: string;
  name: string;
  /** With `ingredientId`, what tells two lines of one ingredient apart. */
  unit: UnitType;
  quantity: string;
  /** How many inventory lots the quantity was taken from. */
  lots: number;
}

export interface ShortageLine {
  ingredientId: string;
  name: string;
  unit: UnitType;
  missing: string;
}

export interface CookingSummary {
  recipeName: string;
  consumed: ConsumedLine[];
  shortages: ShortageLine[];
}

const UNIT_LABELS: Record<UnitType, string> = { g: 'g', ml: 'ml', unit: 'u' };

/** Writes a server quantity (thousandths of the unit) the way the user reads it: `1,5 g`. */
export function formatMilliQuantity(milli: number, unit: UnitType): string {
  const value = Math.round((milli / 1000) * 100) / 100;

  return `${String(value).replace('.', ',')} ${UNIT_LABELS[unit]}`;
}

/**
 * Groups the lot mutations by ingredient and unit: the user cares what was used, not which lot.
 * The server consumes per ingredient and unit, and a recipe may list one ingredient in two units.
 */
export function summarizeCookingFinish(finish: CookingFinish): CookingSummary {
  const byIngredientUnit = new Map<string, { line: ConsumedLine; milli: number }>();

  for (const mutation of finish.inventoryMutations) {
    const key = `${mutation.ingredientId}:${mutation.unit}`;
    const current = byIngredientUnit.get(key);
    const milli = (current?.milli ?? 0) + Math.abs(mutation.quantityDeltaMilli);
    const lots = (current?.line.lots ?? 0) + 1;

    byIngredientUnit.set(key, {
      milli,
      line: {
        ingredientId: mutation.ingredientId,
        name: mutation.ingredientName,
        unit: mutation.unit,
        quantity: formatMilliQuantity(milli, mutation.unit),
        lots,
      },
    });
  }

  return {
    recipeName: finish.scheduledMeal.recipeName,
    consumed: [...byIngredientUnit.values()].map(({ line }) => line),
    shortages: finish.shortages.map((shortage) => ({
      ingredientId: shortage.ingredientId,
      name: shortage.ingredientName,
      unit: shortage.unit,
      missing: formatMilliQuantity(shortage.missingMilli, shortage.unit),
    })),
  };
}
