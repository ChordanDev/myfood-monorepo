import { ORDERED_MEAL_SLOTS } from '@/types/domain';
import { MOCK_MEAL_PLAN } from './domainMocks';
import { getMockPlanByDate } from './mealPlans';

const API_MEAL_SLOTS: readonly string[] = ORDERED_MEAL_SLOTS;

describe('meal plan fixtures', () => {
  it('use only the API meal slot codes in the store fixtures', () => {
    const slots = MOCK_MEAL_PLAN.map((entry) => entry.type);

    expect(slots.filter((slot) => !API_MEAL_SLOTS.includes(slot))).toEqual([]);
  });

  it('use only the API meal slot codes in the plan grouped by date', () => {
    const slots = Object.values(getMockPlanByDate())
      .flat()
      .map((entry) => entry.type);

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.filter((slot) => !API_MEAL_SLOTS.includes(slot))).toEqual([]);
  });
});
