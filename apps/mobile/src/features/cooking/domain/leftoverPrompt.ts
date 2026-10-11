import type { UnitType } from '@/types/domain';
import type { CookingSummary } from './cookingSummary';

export type LeftoverStep = 'choices' | 'ingredients' | 'prepared';

/** A consumed line as the prompt offers it: what is left of it is typed in display units. */
export interface LeftoverLine {
  ingredientId: string;
  name: string;
  /** With `ingredientId`, what tells two lines of one ingredient apart. */
  unit: UnitType;
  quantityText: string;
}

/** What the prompt holds while it is open. Nothing of it outlives the prompt. */
export interface LeftoverForm {
  step: LeftoverStep;
  /** The lines still to save: one that reached Inventory leaves the list. */
  lines: LeftoverLine[];
  title: string;
  portionsText: string;
}

/** What is left of one Ingredient, as add-extra takes it: a lot flagged as a leftover. */
export interface LeftoverIngredientInput {
  ingredientId: string;
  /** Integer above zero, in thousandths of `unit`. */
  quantityMilli: number;
  unit: UnitType;
  isLeftover: true;
}

/** The cooked portions kept apart, with the Scheduled meal they come from. */
export interface PreparedLeftoverInput {
  title: string;
  portions: number;
  scheduledMealId: string;
}

const MILLI_PER_UNIT = 1000;
// Plain non-negative decimals with a comma or a point, as the Inventory forms read a quantity.
const DECIMAL_PATTERN = /^(\d+[.,]?\d*|[.,]\d+)$/;
const WHOLE_NUMBER_PATTERN = /^\d+$/;
// The most portions the server takes for one Prepared leftover.
const MAX_PORTIONS = 1000;

export function leftoverLineKey(line: Pick<LeftoverLine, 'ingredientId' | 'unit'>): string {
  return `${line.ingredientId}:${line.unit}`;
}

/** The prompt as it opens for a finish: nothing typed, the recipe as the proposed title. */
export function openLeftoverForm(summary: CookingSummary | null): LeftoverForm {
  return {
    step: 'choices',
    lines: (summary?.consumed ?? []).map(({ ingredientId, name, unit }) => ({
      ingredientId,
      name,
      unit,
      quantityText: '',
    })),
    title: summary?.recipeName ?? '',
    portionsText: '1',
  };
}

function parseQuantityMilli(text: string): number | null {
  if (!DECIMAL_PATTERN.test(text)) return null;

  const milli = Math.round(Number(text.replace(',', '.')) * MILLI_PER_UNIT);
  return Number.isSafeInteger(milli) && milli > 0 ? milli : null;
}

/**
 * The lines with a quantity typed, in their order. Null while there is nothing to send: no
 * line is filled, or one of the filled ones is not an amount above zero.
 */
export function readLeftoverIngredients(lines: LeftoverLine[]): LeftoverIngredientInput[] | null {
  const inputs: LeftoverIngredientInput[] = [];

  for (const line of lines) {
    const text = line.quantityText.trim();
    if (text.length === 0) continue;

    const quantityMilli = parseQuantityMilli(text);
    if (quantityMilli === null) return null;

    inputs.push({
      ingredientId: line.ingredientId,
      quantityMilli,
      unit: line.unit,
      isLeftover: true,
    });
  }

  return inputs.length > 0 ? inputs : null;
}

/** Null while the title is blank or the portions are not a whole number the server takes. */
export function readPreparedLeftover(
  form: Pick<LeftoverForm, 'title' | 'portionsText'>,
  scheduledMealId: string
): PreparedLeftoverInput | null {
  const title = form.title.trim();
  const portionsText = form.portionsText.trim();
  if (title.length === 0 || !WHOLE_NUMBER_PATTERN.test(portionsText)) return null;

  const portions = Number(portionsText);
  if (portions < 1 || portions > MAX_PORTIONS) return null;

  return { title, portions, scheduledMealId };
}
