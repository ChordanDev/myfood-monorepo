import {
  formatCostCents,
  formatMealMacros,
  formatProposalDay,
  MEAL_SLOT_LABELS,
} from '../proposalFormat';

describe('formatCostCents', () => {
  it('shows pesos with a thousands dot and no decimals, like the rest of the app', () => {
    expect(formatCostCents(0)).toBe('$0');
    expect(formatCostCents(1250)).toBe('$13');
    expect(formatCostCents(123456789)).toBe('$1.234.568');
  });
});

describe('formatProposalDay', () => {
  it('names the weekday and the day of the month in Spanish', () => {
    expect(formatProposalDay('2030-01-01')).toBe('Martes 1 Enero');
    expect(formatProposalDay('2030-03-10')).toBe('Domingo 10 Marzo');
  });
});

describe('MEAL_SLOT_LABELS', () => {
  it('labels every slot', () => {
    expect(MEAL_SLOT_LABELS).toEqual({
      breakfast: 'Desayuno',
      lunch: 'Almuerzo',
      dinner: 'Cena',
      snack: 'Merienda',
    });
  });
});

describe('formatMealMacros', () => {
  it('reads whole macros as they are', () => {
    expect(formatMealMacros({ calories: 500, proteinG: 30, carbsG: 60 })).toBe(
      '500 kcal · P 30 g · C 60 g'
    );
  });

  it('keeps one decimal of a fractional macro', () => {
    expect(formatMealMacros({ calories: 500, proteinG: 12.5, carbsG: 60.04 })).toBe(
      '500 kcal · P 12.5 g · C 60 g'
    );
  });

  it('shows a dash for a macro the producer does not know', () => {
    expect(formatMealMacros({ calories: null, proteinG: 30, carbsG: null })).toBe(
      '– kcal · P 30 g · C – g'
    );
  });
});
