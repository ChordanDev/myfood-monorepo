import type { MealPlanEntry } from '@/types/domain';
import type { CalendarMeal } from '../types/calendarApi';
import {
  describeDayForAccessibility,
  getCalendarWindow,
  getPlannedSlots,
  toPlanEntries,
  toRecipeSummaries,
} from './calendarPlan';

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
        isCooking: false,
      },
    ]);
  });

  it('carries whether the meal has a Cooking session in progress', () => {
    expect(toPlanEntries([meal({ isCooking: true })])).toMatchObject([{ isCooking: true }]);
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

function entry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `entry-${overrides.type ?? 'lunch'}`,
    date: '2026-10-13',
    type: 'lunch',
    recipeId: 'recipe-1',
    isCooked: false,
    ...overrides,
  };
}

describe('planned slots of a day', () => {
  it('has no planned slot on a day without meals', () => {
    expect(getPlannedSlots(undefined)).toEqual([]);
    expect(getPlannedSlots([])).toEqual([]);
  });

  it('lists the slots with a Scheduled meal as breakfast, lunch and dinner, in that order', () => {
    const entries = [entry({ type: 'dinner' }), entry({ type: 'breakfast' })];

    expect(getPlannedSlots(entries)).toEqual(['breakfast', 'dinner']);
  });

  it('counts a cooked meal as a Scheduled meal of its slot', () => {
    expect(getPlannedSlots([entry({ type: 'lunch', isCooked: true })])).toEqual(['lunch']);
  });

  it('ignores a meal in the snack slot', () => {
    expect(getPlannedSlots([entry({ type: 'snack' })])).toEqual([]);
    expect(getPlannedSlots([entry({ type: 'snack' }), entry({ type: 'lunch' })])).toEqual([
      'lunch',
    ]);
  });
});

describe('accessibility label of a day', () => {
  // A Tuesday.
  const day = new Date(2026, 9, 13);

  it('says a day without meals has nothing planned', () => {
    expect(describeDayForAccessibility(day, [])).toBe('martes 13, sin comidas planificadas');
  });

  it('names the one planned slot', () => {
    expect(describeDayForAccessibility(day, ['lunch'])).toBe('martes 13, almuerzo planificado');
    expect(describeDayForAccessibility(day, ['dinner'])).toBe('martes 13, cena planificada');
  });

  it('names two planned slots', () => {
    expect(describeDayForAccessibility(day, ['breakfast', 'dinner'])).toBe(
      'martes 13, desayuno y cena planificados'
    );
  });

  it('names every slot of a fully planned day', () => {
    expect(describeDayForAccessibility(day, ['breakfast', 'lunch', 'dinner'])).toBe(
      'martes 13, desayuno, almuerzo y cena planificados'
    );
  });
});
