import { formatQuantity } from '@/utils/formatQuantity';
import type { Recipe, RecipeUnit } from '../types/recipe';

/** A recipe quantity is an integer in thousandths of its unit. */
export const MILLI_PER_UNIT = 1000;

const CENTS_PER_PESO = 100;

/**
 * Prints a recipe quantity the way the inventory and the shopping list print theirs: decimals
 * with a comma, kilograms and litres from a thousand up, `u` for whole units.
 */
export function formatQuantityMilli(quantityMilli: number, unit: RecipeUnit): string {
  return formatQuantity(quantityMilli / MILLI_PER_UNIT, unit);
}

/**
 * es-AR pesos as the shopping list prints prices: thousands dot, no decimals. A cost of zero
 * means that none is known, so there is nothing to print; neither is there for one that would
 * read as zero pesos.
 */
export function formatCostCents(costCents: number): string | null {
  const pesos = Math.round(costCents / CENTS_PER_PESO);
  if (pesos <= 0) return null;

  return `$${String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** `null` when the recipe does not say how many servings its quantities are for. */
export function formatServings(servings: number | null): string | null {
  if (servings === null || servings <= 0) return null;
  return servings === 1 ? '1 porción' : `${servings} porciones`;
}

/** Plain minutes, as the cooking times of the settings are printed; `null` when unknown. */
export function formatDurationMinutes(durationMinutes: number | null): string | null {
  if (durationMinutes === null || durationMinutes <= 0) return null;
  return `${durationMinutes} min`;
}

/** One line of what a recipe states about itself beyond its ingredients and steps. */
export type RecipeFact = {
  id: 'servings' | 'duration' | 'cost';
  label: string;
  value: string;
};

/** The servings, the duration and the cost of a recipe, leaving out what it does not know. */
export function buildRecipeFacts({
  servings,
  durationMinutes,
  estimatedCostCents,
}: Pick<Recipe, 'servings' | 'durationMinutes' | 'estimatedCostCents'>): RecipeFact[] {
  const facts: (Omit<RecipeFact, 'value'> & { value: string | null })[] = [
    { id: 'servings', label: 'Rinde', value: formatServings(servings) },
    { id: 'duration', label: 'Tiempo', value: formatDurationMinutes(durationMinutes) },
    { id: 'cost', label: 'Costo estimado', value: formatCostCents(estimatedCostCents) },
  ];

  return facts.flatMap(({ value, ...fact }) => (value === null ? [] : [{ ...fact, value }]));
}
