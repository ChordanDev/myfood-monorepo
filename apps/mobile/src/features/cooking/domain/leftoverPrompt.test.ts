import { COOKING_FINISH_NOTHING_CONSUMED, COOKING_FINISH_THREE_INGREDIENTS } from '../fixtures';
import { summarizeCookingFinish } from './cookingSummary';
import {
  openLeftoverForm,
  readLeftoverIngredients,
  readPreparedLeftover,
  type LeftoverLine,
} from './leftoverPrompt';

const SUMMARY = summarizeCookingFinish(COOKING_FINISH_THREE_INGREDIENTS);

function linesWith(...quantities: string[]): LeftoverLine[] {
  return openLeftoverForm(SUMMARY).lines.map((line, index) => ({
    ...line,
    quantityText: quantities[index] ?? '',
  }));
}

describe('openLeftoverForm', () => {
  it('starts on the choices with one empty line per consumed Ingredient and unit', () => {
    const form = openLeftoverForm(SUMMARY);

    expect(form.step).toBe('choices');
    expect(form.lines).toEqual([
      { ingredientId: expect.any(String), name: 'Arroz', unit: 'g', quantityText: '' },
      { ingredientId: expect.any(String), name: 'Aceite de oliva', unit: 'ml', quantityText: '' },
      { ingredientId: expect.any(String), name: 'Cebolla', unit: 'unit', quantityText: '' },
    ]);
  });

  it('proposes the recipe as the title of the Prepared leftover, and one portion', () => {
    expect(openLeftoverForm(SUMMARY)).toMatchObject({
      title: 'Arroz con aceite',
      portionsText: '1',
    });
  });

  it('has no line when nothing was deducted, nor before a finish', () => {
    expect(openLeftoverForm(summarizeCookingFinish(COOKING_FINISH_NOTHING_CONSUMED)).lines).toEqual(
      []
    );
    expect(openLeftoverForm(null)).toMatchObject({ lines: [], title: '' });
  });
});

describe('readLeftoverIngredients', () => {
  it('reads the filled lines as leftover lots in thousandths of the unit', () => {
    const [rice, , onion] = SUMMARY.consumed;

    expect(readLeftoverIngredients(linesWith('50', '', '0,5'))).toEqual([
      { ingredientId: rice.ingredientId, quantityMilli: 50_000, unit: 'g', isLeftover: true },
      { ingredientId: onion.ingredientId, quantityMilli: 500, unit: 'unit', isLeftover: true },
    ]);
  });

  it('accepts a decimal point as well as a comma', () => {
    expect(readLeftoverIngredients(linesWith('1.25'))).toEqual([
      expect.objectContaining({ quantityMilli: 1250 }),
    ]);
  });

  it('reads nothing while no line is filled', () => {
    expect(readLeftoverIngredients(linesWith())).toBeNull();
    expect(readLeftoverIngredients(linesWith(' ', '', ''))).toBeNull();
  });

  it.each(['0', '0,0', '-1', 'abc', '1e3', '1,2,3'])(
    'reads nothing while a filled line says %s',
    (text) => {
      expect(readLeftoverIngredients(linesWith('50', text))).toBeNull();
    }
  );
});

describe('readPreparedLeftover', () => {
  it('trims the title and names the Scheduled meal as the source', () => {
    expect(
      readPreparedLeftover({ title: '  Arroz de ayer ', portionsText: '2' }, 'meal-1')
    ).toEqual({ title: 'Arroz de ayer', portions: 2, scheduledMealId: 'meal-1' });
  });

  it('reads nothing with a blank title', () => {
    expect(readPreparedLeftover({ title: '   ', portionsText: '2' }, 'meal-1')).toBeNull();
  });

  it.each(['', '0', '-1', '1,5', '1.5', 'dos', '1001'])(
    'reads nothing with %s portions',
    (portionsText) => {
      expect(readPreparedLeftover({ title: 'Arroz', portionsText }, 'meal-1')).toBeNull();
    }
  );

  it('accepts the most portions the server takes', () => {
    expect(readPreparedLeftover({ title: 'Arroz', portionsText: '1000' }, 'meal-1')).toMatchObject({
      portions: 1000,
    });
  });
});
