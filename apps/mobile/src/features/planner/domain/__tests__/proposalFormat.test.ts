import { formatCostCents, formatProposalDay, MEAL_SLOT_LABELS } from '../proposalFormat';

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
