import type { CalendarMeal } from '../types/calendarApi';
import { getCalendarWindow, toPlanEntries, toRecipeSummaries } from './calendarPlan';

function meal(overrides: Partial<CalendarMeal> = {}): CalendarMeal {
  return {
    mealId: 'meal-1',
    date: '2026-10-09',
    slot: 'lunch',
    recipeId: 'recipe-1',
    recipeName: 'Lentil stew',
    isFavorite: true,
    isCooked: false,
    selectedQuantity: 2,
    prepTimeMinutes: 25,
    macros: { calories: 480 },
    ...overrides,
  };
}

describe('calendar window', () => {
  it('goes from a month back to three months ahead', () => {
    expect(getCalendarWindow(new Date(2026, 9, 8))).toEqual({
      startDate: '2026-09-07',
      endDate: '2027-01-06',
    });
  });
});

describe('plan entries from the calendar', () => {
  it('maps a scheduled meal to an entry that keeps the meal id', () => {
    expect(toPlanEntries([meal()])).toEqual([
      {
        id: 'meal-1',
        date: '2026-10-09',
        type: 'lunch',
        recipeId: 'recipe-1',
        isCooked: false,
        selectedQuantity: 2,
      },
    ]);
  });

  it('leaves out slots that have no recipe', () => {
    expect(toPlanEntries([meal({ recipeId: null, recipeName: null })])).toEqual([]);
  });
});

describe('recipe summaries from the calendar', () => {
  it('names each recipe of the plan once', () => {
    const summaries = toRecipeSummaries([meal(), meal({ mealId: 'meal-2', slot: 'dinner' })]);

    expect(summaries).toEqual({
      'recipe-1': { name: 'Lentil stew', isFavorite: true, prepTimeMinutes: 25, calories: 480 },
    });
  });

  it('skips a slot without a recipe', () => {
    expect(toRecipeSummaries([meal({ recipeId: null, recipeName: null })])).toEqual({});
  });
});
