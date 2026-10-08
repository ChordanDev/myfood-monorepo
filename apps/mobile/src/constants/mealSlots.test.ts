import { ORDERED_MEAL_SLOTS } from '@/types/domain';
import { MEAL_SLOT_LABEL } from './mealSlots';

describe('meal slots', () => {
  it('lists the API meal slot codes in the order of the day', () => {
    expect(ORDERED_MEAL_SLOTS).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
  });

  it('labels every meal slot in Spanish', () => {
    expect(MEAL_SLOT_LABEL).toEqual({
      breakfast: 'Desayuno',
      lunch: 'Almuerzo',
      snack: 'Snack',
      dinner: 'Cena',
    });
  });

  it('has a label for each listed meal slot and nothing else', () => {
    expect(Object.keys(MEAL_SLOT_LABEL).sort()).toEqual([...ORDERED_MEAL_SLOTS].sort());
  });
});
