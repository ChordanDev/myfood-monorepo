import type { UnitType } from '@/types/domain';
import type { CookingFinish } from '../types/cookingApi';

export interface ConsumedLine {
  ingredientId: string;
  name: string;
  quantity: string;
  /** How many inventory lots the quantity was taken from. */
  lots: number;
}

export interface ShortageLine {
  ingredientId: string;
  name: string;
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

/** Groups the lot mutations by ingredient: the user cares what was used, not which lot. */
export function summarizeCookingFinish(finish: CookingFinish): CookingSummary {
  const byIngredient = new Map<string, { line: ConsumedLine; milli: number; unit: UnitType }>();

  for (const mutation of finish.inventoryMutations) {
    const current = byIngredient.get(mutation.ingredientId);
    const milli = (current?.milli ?? 0) + Math.abs(mutation.quantityDeltaMilli);
    const lots = (current?.line.lots ?? 0) + 1;

    byIngredient.set(mutation.ingredientId, {
      unit: mutation.unit,
      milli,
      line: {
        ingredientId: mutation.ingredientId,
        name: mutation.ingredientName,
        quantity: formatMilliQuantity(milli, mutation.unit),
        lots,
      },
    });
  }

  return {
    recipeName: finish.scheduledMeal.recipeName,
    consumed: [...byIngredient.values()].map(({ line }) => line),
    shortages: finish.shortages.map((shortage) => ({
      ingredientId: shortage.ingredientId,
      name: shortage.ingredientName,
      missing: formatMilliQuantity(shortage.missingMilli, shortage.unit),
    })),
  };
}
